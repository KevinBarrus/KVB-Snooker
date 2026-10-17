import { Vec3 } from "../math/vec3.js";

// PCOL L9184-9248（原模 18）：平面基类（本模块仅移植 rules 所需方法集）。
export class Plane {
  static TmpV = new Vec3();

  normal = new Vec3(0, 0, 0);
  d = 0;

  isZeroNormal(): boolean {
    const epsilon = Vec3.EPSILON;
    const n = this.normal;
    return !(Math.abs(n.x) > epsilon || Math.abs(n.y) > epsilon || Math.abs(n.z) > epsilon);
  }

  setWithPointNormal(point: Vec3, normal: Vec3): this {
    this.normal.copy(normal);
    this.d = -normal.x * point.x - normal.y * point.y - normal.z * point.z;
    return this;
  }

  signedDistance(t: Vec3): number {
    const n = this.normal;
    return n.x * t.x + n.y * t.y + n.z * t.z + this.d;
  }

  /** t=射线起点 e=方向 i=输出 s=步长上限（默认 9999）；h 夹 0。 */
  intersectionWithRay(t: Vec3, e: Vec3, i: Vec3, s: number = 9999): boolean {
    const from = t;
    const dir = e;
    const sd = this.signedDistance(from);
    const denom = this.normal.dot(dir);
    let h = sd / -denom;
    if (!(h > -Vec3.EPSILON && h <= s)) return false;
    if (h < 0) h = 0;
    i.copy(from).addScaled(dir, h);
    return true;
  }

  /** PCOL L9244：基类直通（子类覆写；原签名无参，放宽以容子类 3 参覆写）。 */
  projectionInside(..._args: number[]): boolean {
    return true;
  }
}

// PCOL L10028-10170（原模 32）：一维区段几何单例。
class Sections {
  private readonly _tmpSP = new Vec3();
  private readonly _tmpAB = new Vec3();
  private readonly _tmpSectionsSubResults: number[] = [];

  /** [t,e] 区减去 [i,s]，输出进 r，返回写入长度。 */
  sectionSub(t: number, e: number, i: number, s: number, r: number[]): number {
    const epsilon = Vec3.EPSILON;
    if (s <= t || i >= e) {
      r[0] = t;
      r[1] = e;
      return 2;
    }
    let o = 0;
    if (i > t + epsilon) {
      r[o++] = t;
      r[o++] = i;
    }
    if (e > s + epsilon) {
      r[o++] = s;
      r[o++] = e;
    }
    return o;
  }

  /** results 原地重写：全部区段减去 [e,i]。 */
  sectionsSub(t: number[], e: number, i: number): void {
    const copy = this._tmpSectionsSubResults;
    const n = t.length;
    for (let s = 0; s !== n; ++s) copy[s] = t[s];
    t.length = 0;
    for (let pair = 0, pairs = n / 2; pair !== pairs; ++pair) {
      const written = this.sectionSub(copy[2 * pair], copy[2 * pair + 1], e, i, copy);
      for (let k = 0; k < written; ++k) t.push(copy[k]);
    }
  }

  /** 分界值数组 e（奇数项=段起、偶数项=段止）→ 离目标 t 最近的边界值。 */
  findClosestTInSections(t: number, e: number[]): number {
    const n = e.length;
    if (n === 0) return t;
    let s = 0;
    let inside = false;
    while (s < n && t - e[s] >= 0) {
      inside = !inside;
      s++;
    }
    if (inside) return t;
    if (s === 0) return e[s];
    if (s === n) return e[s - 1];
    const left = e[s - 1];
    const right = e[s];
    return t - left > right - t ? right : left;
  }

  /** 区段中最长的空段中点（e=最短阈值）。 */
  findCenterOfLongestInSections(t: number[], e: number = 0): number {
    let center = NaN;
    const pairs = t.length / 2;
    if (0 === pairs) return center;
    let longest = 0;
    for (let i = 0; i !== pairs; ++i) {
      const a = t[2 * i];
      const b = t[2 * i + 1];
      const len = b - a;
      if (len - longest > e) {
        longest = len;
        center = (a + b) / 2;
      }
    }
    return center;
  }

