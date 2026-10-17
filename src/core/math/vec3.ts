import type { Quaternion } from "./quaternion.js";

/** PCOL L8500-8778（原模 12）：三维向量类，语义 1:1。 */
export class Vec3 {
  x = 0;
  y = 0;
  z = 0;

  static readonly ZERO = new Vec3(0, 0, 0);
  static readonly UNIT_X = new Vec3(1, 0, 0);
  static readonly UNIT_Y = new Vec3(0, 1, 0);
  static readonly UNIT_Z = new Vec3(0, 0, 1);
  static readonly EPSILON = 1e-6;

  constructor(x?: number, y?: number, z?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
  }

  toArray(target: number[], offset: number): void {
    target[offset] = this.x;
    target[offset + 1] = this.y;
    target[offset + 2] = this.z;
  }

  fromArray(source: number[], offset?: number): number {
    const o = offset ?? 0;
    this.x = source[o];
    this.y = source[o + 1];
    this.z = source[o + 2];
    return 3;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setZero(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  copyNeg(v: Vec3): this {
    this.x = -v.x;
    this.y = -v.y;
    this.z = -v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  /** PCOL L8555-8564：零向量原地归零后返回。 */
  normalize(): this {
    const len = this.length();
    if (len > 0) {
      const inv = 1 / len;
      this.x *= inv;
      this.y *= inv;
      this.z *= inv;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }
    return this;
  }

  normalizeVector(v: Vec3): this {
    const len = v.length();
    if (len > 0) {
      const inv = 1 / len;
      this.x = v.x * inv;
      this.y = v.y * inv;
      this.z = v.z * inv;
    } else {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }
    return this;
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  /** this = a + b·ratio */
  interpolate(a: Vec3, b: Vec3, ratio: number): this {
    this.x = a.x + b.x * ratio;
    this.y = a.y + b.y * ratio;
    this.z = a.z + b.z * ratio;
    return this;
  }

  addVectors(a: Vec3, b: Vec3): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  subVectors(a: Vec3, b: Vec3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  /** this = this × v */
  cross(v: Vec3): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }

  crossVectors(a: Vec3, b: Vec3): this {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    this.x = ay * b.z - az * b.y;
    this.y = az * b.x - ax * b.z;
    this.z = ax * b.y - ay * b.x;
    return this;
  }

  /** this = a × b + c */
  setCrossThenAdd(a: Vec3, b: Vec3, c: Vec3): this {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    this.x = ay * b.z - az * b.y + c.x;
    this.y = az * b.x - ax * b.z + c.y;
    this.z = ax * b.y - ay * b.x + c.z;
    return this;
  }

  distanceToSq(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  /** 参序为标量在前：this = s · v（PCOL L8678-8682）。 */
  scaleVector(s: number, v: Vec3): this {
    this.x = s * v.x;
    this.y = s * v.y;
    this.z = s * v.z;
    return this;
  }

  multiply(v: Vec3): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  isZero(): boolean {
    return this.x === 0 && this.y === 0 && this.z === 0;
  }

  /** 阈值固定 Vec3.EPSILON，与原作一致不得参数化（PCOL L8718-8720）。 */
  almostZero(threshold?: number): boolean {
    const t = threshold ?? Vec3.EPSILON;
    return !(Math.abs(this.x) > t || Math.abs(this.y) > t || Math.abs(this.z) > t);
  }

  /** 阈值固定 Vec3.EPSILON，与原作一致不得参数化（PCOL L8721-8724）。 */
  almostEquals(v: Vec3): boolean {
    const eps = Vec3.EPSILON;
    return !(
      Math.abs(this.x - v.x) > eps ||
      Math.abs(this.y - v.y) > eps ||
      Math.abs(this.z - v.z) > eps
    );
  }

  toString(): string {
    return `{${this.x}, ${this.y}, ${this.z}}`;
  }

  lerp(v: Vec3, ratio: number): this {
    this.x += (v.x - this.x) * ratio;
    this.y += (v.y - this.y) * ratio;
    this.z += (v.z - this.z) * ratio;
    return this;
  }

  /** this = 1⊗q_activeRotation(q)·this，标准右手系主动旋转（X 绕 Y 90° → −Z）。 */
  applyQuaternion(q: Quaternion): this {
    const vx = this.x;
    const vy = this.y;
    const vz = this.z;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }

  /** vectorApplyQuaternion(p, q)：this = q 主动旋转 p（PCOL L8756-8772）。 */
  vectorApplyQuaternion(p: Vec3, q: Quaternion): this {
    const px = p.x;
    const py = p.y;
    const pz = p.z;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

    const ix = qw * px + qy * pz - qz * py;
    const iy = qw * py + qz * px - qx * pz;
    const iz = qw * pz + qx * py - qy * px;
    const iw = -qx * px - qy * py - qz * pz;

    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
}
