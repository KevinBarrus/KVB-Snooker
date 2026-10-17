import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { ContactBase, ContactSS } from "../../src/core/physics/contact.js";
import { ContactSP } from "../../src/core/physics/sp-contact.js";
import { MeshEdge, CollisionPolygon } from "../../src/core/physics/collision-polygon.js";
import { ObjectPool } from "../../src/core/physics/pool.js";
import { Island } from "../../src/core/physics/island.js";
import { ActiveContactSet } from "../../src/core/physics/actings.js";
import { ccd } from "../../src/core/physics/ccd.js";

function sphereAt(x: number, y = 0, z = 0): BodySphere {
  return new BodySphere(1, 1, x, y, z);
}

/** 手工 set 速度后必置脏（原作数据流必经 predVelocities/applyImpulse 置脏）。 */
function markDirty(ball: BodySphere): void {
  ball.vProp_dirty = true;
  ball.wProp_dirty = true;
  ball.__vStateDirty = true;
}

function groundPoly(): CollisionPolygon {
  const p = (x: number, z: number) => new Vec3(x, 0.88, z);
  return new CollisionPolygon(new Vec3(0, 1, 0), [
    new MeshEdge(p(0, 0), p(10, 0)),
    new MeshEdge(p(10, 0), p(10, 10)),
    new MeshEdge(p(10, 10), p(0, 10)),
    new MeshEdge(p(0, 10), p(0, 0))
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
  ContactBase.gt.setZero();
});

describe("ccd 基础几何（PCOL L11297-11323）", () => {
  it("pointInPolygon：内/外/边界一致性签名", () => {
    const poly = groundPoly();
    expect(ccd.pointInPolygon(poly.edges, poly.edgeXNormals, new Vec3(5, 0.88, 5))).toBe(true);
    expect(ccd.pointInPolygon(poly.edges, poly.edgeXNormals, new Vec3(11, 0.88, 5))).toBe(false);
    expect(ccd.pointInPolygon(poly.edges, poly.edgeXNormals, new Vec3(-1, 0.88, 5))).toBe(false);
  });

  it("pRaySphereToi：offset=射线起点−球心 约定", () => {
    const dir = new Vec3(1, 0, 0);
    // 命中：起点 0，球心 (5,0,0) → offset=(−5,0,0)：toi=4
    expect(ccd.pRaySphereToi(dir, 1, new Vec3(-5, 0, 0), 25, 1)).toBeCloseTo(4, 10);
    // 起点已在球内：夹 0
    expect(ccd.pRaySphereToi(dir, 1, new Vec3(0.5, 0, 0), 0.25, 1)).toBe(0);
    // 正交错过：MAX_VALUE
    expect(ccd.pRaySphereToi(dir, 1, new Vec3(0, 0, -5), 25, 1)).toBe(Number.MAX_VALUE);
  });

  it("closestPointOnEdges：最短边投影点与距离平方", () => {
    const sq = new CollisionPolygon(new Vec3(0, 1, 0), [
      new MeshEdge(new Vec3(0, 0, 0), new Vec3(2, 0, 0)),
      new MeshEdge(new Vec3(2, 0, 0), new Vec3(2, 0, 2)),
      new MeshEdge(new Vec3(2, 0, 2), new Vec3(0, 0, 2)),
      new MeshEdge(new Vec3(0, 0, 2), new Vec3(0, 0, 0))
    ]);
    const out = new Vec3();
    // 近 (3,0,1) → 最近 = (2,0,1)，distSq = 1
    expect(ccd.closestPointOnEdges(sq.edges, new Vec3(3, 0, 1), out)).toBeCloseTo(1, 10);
    expect(out).toEqual({ x: 2, y: 0, z: 1 });
    // 中心正上方：任意边中点距离² = 1²+1² = 2
    expect(ccd.closestPointOnEdges(sq.edges, new Vec3(1, 1, 1), out)).toBeCloseTo(2, 10);
    expect(out.x).toBeCloseTo(1, 10); // 平局先到先得：e0 的投影先胜保留（原作扫描序）
  });

  it("rayIntersect：布尔粗测语义", () => {
    const dir = new Vec3(1, 0, 0);
    expect(ccd.rayIntersect(new Vec3(0, 0, 0), dir, 1, new Vec3(5, 0, 0), 1)).toBe(true);
    expect(ccd.rayIntersect(new Vec3(0, 0, 0), dir, 1, new Vec3(-5, 0, 0), 1)).toBe(false);
  });
});

describe("ccd.dcdSS（现存接触深度复核）", () => {
  it("贴靠对：重算穿透=0.5×(dist−Σr) 与法线；分离对：false", () => {
    const bi = sphereAt(1.5);
    const bj = sphereAt(0);
    const contact = makeSS(bi, bj);
    expect(ccd.dcdSS(contact)).toBe(true); // dist = 1.5 < 2
    expect(contact.penetration).toBeCloseTo(-0.25, 10); // 0.5×(1.5−2)
    expect((contact as unknown as { _normal: Vec3 })._normal).toEqual({ x: 1, y: 0, z: 0 });

    const farBi = sphereAt(4);
    const far = makeSS(farBi, bj);
    expect(ccd.dcdSS(far)).toBe(false); // dist = 4 > 2+1e-6
  });
});

describe("ccd.dcdSP（现存 SP 接触复核）", () => {
  it("平面内贴合：normal 路径（含深陷真实语义：中心在近窗内）；深陷穿透超带：false", () => {
    const poly = groundPoly();
    const contact = new ContactSP(null, -1);
    const ball = sphereAt(5, 0.87, 5); // 球心 y=0.87：planeDist = −0.01（球心略低于台面）
    ball.radius = 1;
    ball.radiusSq = 1;
    contact.resetWithBiBj(ball, poly as unknown as Parameters<ContactSS["resetWithBiBj"]>[1]);
    // planeDist=−0.01 ∈ 近窗 (ε−1, 1−ε)；pointInPoly 命中 → pene = planeDist − radius = −1.01
    expect(ccd.dcdSP(contact)).toBe(true);
    expect(contact.penetration).toBeCloseTo(-1.01, 10);

    // 深陷：中心低于平面超过一个半径 → 不可复核 → false
    ball.position.y = -0.2; // planeDist = −1.08 < ε−1
    expect(ccd.dcdSP(contact)).toBe(false);
  });
});

describe("ccd.ccdSS（移动球对碰）", () => {
  it("相向：toi=5−(1+1)=... 数值命中；分离：false", () => {
    const a = sphereAt(0);
    const b = sphereAt(6);
    a.v.set(1, 0, 0);
    markDirty(a);    // a → +x
    b.v.set(-0.5, 0, 0);
    markDirty(b); // b → −x
    const pending = new ContactSS(null, -1) as ContactSS;
    expect(ccd.ccdSS(a, b, 100, pending)).toBe(true);
    // gap = 2·1 = 2；中心距 6，= 球面间隔 4；接近速度 1.5 → toi = 4/1.5 = 2.6667
    expect(pending.toi).toBeCloseTo(4 / 1.5, 10);
    // cap 不足 → false
    expect(ccd.ccdSS(a, b, 1, new ContactSS(null, -1))).toBe(false);
    // 重叠分支：pene = 0.5×(dist−Σr)
    const c1 = sphereAt(1), c2 = sphereAt(0);
    c1.v.set(-1, 0, 0);
    markDirty(c1);
    c2.v.set(1, 0, 0);
    const overlapPending = new ContactSS(null, -1);
    expect(ccd.ccdSS(c1, c2, 10, overlapPending)).toBe(true);
    expect(overlapPending.toi).toBe(0);
    expect(overlapPending.penetration).toBeCloseTo(0.5 * (1 - 2), 10);
  });
});

describe("ccd.ccdSP（移动球撞桌）", () => {
  it("下落命中：toi = (dist−r)/|v|；台外掠过路径；向上：false", () => {
    const ball = sphereAt(5, 2.0, 5);   // planeDist = 1.12
    ball.v.set(0, -1, 0);
    markDirty(ball);
    const poly = groundPoly();
    const pending = new ContactSP(null, -1);
    // ratio = (1 − 1.12)/(−1) = 0.12；投影点 (5, 0.88, 5) 在面内 → TRUE
    expect(ccd.ccdSP(ball, poly, 100, pending)).toBe(true);
    expect(pending.toi).toBeCloseTo(0.12, 10);
    // 向上弹起 → false
    ball.v.set(0, 1, 0);
    markDirty(ball);
    expect(ccd.ccdSP(ball, poly, 100, new ContactSP(null, -1))).toBe(false);
  });

  it("台外掠过边（far 界外投影 → closest edge → 反演 ray）：斜下接近命中", () => {
    const ball = sphereAt(10.5, 2.5, 5); // 台外 0.5，高 planeDist 1.62
    ball.v.set(-0.5, -1, 0);
    markDirty(ball);
    const poly = groundPoly();
    const pending = new ContactSP(null, -1);
    // ratio = (1−1.62)/(−1) = 0.62 → 面上投影 x=10.19 出界 → 最近棱点 (10, 0.88, 5)
    // 反演 ray（−v）：offset=(−0.5,−1.62,0) → toi ≈ 0.637 ≤ cap → TRUE
    expect(ccd.ccdSP(ball, poly, 100, pending)).toBe(true);
    expect(pending.toi).toBeCloseTo(0.636642100170133, 8);
    // 竖直下落远离边 5 米 → 永不相交 → false
    const straight = sphereAt(15, 2.0, 5);
    straight.v.set(0, -1, 0);
    markDirty(straight);
    expect(ccd.ccdSP(straight, poly, 100, new ContactSP(null, -1))).toBe(false);
  });
});

describe("ccd 岛屿维护（initIslands/updateIslands）", () => {
  it("initIslands：重叠球+桌面 → actings 直配接触", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = new ActiveContactSet(4);
    set.resize(11, 5);
    const a = sphereAt(1.5);
    const b = sphereAt(0);
    a.uid = 5; b.uid = 6;
    const poly = groundPoly();
    poly.uid = 0;
    const meshGroups = { groups: [{ name: "ground", polys: [poly] }] };
    const ssPool = new ObjectPool("ss", ContactSS, 4);
    const spPool = new ObjectPool("sp", ContactSP, 4);
    ccd.initIslands([a, b], meshGroups, set, ssPool as never, spPool as never);
    // 两球经 SS 联通 → 全部接触同岛（合并语义）
    expect(set.nIslands).toBe(1);
    expect(set.totalItems).toBe(3);            // SS:1 + SP:2（两球各一格桌面接触）
    expect(set.isResting(5, 6)).toBe(true);
    expect(set.isResting(5, 0)).toBe(true);
    expect(set.isResting(6, 0)).toBe(true);
  });
});

function makeSS(bi: BodySphere, bj: BodySphere): ContactSS {
  const contact = new ContactSS(null, -1);
  contact.resetWithBiBj(bi, bj);
  contact.resetRestingWithPeneNormal(0, new Vec3(1, 0, 0));
  return contact;
}
