import { Vec3 } from "../math/vec3.js";
import { PHYSICS } from "./constants.js";
import type { CollisionPolygon, MeshEdge } from "./collision-polygon.js";
import type { ContactSS } from "./contact.js";
import type { ContactSP } from "./sp-contact.js";
import type { ActiveContactSet } from "./actings.js";
import type { Island } from "./island.js";
import type { Body } from "./body.js";

const EPSILON = Vec3.EPSILON;
const T_PRECISION = PHYSICS.tPrecision;

interface SSContactPool {
  acquire(): ContactSS;
  indexAt(poolIndex: number): ContactSS;
  freeIndex(poolIndex: number): void;
}
interface SPContactPool {
  acquire(): ContactSP;
  indexAt(poolIndex: number): ContactSP;
  freeIndex(poolIndex: number): void;
}
interface PendingsSS { add(contact: ContactSS): void }
interface PendingsSP { add(contact: ContactSP): void }
interface MeshGroupsLike { groups: { name: string; polys: CollisionPolygon[] }[] }

/** PCOL L11048-11323（原模 34）：连续碰撞检测（CCD/TOI）与岛屿维护函数集。 */
export const ccd = {
  /** 环境重建：全局 O(n²) 配对 + 球-多边形，贴靠者入活动集并急切重建冲量变换。 */
  initIslands(balls: Body[], meshBody: MeshGroupsLike, actings: ActiveContactSet, ssPool: SSContactPool, spPool: SPContactPool): void {
    for (let h = 0; h !== balls.length; ++h) {
      const bi = balls[h];
      if (!bi.active) continue;
      let ssContact = ssPool.acquire();
      for (let d = h + 1; d < balls.length; ++d) {
        const other = balls[d];
        if (!other.active) continue;
        ssContact.resetWithBiBj(bi, other);
        if (this.dcdSS(ssContact)) {
          actings.add(ssContact);
          ssContact.startResting();
          if (ssContact.impulseTransformDirty) ssContact.updateImpulseTransform();
          ssContact = ssPool.acquire();
        }
      }
      ssContact.free();
      let spContact = spPool.acquire();
      for (const group of meshBody.groups) {
        for (const poly of group.polys) {
          spContact.resetWithBiBj(bi, poly as unknown as Body);
          if (this.dcdSP(spContact)) {
            actings.add(spContact);
            spContact.startResting();
            if (spContact.impulseTransformDirty) spContact.updateImpulseTransform();
            spContact = spPool.acquire();
          }
        }
      }
      spContact.free();
    }
  },

  updateIslands(actings: ActiveContactSet, prepass: boolean): void {
    let island = actings.entry;
    if (prepass) {
      for (; island; island = island.next) {
        this.updateIsland(island, actings);
      }
    } else {
      for (; island; island = island.next) {
        if (island.needsUpdate) this.updateIsland(island, actings);
      }
    }
  },

  /** 贴靠复核+清洗：killed 与不再贴靠者停下并移除。 */
  updateIsland(island: Island, actings: ActiveContactSet): void {
    const casualties: ContactSS[] = [];
    for (let item = island.itemEntry as ContactSS; item; item = item.next as ContactSS) {
      if (item.markedAsKilled) {
        casualties.push(item);
      } else if (item.needsUpdateResting()) {
        if (item.isSS) {
          if (!this.dcdSS(item)) {
            (item.bi as Body).predictionDirty = true;
            (item.bj as Body).predictionDirty = true;
            casualties.push(item);
          }
        } else if (!this.dcdSP(item as unknown as ContactSP)) {
          (item.bi as Body).predictionDirty = true;
          casualties.push(item);
        }
      }
    }
    if (casualties.length !== 0) {
      for (const contact of casualties) {
        contact.stopResting();
        actings.remove(contact, true);
      }
      casualties.length = 0;
    }
  },

  /** 母球相对全部他球的球-球 CCD；命中入 pendings（含新借池位）。 */
  updateSSToi(cue: Body, allBalls: Body[], ssPool: SSContactPool, actings: ActiveContactSet, ssSkips: number[], cap: number, pendings: PendingsSS): void {
    let pending = ssPool.acquire();
    const cueUid = cue.uid;
    for (const other of allBalls) {
      if (
        !other.active ||
        other === cue ||
        (cue.collisionGroup & other.collisionMask) !== 0 ||
        (other.collisionGroup & cue.collisionMask) !== 0 ||
        ssSkips.indexOf(other.uid) !== -1 ||
        actings.isResting(cueUid, other.uid)
      ) {
        continue;
      }
      if (!this.ccdSS(cue, other, cap, pending)) continue;
      pendings.add(pending);
      pending = ssPool.acquire();
    }
    pending.free();
  },

  /** 母球相对桌面全部多边形的 CCD；收窄窗口（最紧 toi + tPrecision）后入 pendings。 */
  updateSPToi(ball: Body, meshBody: MeshGroupsLike, spPool: SPContactPool, actings: ActiveContactSet, pendings: PendingsSP): void {
    const results: ContactSP[] = [];
    let closest = Number.MAX_VALUE;
    for (const group of meshBody.groups) {
      const toi = this.dSPB(ball, group, spPool, actings, closest, results);
      if (toi < closest) closest = toi;
    }
    if (results.length !== 0) {
      if (closest !== Number.MAX_VALUE) {
        closest += T_PRECISION;
        for (const contact of results) {
          if (contact.toi <= closest) pendings.add(contact);
          else contact.free();
        }
      } else {
        for (const contact of results) contact.free();
      }
    }
  },

  dSPB(ball: Body, group: { polys: CollisionPolygon[] }, spPool: SPContactPool, actings: ActiveContactSet, cushion: number, results: ContactSP[]): number {
    let pending = spPool.acquire();
    let minSoFar = cushion;
    let cap = cushion + T_PRECISION;
    for (const poly of group.polys) {
      if (actings.isResting(ball.uid, poly.uid)) continue;
      if (!this.ccdSP(ball, poly, cap, pending)) continue;
      results.push(pending);
      if (pending.toi < minSoFar) {
        minSoFar = pending.toi;
        cap = minSoFar + T_PRECISION;
      }
      pending = spPool.acquire();
    }
    pending.free();
    return minSoFar;
  },

  /** 现存 SS 接触的深度复核（=重叠带内 → true 并重置法线/穿透）。 */
  dcdSS(contact: ContactSS): boolean {
    const bi = contact.bi as Body;
    const bj = contact.bj as Body;
    const radial = bi.position.distanceToSq(bj.position);
    const gapSq = bi.radiusSq + bj.radiusSq + 2 * bi.radius * bj.radius;
    if (radial - gapSq > EPSILON) return false;
    const dist = Math.sqrt(radial);
    let normal: Vec3;
    if (dist < EPSILON) {
      normal = new Vec3(0, 1, 0);
    } else {
      normal = new Vec3().subVectors(bi.position, bj.position).scale(1 / dist);
    }
    contact.resetRestingWithPeneNormal(0.5 * (dist - bi.radius - bj.radius), normal);
    return true;
  },

  /** 现存 SP 接触的深度复核：平面内走 normal，跨界走 closest point。 */
  dcdSP(contact: ContactSP): boolean {
    const ball = contact.bi as Body;
    const poly = contact.bj as unknown as CollisionPolygon;
    const planeDist = poly.distanceFromPointToPlane(ball.position);
    const depth = planeDist - ball.radius;
    if (depth > EPSILON || depth < EPSILON - 2 * ball.radius) return false;
    if (this.pointInPolygon(poly.edges, poly.edgeXNormals, ball.position)) {
      if (poly.hasCustomNormalHandler) contact.resetRestingWithPeneCP(depth, ball.position);
      else contact.resetRestingWithPeneNormal(depth, poly.normal);
      return true;
    }
    const closest = new Vec3();
    const closestSq = this.closestPointOnEdges(poly.edges, ball.position, closest);
    if (closestSq - ball.radiusSq > EPSILON) return false;
    contact.resetRestingWithPeneCP(Math.sqrt(closestSq) - ball.radius, closest);
    return true;
  },

  /** 移动球 vs 他球 CCD；重叠或 toi<cap 命中则挂 pendings。 */
  ccdSS(a: Body, b: Body, cap: number, pending: ContactSS): boolean {
    const offset = new Vec3().subVectors(a.position, b.position);
    const relVel = new Vec3().subVectors(a.v, b.v);
    if (relVel.dot(offset) > 0) return false; // 分离中
    const gapSq = a.radiusSq + b.radiusSq + 2 * a.radius * b.radius;
    const offsetSq = offset.lengthSq();
    if (offsetSq < gapSq) {
      pending.resetPendingWithToiPene(a, b, 0, 0.5 * (Math.sqrt(offsetSq) - a.radius - b.radius));
      return true;
    }
    const toi = this.pRaySphereToi(relVel, relVel.dot(relVel), offset, offsetSq, gapSq);
    if (toi < cap) {
      pending.resetPendingWithToiPene(a, b, toi, 0);
      return true;
    }
    return false;
  },

  /** 移动球 vs 多边形 CCD：mask 门 + 包围球粗测 + 近/远两路径。 */
  ccdSP(ball: Body, poly: CollisionPolygon, cap: number, pending: ContactSP): boolean {
    if ((ball.collisionMask & poly.collisionGroup) !== 0) return false;
    if (
      poly.bR !== 0 &&
      !this.rayIntersect(ball.position, ball.v, ball.vSq, poly.bCenter as Vec3, ball.radiusSq + poly.bRSq + 2 * ball.radius * poly.bR)
    ) {
      return false;
    }
    const planeDist = poly.distanceFromPointToPlane(ball.position);
    if (planeDist - ball.radius >= -EPSILON) {
      const velDotNormal = ball.v.dot(poly.normal);
      if (velDotNormal >= 0) return false;
      return this.__ccdspFar(planeDist, ball, poly, velDotNormal, cap, pending);
    }
    return planeDist > EPSILON - ball.radius && this.__ccdspNear(planeDist, ball, poly, cap, pending);
  },

  /** 远端接近：走到平面/最近棱的时刻；域外走 ray-sphere。 */
  __ccdspFar(
    planeDist: number,
    ball: Body,
    poly: CollisionPolygon,
    velDotNormal: number,
    cap: number,
    pending: ContactSP
  ): boolean {
    const normal = poly.normal;
    const radius = ball.radius;
    const shadow = new Vec3().scaleVector(radius, normal);
    let ratio = (radius - planeDist) / velDotNormal;
    if (ratio < EPSILON) ratio = 0;
    if (ratio > cap) return false;
    const projected = new Vec3().interpolate(ball.position, ball.v, ratio).sub(shadow);
    if (this.pointInPolygon(poly.edges, poly.edgeXNormals, projected)) {
      if (poly.hasCustomNormalHandler) pending.resetPendingWithToiPeneCP(ball, poly, ratio, 0, projected);
      else pending.resetPendingWithToiPeneNormal(ball, poly, ratio, 0, normal);
      return true;
    }
    const closest = new Vec3();
    this.closestPointOnEdges(poly.edges, projected, closest);
    const reverseVel = new Vec3().copyNeg(ball.v);
    const delta = new Vec3().subVectors(closest, ball.position);
    const toi = this.pRaySphereToi(reverseVel, ball.vSq, delta, delta.lengthSq(), ball.radiusSq);
    if (toi <= cap && toi !== Number.MAX_VALUE) {
      pending.resetPendingWithToiPeneCP(ball, poly, toi, 0, closest);
      return true;
    }
    return false;
  },

  /** 微沉接触：平面/最近点即时修正（pene = planeDist − radius = 负深度）。 */
  __ccdspNear(
    planeDist: number,
    ball: Body,
    poly: CollisionPolygon,
    cap: number,
    pending: ContactSP
  ): boolean {
    const normal = poly.normal;
    const radius = ball.radius;
    const shadow = new Vec3().scaleVector(radius, normal);
    const center = new Vec3().subVectors(ball.position, shadow);
    if (this.pointInPolygon(poly.edges, poly.edgeXNormals, center)) {
      if (poly.hasCustomNormalHandler) pending.resetPendingWithToiPeneCP(ball, poly, 0, planeDist - radius, center);
      else pending.resetPendingWithToiPeneNormal(ball, poly, 0, planeDist - radius, normal);
      return true;
    }
    const closest = new Vec3();
    this.closestPointOnEdges(poly.edges, center, closest);
    const delta = new Vec3().subVectors(closest, ball.position);
    const deltaSq = delta.lengthSq();
    if (deltaSq <= ball.radiusSq) {
      pending.resetPendingWithToiPeneCP(ball, poly, 0, Math.sqrt(deltaSq) - radius, closest);
      return true;
    }
    const reverseVel = new Vec3().copyNeg(ball.v);
    const toi = this.pRaySphereToi(reverseVel, ball.vSq, delta, deltaSq, ball.radiusSq);
    if (toi <= cap && toi !== Number.MAX_VALUE) {
      pending.resetPendingWithToiPeneCP(ball, poly, toi, 0, closest);
      return true;
    }
    return false;
  },

  /** 点含测试（edgeXNormals 签名一致性；空边集=真，原作语义）。 */
  pointInPolygon(edges: MeshEdge[], edgeXNormals: Vec3[], point: Vec3): boolean {
    let positive: boolean | null = null;
    const delta = new Vec3();
    for (let i = 0, n = edges.length; i !== n; ++i) {
      delta.subVectors(point, edges[i].va);
      const dot = edgeXNormals[i].dot(delta);
      if (
        positive !== null &&
        !(
          (dot > 0 && positive === true) ||
          (dot <= 0 && positive === false)
        )
      ) {
        return false;
      }
      if (positive === null) positive = dot > 0;
    }
    return true;
  },

  /** 粗测：p→sphere(dir) 相交布尔（后移原点，仅决定剪枝）。 */
  rayIntersect(p: Vec3, dir: Vec3, dirSq: number, center: Vec3, radiusSq: number): boolean {
    const offset = new Vec3().subVectors(p, center);
    const offSq = offset.lengthSq() - radiusSq;
    const offDot = offset.dot(dir);
    if (offSq > 0 && offDot > 0) return false;
    return offDot * offDot - offSq * dirSq >= 0;
  },

  /** 解析 ray-sphere TOI；返回 MAX_VALUE = 不相交；toi 夹 0 起。 */
  pRaySphereToi(dir: Vec3, dirSq: number, offset: Vec3, offsetSq: number, radiusSq: number): number {
    const proj = offset.dot(dir);
    if (offsetSq - radiusSq > 0 && proj > 0) return Number.MAX_VALUE;
    const disc = proj * proj - dirSq * (offsetSq - radiusSq);
    if (disc <= 0) return Number.MAX_VALUE;
    let toi = (-proj - Math.sqrt(disc)) / dirSq;
    if (toi < EPSILON) toi = 0;
    return toi;
  },

  /** 最近点：每边 clamp 投影取最紧；返回最短 distSq 与写入的点。 */
  closestPointOnEdges(edges: MeshEdge[], point: Vec3, out: Vec3): number {
    const delta = new Vec3();
    const proj = new Vec3();
    let bestSq = Number.MAX_VALUE;
    for (const edge of edges) {
      delta.subVectors(point, edge.va);
      const raw = delta.dot(edge.vab) / edge.abDotAb;
      const candidate = raw <= 0 ? edge.va : raw >= 1 ? edge.vb : proj.scaleVector(raw, edge.vab).add(edge.va);
      const distSq = candidate.distanceToSq(point);
      if (bestSq > distSq) {
        bestSq = distSq;
        out.copy(candidate);
      }
    }
    return bestSq;
  }
};
