import type { Vec3 } from "./vec3.js";

/** PCOL L9633-9835（原模 23）：四元数 (x,y,z,w)，语义 1:1。 */
export class Quaternion {
  x = 0;
  y = 0;
  z = 0;
  w = 1;

  constructor(x?: number, y?: number, z?: number, w?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
    this.w = w !== undefined ? w : 1;
  }

  toArray(target: number[], offset: number): void {
    target[offset] = this.x;
    target[offset + 1] = this.y;
    target[offset + 2] = this.z;
    target[offset + 3] = this.w;
  }

  fromArray(source: number[], offset?: number): number {
    const o = offset ?? 0;
    this.x = source[o];
    this.y = source[o + 1];
    this.z = source[o + 2];
    this.w = source[o + 3];
    return 4;
  }

  toString(): string {
    return `{x:${this.x},y:${this.y},z:${this.z},w:${this.w}`;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  setFromAngleAxis(axis: Vec3, angle: number): this {
    const half = Math.sin(angle / 2);
    this.w = Math.cos(angle / 2);
    this.x = axis.x * half;
    this.y = axis.y * half;
    this.z = axis.z * half;
    return this;
  }

  /** 欧拉转四元数（半角三角混合式）；缺省序与 "XYZ" 分支相同；未知序抛错。 */
  setFromEuler(x: number, y: number, z: number, order?: "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY"): this {
    const cx = Math.cos(x / 2);
    const cy = Math.cos(y / 2);
    const cz = Math.cos(z / 2);
    const sx = Math.sin(x / 2);
    const sy = Math.sin(y / 2);
    const sz = Math.sin(z / 2);
    if (order === undefined) {
      this.x = sx * cy * cz + cx * sy * sz;
      this.y = cx * sy * cz - sx * cy * sz;
      this.z = cx * cy * sz + sx * sy * cz;
      this.w = cx * cy * cz - sx * sy * sz;
      return this;
    }
    switch (order) {
      case "XYZ":
        this.x = sx * cy * cz + cx * sy * sz;
        this.y = cx * sy * cz - sx * cy * sz;
        this.z = cx * cy * sz + sx * sy * cz;
        this.w = cx * cy * cz - sx * sy * sz;
        break;
      case "YXZ":
        this.x = sx * cy * cz + cx * sy * sz;
        this.y = cx * sy * cz - sx * cy * sz;
        this.z = cx * cy * sz - sx * sy * cz;
        this.w = cx * cy * cz + sx * sy * sz;
        break;
      case "ZXY":
        this.x = sx * cy * cz - cx * sy * sz;
        this.y = cx * sy * cz + sx * cy * sz;
        this.z = cx * cy * sz + sx * sy * cz;
        this.w = cx * cy * cz - sx * sy * sz;
        break;
      case "ZYX":
        this.x = sx * cy * cz - cx * sy * sz;
        this.y = cx * sy * cz + sx * cy * sz;
        this.z = cx * cy * sz - sx * sy * cz;
        this.w = cx * cy * cz + sx * sy * sz;
        break;
      case "YZX":
        this.x = sx * cy * cz + cx * sy * sz;
        this.y = cx * sy * cz + sx * cy * sz;
        this.z = cx * cy * sz - sx * sy * cz;
        this.w = cx * cy * cz - sx * sy * sz;
        break;
      case "XZY":
        this.x = sx * cy * cz - cx * sy * sz;
        this.y = cx * sy * cz - sx * cy * sz;
        this.z = cx * cy * sz + sx * sy * cz;
        this.w = cx * cy * cz + sx * sy * sz;
        break;
      default:
        throw new Error("Unknown order");
    }
    return this;
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  copy(q: Quaternion): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  /** 零长度 → 重置为单位四元数 (0,0,0,1)（PCOL L9755-9762，与 Vec3 行为不同）。 */
  normalize(): this {
    let len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (len === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    } else {
      len = 1 / len;
      this.x *= len;
      this.y *= len;
      this.z *= len;
      this.w *= len;
    }
    return this;
  }

  /** q' = q + ½·dt·(ω⊗q) 后归一：以 ω 为世界系角速度的一阶步进（PCOL L9764-9778）。 */
  integrate(w: Vec3, dt: number): this {
    const half = dt * 0.5;
    const wx = w.x;
    const wy = w.y;
    const wz = w.z;
    const qw = this.w;
    const qx = this.x;
    const qy = this.y;
    const qz = this.z;

    const nx = (-wx * qx - wy * qy - wz * qz) * half + qw;
    const ny = (wx * qw + wy * qz - wz * qy) * half + qx;
    const nz = (-wx * qz + wy * qw + wz * qx) * half + qy;
    const nw = (wx * qy - wy * qx + wz * qw) * half + qz;

    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    this.w = nx * inv;
    this.x = ny * inv;
    this.y = nz * inv;
    this.z = nw * inv;
    return this;
  }

  /** integrate 系下的对称梯形变体（PCOL L9779-9796），公式照抄不可重排。 */
  integrateQuad(q: Quaternion, wPrev: Vec3, dt: number): this {
    const half = dt * 0.5;
    const wx = wPrev.x;
    const wy = wPrev.y;
    const wz = wPrev.z;
    const qw = q.w;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;

    const nx = (-wx * qx - wy * qy - wz * qz) * half + qw;
    const ny = (wx * qw + wy * qz - wz * qy) * half + qx;
    const nz = (-wx * qz + wy * qw + wz * qx) * half + qy;
    const nw = (wx * qy - wy * qx + wz * qw) * half + qz;

    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    this.w = nx * inv;
    this.x = ny * inv;
    this.y = nz * inv;
    this.z = nw * inv;
    return this;
  }

  /**Hamilton 球面插值；a·b<0 时负端途径取短弧；近同轴退化为 lerp。无返回值（L9797-9813）。 */
  slerpQuaternions(a: Quaternion, b: Quaternion, ratio: number): void {
    let cosHalf = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let flipped = false;
    if (cosHalf < 0) {
      flipped = true;
      cosHalf = -cosHalf;
    }
    let ta: number;
    let tb: number;
    if (cosHalf > 0.999999) {
      ta = 1 - ratio;
      tb = flipped ? -ratio : ratio;
    } else {
      const omega = Math.acos(cosHalf);
      const so = 1 / Math.sin(omega);
      ta = Math.sin((1 - ratio) * omega) * so;
      tb = flipped ? -Math.sin(ratio * omega) * so : Math.sin(ratio * omega) * so;
    }
    this.x = ta * a.x + tb * b.x;
    this.y = ta * a.y + tb * b.y;
    this.z = ta * a.z + tb * b.z;
    this.w = ta * a.w + tb * b.w;
  }

  /** this = this ⊗ b（Hamilton 乘积）。 */
  multiply(q: Quaternion): this {
    const ax = this.x;
    const ay = this.y;
    const az = this.z;
    const aw = this.w;
    const bx = q.x;
    const by = q.y;
    const bz = q.z;
    const bw = q.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
}