  private intersectSphereRay(t: Vec3, e: number, i: Vec3, s: Vec3, r: number[]): number {
    const epsilon = Vec3.EPSILON;
    // o = 射线起点 − 球心（原作符号约规：l = −(center−origin)·dir）
    const o = this._tmpSP.subVectors(i, t);
    const l = o.dot(s);
    const h = o.dot(o) - e * e;
    if (h > 0 && l > 0) return 0; // 球心在射线背后且在外
    const c = l * l - h;
    if (c < -epsilon) return 0;
    if (c > epsilon) {
      const root = Math.sqrt(c);
      const near = -l - root;
      const far = -l + root;
      r[0] = near < 0 ? 0 : near;
      r[1] = far < 0 ? 0 : far;
      return 2;
    }
    return (r[0] = -l < 0 ? 0 : -l), 1;
  }

  private intersectSphereADirLen(t: Vec3, e: number, i: Vec3, s: Vec3, n: number, r: number[]): number {
    const count = this.intersectSphereRay(t, e, i, s, r);
    if (count === 0) return 0;
    if (count === 1) return r[0] > n ? 0 : 1;
    if (r[0] > n) return 0;
    if (r[1] > n) r[1] = n;
    return 2;
  }

  /**
   * PCOL L10131-10158：A→B 区间减去所有球的占位投影；空段存在返 true。
   * t=Balls e=排除球 i=许可半径 s/r=线段端点 a=输出区段 o=失败时回退方向（步进修正起点）。
   */
  sectionsBallsAB(t: unknown[], e: unknown, i: number, s: Vec3, r: Vec3, a: number[], o: Vec3 | null): boolean {
    const epsilon = Vec3.EPSILON;
    type BallEntry = { position: Vec3; radius: number; index: number; active: boolean };
    let ball: BallEntry;
    const ab = this._tmpAB.subVectors(r, s);
    const len = ab.length();
    const results = ab.lengthSq() > 0 ? ab.normalize() : ab; // 零向量不除
    const hitResults = this.sectionSubResults;
    const indices = this._tmpIndices;
    let nIndices = 0;
    a[0] = 0;
    a[1] = len;
    a.length = 2;
    for (let n = 0, count = t.length; n !== count; ++n) {
      ball = t[n] as BallEntry;
      if (ball !== e && ball.active) {
        const radiusMix = i + ball.radius;
        if (
          2 === this.intersectSphereADirLen(ball.position, radiusMix, s, results, len, hitResults) &&
          hitResults[1] - hitResults[0] > epsilon
        ) {
          this.sectionsSub(a, hitResults[0], hitResults[1]);
          indices[nIndices++] = ball.index;
        }
      }
    }
    if (a.length > 0) return true;
    if (o) {
      const sp = this._tmpSP;
      let minDepth = Number.MAX_VALUE;
      for (let k = 0; k !== nIndices; ++k) {
        ball = t[indices[k]] as BallEntry;
        sp.subVectors(s, ball.position);
        const depth = i + ball.radius - sp.dot(o);
        if (depth < minDepth) minDepth = depth;
      }
      a[0] = minDepth;
    }
    return false;
  }

  private readonly _tmpResults: number[] = [];
  private readonly _tmpIndices: number[] = [];
  private sectionSubResults: number[] = [];
}

// PCOL 顶冠 singleton（原作即单例导出）
export const sections = new Sections() as Sections;

// PCOL L12470-12551（原模 51）：D 区圆盘（开球区）。
export class DiscRegion extends Plane {
  private _center = new Vec3();
  private _radius = 0;
  private _arcDir = new Vec3();
  private _diameterA = new Vec3();
  private _diameterB = new Vec3();
  private _diameterDir = new Vec3();
  private _geoCenter: Vec3 | null = null;

