/**
 * PCOL L8969-9184（原模 17）：3×3 矩阵（Float32Array(9)）。
 * 语义约定（与原作一致）：set(9参) 落位后，transform/transformTranspose 的有效矩阵
 * 是参数矩阵的转置；multiply 以存储块为行主序自洽——**含原作的自乘别名行为**
 * （this===t 时写入先于读取，污染后续行，见 AGENTS.md 怪癖 4）。
 */
export class Matrix3 {
  data = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  toArray(target: number[], offset: number): void {
    for (let i = 0; i < this.data.length; i++) {
      target[offset + i] = this.data[i];
    }
  }

  toString(): string {
    const d = this.data;
    return `Mat: [\n\t${d[0]},${d[1]},${d[2]}\n\t${d[3]},${d[4]},${d[5]}\n\t${d[6]},${d[7]},${d[8]}]`;
  }

  /** out = M · v（列主序取列点积）。 */
  transform(v: { x: number; y: number; z: number }, out: { set(x: number, y: number, z: number): unknown }): void {
    const d = this.data;
    const x = v.x * d[0] + v.y * d[1] + v.z * d[2];
    const y = v.x * d[3] + v.y * d[4] + v.z * d[5];
    const z = v.x * d[6] + v.y * d[7] + v.z * d[8];
    out.set(x, y, z);
  }

  transformTranspose(v: { x: number; y: number; z: number }, out: { set(x: number, y: number, z: number): unknown }): void {
    const d = this.data;
    const x = v.x * d[0] + v.y * d[3] + v.z * d[6];
    const y = v.x * d[1] + v.y * d[4] + v.z * d[7];
    const z = v.x * d[2] + v.y * d[5] + v.z * d[8];
    out.set(x, y, z);
  }

  /**
   * 原作 L9012-9021：h[1]=第4参（转置落位）。有效矩阵语义见类头注释。
   */
  set(m00: number, m01: number, m02: number, m10: number, m11: number, m12: number, m20: number, m21: number, m22: number): this {
    const d = this.data;
    d[0] = m00;
    d[1] = m10;
    d[2] = m20;
    d[3] = m01;
    d[4] = m11;
    d[5] = m21;
    d[6] = m02;
    d[7] = m12;
    d[8] = m22;
    return this;
  }

  identity(): this {
    this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
    return this;
  }

  /**
   * 原作 L9017-9019 为 `return (new i).fromArray(this.data)`，因 fromArray 返回 9
   * 导致 clone() 实际返回数字（原作潜在缺陷，游戏内无调用点）。修正为返回矩阵。
   */
  clone(): Matrix3 {
    const m = new Matrix3();
    m.fromArray(this.data);
    return m;
  }

  /** 原始按序拷贝（不做转置），返回 9。 */
  fromArray(source: ArrayLike<number>, offset = 0): number {
    for (let i = 0; i < 9; i++) {
      this.data[i] = source[i + offset];
    }
    return 9;
  }

  copy(m: Matrix3): this {
    const s = m.data;
    this.set(s[0], s[3], s[6], s[1], s[4], s[7], s[2], s[5], s[8]);
    return this;
  }

  multiplyScalar(s: number): this {
    const d = this.data;
    d[0] *= s;
    d[3] *= s;
    d[6] *= s;
    d[1] *= s;
    d[4] *= s;
    d[7] *= s;
    d[2] *= s;
    d[5] *= s;
    d[8] *= s;
    return this;
  }

