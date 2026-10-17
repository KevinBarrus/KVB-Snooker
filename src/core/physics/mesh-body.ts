import { Vec3 } from "../math/vec3.js";
import { MeshEdge, CollisionPolygon } from "./collision-polygon.js";
import { setPolyFrictionAndRestitution } from "./constants.js";

/** 台面碰撞数据（tiger-club-sno-rgb.json schema，spec 03 §2）。 */
export interface CollisionMeshPolyData {
  i: number[];
  n: [number, number, number];
  f?: string[];
  s?: number[];
  uv?: number[];
}

export interface CollisionMeshGroupData {
  p: number[];
  q: CollisionMeshPolyData[];
  nt?: string;
}

export type CollisionMeshData = Record<string, CollisionMeshGroupData>;

/** 桌面碰撞分区排序与分配到碰撞组的位掩码（PCOL L13476-13481 原模 84）。 */
const STRUCTURAL_ORDER: Record<string, number> = { ground: 0, side: 1, tunnel: 2 };
const COLLISION_GROUP_BITS: Record<string, number> = { ground: 2, side: 4, tunnel: 8 };

/**
 * PCOL L13329-13359（原模 81）：同分区面集合。
 * setCustomRelativeVelHandler 原作会转发到多边形实例，但模 82 并无该方法
 * （原作死代码：全库无调用点）——照注保留调用形态，若被误调用将抛与原作相同的错误。
 */
export class PolyGroup {
  name: string;
  polys: CollisionPolygon[];

  constructor(name: string, polys: CollisionPolygon[]) {
    this.name = name;
    this.polys = polys;
  }

  getPolygonByID(uid: number): CollisionPolygon | null {
    for (const poly of this.polys) {
      if (poly.uid === uid) return poly;
    }
    return null;
  }

  setCollisionGroup(bits: number): void {
    for (const poly of this.polys) poly.collisionGroup = bits;
  }

  setPolyFrictionAndRestitution(): void {
    for (const poly of this.polys) setPolyFrictionAndRestitution(poly);
  }

  setCustomRelativeVelHandler(handler: unknown): void {
    // 原作 L13353-13356 死代码保留：直调（多边形无此方法，调用即抛错——语义一致）
    for (const poly of this.polys) {
      (poly as unknown as { setCustomRelativeVelHandler: (t: unknown) => void }).setCustomRelativeVelHandler(handler);
    }
  }
}

/**
 * PCOL L13472-13579（原模 84）：桌面碰撞体容器。
 * id 由加载缓存统一赋值（PCOL L12207-12208：e.id = 任务名），World 序列化 mbid 依赖它。
 */
export class MeshBody {
  id = "";
  nPolygons = 0;
  nEdges = 0;
  groups: PolyGroup[] = [];
  lowestPosition: Vec3;
  private _groundPolygon: CollisionPolygon | null = null;

  constructor(data: CollisionMeshData) {
    this.lowestPosition = new Vec3(0, Number.MAX_VALUE, 0);
    this.initData(data);
  }

  get ground(): CollisionPolygon | null {
    return this._groundPolygon;
  }

  getPolygonsByName(groupName: string): PolyGroup | null {
    return this.getGroupByName(groupName);
  }

  getGroupByName(groupName: string): PolyGroup | null {
    for (const group of this.groups) {
      if (group.name === groupName) return group;
    }
    return null;
  }

  getPolygonByID(uid: number): CollisionPolygon | null {
    for (const group of this.groups) {
      const poly = group.getPolygonByID(uid);
      if (poly) return poly;
    }
    return null;
  }

  /**
   * 按分区名单切割（PCOL L13513-13519）：原作返回**裸对象 {groups}**（鸭子类型被
   * WorldClient 预测消费，只保留 ground），非完整 MeshBody——1:1 保持。
   */
  slice(groupName: string): { groups: PolyGroup[] } {
    const matched: PolyGroup[] = [];
    for (const group of this.groups) {
      if (group.name === groupName) matched.push(group);
    }
    const sliced: { groups: PolyGroup[] } = Object.create(null);
    sliced.groups = matched;
    return sliced;
  }

  /** 分区数据 → 多边形集合（PCOL L13512-13567 全量语义 1:1）。 */
  private initData(data: CollisionMeshData): void {
    for (const name in data) {
      const group = new PolyGroup(name, this.dataToPolys(data[name]));
      group.setCollisionGroup(COLLISION_GROUP_BITS[name] ?? 1);
      group.setPolyFrictionAndRestitution();
      this.groups.push(group);
    }
    this.groups.sort((a, b) => (STRUCTURAL_ORDER[a.name] ?? 1) - (STRUCTURAL_ORDER[b.name] ?? 1));
  }

  private dataToPolys(groupData: CollisionMeshGroupData): CollisionPolygon[] {
    const verts = groupData.p;
    const vertices: Vec3[] = [];
    for (let i = 0, n = verts.length / 3; i !== n; ++i) {
      vertices.push(new Vec3(verts[3 * i], verts[3 * i + 1], verts[3 * i + 2]));
    }
    const polys: CollisionPolygon[] = [];
    const edgeCache: Record<string, MeshEdge> = {};
    for (const polyData of groupData.q) {
      const indices = polyData.i;
      if (indices.length < 3) {
        throw new Error(`PolyGroup Error: invalid indices length${indices.length}`);
      }
      const edges: MeshEdge[] = [];
      for (let i = 0; i < indices.length; i++) {
        const a = indices[i];
        const b = indices[(i + 1) % indices.length];
        const forwardKey = `${a}-${b}`;
        const backwardKey = `${b}-${a}`;
        if (edgeCache[forwardKey]) {
          edges.push(edgeCache[forwardKey]);
        } else if (edgeCache[backwardKey]) {
          edges.push(edgeCache[backwardKey].cloneReversed());
        } else {
          edgeCache[forwardKey] = new MeshEdge(vertices[a], vertices[b]);
          this.nEdges++;
          edges.push(edgeCache[forwardKey]);
        }
      }
      const poly = new CollisionPolygon(new Vec3(polyData.n[0], polyData.n[1], polyData.n[2]), edges);
      if (polyData.uv) poly.uv = polyData.uv;
      poly.uid = this.nPolygons++;
      if (polyData.s) {
        poly.setBoundingSphere(new Vec3(polyData.s[0], polyData.s[1], polyData.s[2]), polyData.s[3]);
      }
      const flags = polyData.f;
      if (flags) {
        for (const flag of flags) {
          (poly as unknown as Record<string, unknown>)[flag] = true;
        }
      }
      if (poly.ground) this._groundPolygon = poly;
      if (poly.centerPosition.y < this.lowestPosition.y) this.lowestPosition.copy(poly.centerPosition);
      polys.push(poly);
    }
    return polys;
  }

  log(): void {
    // 原作调试日志（PCOL L13572-13577）
    let text = "";
    for (const group of this.groups) {
      text += `${group.name}\n`;
      for (let i = 0; i < group.polys.length; i++) {
        text += `\t${i}: ${group.polys[i].toStringShort()}\n`;
      }
    }
    console.log(text);
  }
}
