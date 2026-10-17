import { Vec3 } from "../math/vec3.js";

/** PCOL L13453-13471（原模 83）：多边形边，邻边共享 sharedData 计数。 */
export class MeshEdge {
  va: Vec3;
  vb: Vec3;
  vab: Vec3;
  abDotAb: number;
  sharedData: { count: number };

  constructor(va: Vec3, vb: Vec3, sharedData?: { count: number }) {
    this.va = va;
    this.vb = vb;
    this.vab = new Vec3().subVectors(vb, va);
    this.abDotAb = this.vab.dot(this.vab);
    this.sharedData = sharedData || { count: 0 };
    this.sharedData.count++;
  }

  cloneReversed(): MeshEdge {
    return new MeshEdge(this.vb, this.va, this.sharedData);
  }
}

/**
 * PCOL L13360-13452（原模 82）：碰撞多边形（平面 + 边 + 分区旗标 + 包围球）。
 * dispose 未实现（原作置空引用，编入 World 池销毁路径统一处理，见模块章程）。
 */
export class CollisionPolygon {
  ground = false;
  sidesoft = false;
  sidehard = false;
  tunnel = false;
  pocket = false;
  end = false;
  uid = -1;
  normal: Vec3;
  edges: MeshEdge[];
  edgeXNormals: Vec3[];
  centerPosition: Vec3;
  /** 平面方程 ax+by+cz+d=0（normal·p + d = 0）。 */
  a: number;
  b: number;
  c: number;
  d: number;
  bCenter: Vec3 | null = null;
  bR = 0;
  bRSq = 0;
  restitution = 0;
  friction = 0;
  collisionGroup = 1;
  uv: number[] | null = null;
  private _size: Vec3 | null = null;
  /** uv4pg 通道（模80 nt 法线图注入）；接触子系统读取（sp-contact.ts）。 */
  hasCustomNormalHandler = false;
  customNormalHandler: ((cp: Vec3, normal: Vec3) => void) | null = null;

  constructor(normal: Vec3, edges: MeshEdge[]) {
    this.normal = normal;
    this.edges = edges;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const n = edges.length;
    this.edgeXNormals = [];
    for (let i = 0; i !== n; ++i) {
      this.edgeXNormals.push(new Vec3().crossVectors(edges[i].vab, this.normal));
      cx += edges[i].va.x;
      cy += edges[i].va.y;
      cz += edges[i].va.z;
    }
    this.centerPosition = new Vec3(cx / n, cy / n, cz / n);
    this.a = normal.x;
    this.b = normal.y;
    this.c = normal.z;
    this.d = -normal.dot(edges[0].va);
  }

  toString(): string {
    return `${this.a}x + ${this.b}y + ${this.c}z + ${this.d} = 0,restitution:${this.restitution},bCenter: ${this.bCenter},bR:${this.bR}`;
  }

  toStringShort(): string {
    let s = `uid: ${this.uid}`;
    if (this.ground) s += ", ground";
    if (this.sidesoft) s += ", sidesoft";
    if (this.sidehard) s += ", sidehard";
    if (this.pocket) s += ", pocket";
    if (this.tunnel) s += ", tunnel";
    if (this.end) s += ", end";
    s += `, restitution: ${this.restitution}, friction: ${this.friction}, cg: ${this.collisionGroup}`;
    return s;
  }

  setBoundingSphere(center: Vec3, radius: number): void {
    this.bCenter = center;
    this.bR = radius;
    this.bRSq = radius * radius;
  }

  distanceFromPointToPlane(p: Vec3): number {
    return this.a * p.x + this.b * p.y + this.c * p.z + this.d;
  }

  /** 顶点 bbox 尺寸（惰性缓存）。 */
  get size(): Vec3 {
    if (!this._size) {
      let minX = Number.MAX_VALUE;
      let maxX = 0;
      let minY = Number.MAX_VALUE;
      let maxY = 0;
      let minZ = Number.MAX_VALUE;
      let maxZ = 0;
      for (const edge of this.edges) {
        const v = edge.va;
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
      }
      this._size = new Vec3(maxX - minX, maxY - minY, maxZ - minZ);
    }
    return this._size;
  }
}