  get radius(): number {
    return this._radius;
  }
  get center(): Vec3 {
    return this._center;
  }
  get arcDir(): Vec3 {
    return this._arcDir;
  }
  get geoCenter(): Vec3 {
    this._geoCenter ??= this._center.clone().addScaled(this._arcDir, 0.5 * this._radius);
    return this._geoCenter;
  }
  get diameterDir(): Vec3 {
    return this._diameterDir;
  }
  get diameterA(): Vec3 {
    return this._diameterA;
  }
  get diameterB(): Vec3 {
    return this._diameterB;
  }

  /** t=圆心x e=顶面y i=圆心z s=参考点x n=顶面y r=参考点z a=台面法线。 */
  resetWithCenterTopNormal(t: number, e: number, i: number, s: number, n: number, r: number, a: Vec3): void {
    this._center.set(t, e, i);
    this.setWithPointNormal(this._center, a);
    this._arcDir.set(s, n, r).sub(this._center);
    this._radius = this._arcDir.length();
    this._arcDir.normalize();
    this._diameterDir.crossVectors(a, this._arcDir).normalize();
    this._diameterA.interpolate(this._center, this._diameterDir, -this._radius);
    this._diameterB.interpolate(this._center, this._diameterDir, this._radius);
    this._geoCenter = null;
  }

  override projectionInside(t: number, e: number, i: number): boolean {
    const seed = Plane.TmpV.set(t, e, i).sub(this._center);
    if (seed.dot(this._arcDir) < 0) return false;
    const point = Plane.TmpV.set(t, e, i);
    const sd = this.signedDistance(point);
    point.addScaled(this.normal, -sd);
    const center = this._center;
    return point.distanceToSq(center) <= this._radius * this._radius;
  }
}

// PCOL L12552-12610（原模 52）：台面点集多边形有效区域（边法线同向性判定）。
export class PointSetPolygon extends Plane {
  private _ps: Vec3[] = [];
  private _edgeXNormals: Vec3[] = [];
  private _geoCenter: Vec3 | null = null;

  get geoCenter(): Vec3 | null {
    if (!this._geoCenter) {
      const n = this._ps.length;
      if (n === 0) return null;
      const sum = new Vec3();
      for (let i = 0; i !== n; ++i) sum.add(this._ps[i]);
      this._geoCenter = sum.scale(1 / n);
    }
    return this._geoCenter;
  }

  /** t = 台面 ground 多边形（edges/edgeXNormals/normal）。 */
  resetWithAtomPolygon(t: CollisionPolygonLike): void {
    const edges = t.edges;
    for (let i = 0, n = edges.length; i !== n; ++i) {
      const existing = this._ps[i];
      if (existing) existing.copy(edges[i].va);
      else this._ps[i] = edges[i].va.clone();
    }
    this._ps.length = edges.length;
    if (this._ps.length < 3) {
      throw new Error(`err polygon3d, ps count < 3: "${this._ps.length}"`);
    }
    this.setWithPointNormal(this._ps[0], t.normal);
    for (let i = 0, n = t.edgeXNormals.length; i !== n; ++i) {
      const existing = this._edgeXNormals[i];
      if (existing) existing.copy(t.edgeXNormals[i]);
      else this._edgeXNormals[i] = t.edgeXNormals[i].clone();
    }
    this._edgeXNormals.length = t.edgeXNormals.length;
    this._geoCenter = null;
  }

  override projectionInside(t: number, e: number, i: number): boolean {
    const ps = this._ps;
    const xNormals = this._edgeXNormals;
    let seed: number;
    let sign: boolean | null = null;
    for (let h = 0, n = ps.length; h !== n; ++h) {
      Plane.TmpV.set(t, e, i).sub(ps[h]);
      seed = xNormals[h].dot(Plane.TmpV);
      if (!(
        sign === null ||
        (seed > 0 && sign === true) ||
        (seed <= 0 && sign === false)
      )) {
        return false;
      }
      if (sign === null) sign = seed > 0;
    }
    return true;
  }
}

export interface CollisionPolygonLike {
  edges: { va: Vec3 }[];
  edgeXNormals: Vec3[];
  normal: Vec3;
}