  multiply(m: Matrix3): this {
    const a = this.data;
    const b = m.data;
    let x = a[0] * b[0] + a[1] * b[3] + a[2] * b[6];
    let y = a[0] * b[1] + a[1] * b[4] + a[2] * b[7];
    let z = a[0] * b[2] + a[1] * b[5] + a[2] * b[8];
    a[0] = x;
    a[1] = y;
    a[2] = z;
    x = a[3] * b[0] + a[4] * b[3] + a[5] * b[6];
    y = a[3] * b[1] + a[4] * b[4] + a[5] * b[7];
    z = a[3] * b[2] + a[4] * b[5] + a[5] * b[8];
    a[3] = x;
    a[4] = y;
    a[5] = z;
    x = a[6] * b[0] + a[7] * b[3] + a[8] * b[6];
    y = a[6] * b[1] + a[7] * b[4] + a[8] * b[7];
    z = a[6] * b[2] + a[7] * b[5] + a[8] * b[8];
    a[6] = x;
    a[7] = y;
    a[8] = z;
    return this;
  }

  add(m: Matrix3): this {
    const d = this.data;
    const s = m.data;
    d[0] += s[0];
    d[1] += s[1];
    d[2] += s[2];
    d[3] += s[3];
    d[4] += s[4];
    d[5] += s[5];
    d[6] += s[6];
    d[7] += s[7];
    d[8] += s[8];
    return this;
  }

  addToDiagonal(d: number): this {
    const data = this.data;
    data[0] += d;
    data[4] += d;
    data[8] += d;
    return this;
  }

  /** 奇异时不抛错：console.warn 后置 identity（PCOL L9100-9110）。 */
  setInverse(m: Matrix3): this {
    const s = m.data;
    const d = this.data;
    const a00 = s[0];
    const a01 = s[1];
    const a02 = s[2];
    const a10 = s[3];
    const a11 = s[4];
    const a12 = s[5];
    const a20 = s[6];
    const a21 = s[7];
    const a22 = s[8];
    const c00 = a22 * a11 - a12 * a21;
    const c01 = a12 * a20 - a22 * a10;
    const c02 = a21 * a10 - a11 * a20;
    const det = a00 * c00 + a01 * c01 + a02 * c02;
    if (det === 0) {
      console.warn("setInverse(): can't invert matrix, determinant is 0");
      return this.identity();
    }
    const inv = 1 / det;
    d[0] = c00 * inv;
    d[1] = (a02 * a21 - a22 * a01) * inv;
    d[2] = (a12 * a01 - a02 * a11) * inv;
    d[3] = c01 * inv;
    d[4] = (a22 * a00 - a02 * a20) * inv;
    d[5] = (a02 * a10 - a12 * a00) * inv;
    d[6] = c02 * inv;
    d[7] = (a01 * a20 - a21 * a00) * inv;
    d[8] = (a11 * a00 - a01 * a10) * inv;
    return this;
  }

  setTranspose(m: Matrix3): this {
    const d = this.data;
    const s = m.data;
    d[0] = s[0];
    d[1] = s[3];
    d[2] = s[6];
    d[3] = s[1];
    d[4] = s[4];
    d[5] = s[7];
    d[6] = s[2];
    d[7] = s[5];
    d[8] = s[8];
    return this;
  }

  transpose(): this {
    let t: number;
    const d = this.data;
    t = d[1];
    d[1] = d[3];
    d[3] = t;
    t = d[2];
    d[2] = d[6];
    d[6] = t;
    t = d[5];
    d[5] = d[7];
    d[7] = t;
    return this;
  }

  /** 邻接于向量的反对称叉乘矩阵 [v]×（列主序等效于标准 [v]×）。 */
  setSkewSymmetric(v: { x: number; y: number; z: number }): this {
    const d = this.data;
    d[0] = d[4] = d[8] = 0;
    d[1] = -v.z;
    d[2] = v.y;
    d[3] = v.z;
    d[5] = -v.x;
    d[6] = -v.y;
    d[7] = v.x;
    return this;
  }

  /** 三个向量按列写入（无返回值，与原作一致 PCOL L9169-9180）。 */
  setComponents(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }): void {
    const d = this.data;
    d[0] = a.x;
    d[1] = b.x;
    d[2] = c.x;
    d[3] = a.y;
    d[4] = b.y;
    d[5] = c.y;
    d[6] = a.z;
    d[7] = b.z;
    d[8] = c.z;
  }
}
