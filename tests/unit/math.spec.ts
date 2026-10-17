import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { Matrix3 } from "../../src/core/math/matrix3.js";
import { Quaternion } from "../../src/core/math/quaternion.js";

const UNIT_X = new Vec3(1, 0, 0);
const UNIT_Y = new Vec3(0, 1, 0);
const UNIT_Z = new Vec3(0, 0, 1);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vec3", () => {
  it("常量与构造：原作静态量与默认值", () => {
    expect(Vec3.EPSILON).toBe(1e-6);
    expect(Vec3.ZERO).toEqual({ x: 0, y: 0, z: 0 });
    expect(Vec3.UNIT_X).toEqual({ x: 1, y: 0, z: 0 });
    expect(Vec3.UNIT_Y).toEqual({ x: 0, y: 1, z: 0 });
    expect(Vec3.UNIT_Z).toEqual({ x: 0, y: 0, z: 1 });
    expect(new Vec3()).toEqual({ x: 0, y: 0, z: 0 });
    expect(new Vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("length/lengthSq/distanceTo(Sq)/dot", () => {
    const v = new Vec3(3, 4, 0);
    expect(v.lengthSq()).toBe(25);
    expect(v.length()).toBe(5);
    expect(v.distanceTo(new Vec3(0, 0, 0))).toBe(5);
    expect(v.distanceToSq(new Vec3(0, 0, 0))).toBe(25);
    expect(v.dot(UNIT_X)).toBe(3);
  });

  it("normalize：奇异输入原地归零（PCOL 怪癖 1）", () => {
    const n = new Vec3(3, 4, 0).normalize();
    expect(n.x).toBeCloseTo(0.6, 15);
    expect(n.y).toBeCloseTo(0.8, 15);
    expect(n.z).toBe(0);
    expect(new Vec3(0, 0, 0).normalize()).toEqual({ x: 0, y: 0, z: 0 });
    expect(new Vec3().normalizeVector(new Vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("scaleVector：标量在前（PCOL 怪癖 1）", () => {
    expect(new Vec3().scaleVector(2, UNIT_X)).toEqual({ x: 2, y: 0, z: 0 });
  });

  it("almostZero/almostEquals：固定 1e-6 阈值（PCOL 怪癖 1）", () => {
    expect(new Vec3(1e-7, -1e-7, 0).almostZero()).toBe(true);
    expect(new Vec3(2e-6, 0, 0).almostZero()).toBe(false);
    expect(new Vec3(2, 2, 6).almostEquals(new Vec3(0, 0, 0))).toBe(false);
    expect(new Vec3(1e-7, 0.1, 0).almostEquals(new Vec3(0, 0.1, 0))).toBe(true);
  });

  it("cross/crossVectors/setCrossThenAdd", () => {
    expect(new Vec3().crossVectors(UNIT_X, UNIT_Y)).toEqual({ x: 0, y: 0, z: 1 });
    expect(new Vec3(3, 2, 0).cross(new Vec3(4, 5, 0))).toEqual({ x: 0, y: 0, z: 7 });
    // setCrossThenAdd 整体覆盖 this（不是累加）：X×Y + (10,20,30)
    expect(
      new Vec3(999, 999, 999).setCrossThenAdd(UNIT_X, UNIT_Y, new Vec3(10, 20, 30))
    ).toEqual({ x: 10, y: 20, z: 31 });
  });

  it("interpolate/addScaled/addVectors/subVectors/lerp/copyNeg/multiply/negate", () => {
    expect(new Vec3().interpolate(new Vec3(1, 1, 1), new Vec3(4, 4, 4), 0.5)).toEqual({ x: 3, y: 3, z: 3 });
    expect(new Vec3(1, 1, 1).addScaled(new Vec3(2, 2, 2), 3)).toEqual({ x: 7, y: 7, z: 7 });
    expect(new Vec3().addVectors(new Vec3(1, 2, 3), new Vec3(10, 20, 30))).toEqual({ x: 11, y: 22, z: 33 });
    expect(new Vec3().subVectors(new Vec3(10, 20, 30), new Vec3(1, 2, 3))).toEqual({ x: 9, y: 18, z: 27 });
    expect(new Vec3(1, 0, 0).lerp(new Vec3(3, 2, 4), 0.5)).toEqual({ x: 2, y: 1, z: 2 });
    expect(new Vec3().copyNeg(new Vec3(1, 2, 3))).toEqual({ x: -1, y: -2, z: -3 });
    expect(new Vec3(1, 2, 3).multiply(new Vec3(2, 0.5, -1))).toEqual({ x: 2, y: 1, z: -3 });
    expect(new Vec3(1, 2, 3).negate()).toEqual({ x: -1, y: -2, z: -3 });
  });

  it("applyQuaternion：X 绕 Y 90° → −Z（规格 01 §3 主动旋转语义）", () => {
    const q = new Quaternion().setFromAngleAxis(UNIT_Y, Math.PI / 2);
    const out = new Vec3().vectorApplyQuaternion(UNIT_X, q);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(-1, 12);
    // 与 applyQuaternion 等价
    expect(new Vec3(1, 0, 0).applyQuaternion(q).z).toBeCloseTo(-1, 12);
  });

  it("vectorApplyQuaternion(p, q)：Z 90° 时 X → Y", () => {
    const q = new Quaternion().setFromAngleAxis(UNIT_Z, Math.PI / 2);
    expect(new Vec3().vectorApplyQuaternion(UNIT_X, q).y).toBeCloseTo(1, 12);
  });

  it("toArray/fromArray/setZero/isZero", () => {
    const buf = [0, 0, 0, 9];
    new Vec3(4, 5, 6).toArray(buf, 1);
    expect(buf).toEqual([0, 4, 5, 6]);
    const v = new Vec3();
    expect(v.fromArray([7, 8, 9], 0)).toBe(3);
    expect(v).toEqual({ x: 7, y: 8, z: 9 });
    expect(new Vec3().isZero()).toBe(true);
    expect(new Vec3(1, 0, 0).isZero()).toBe(false);
    expect(new Vec3(1, 2, 3).setZero()).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("Matrix3", () => {
  it("构造默认 identity", () => {
    expect(Array.from(new Matrix3().data)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("set：行主序入参、列主序存储（PCOL 怪癖 2）", () => {
    const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(Array.from(m.data)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it("transform / transformTranspose：绕 Y 90°（X→−Z）与逆旋转", () => {
    // 有效矩阵 = 参数矩阵的转置（类头注释）：要得到标准 R_y(90°) 须传其转置
    const r = new Matrix3().set(0, 0, -1, 0, 1, 0, 1, 0, 0);
    const out = new Vec3();
    r.transform(UNIT_X, out);
    expect(out).toEqual({ x: 0, y: 0, z: -1 });
    // 逆旋转：X→+Z
    r.transformTranspose(UNIT_X, out);
    expect(out).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("multiply：不同实例无别名，A·B 手算基准", () => {
    const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const b = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    a.multiply(b);
    expect(Array.from(a.data)).toEqual([30, 66, 102, 36, 81, 126, 42, 96, 150]);
  });

  it("multiply：自乘别名语义（原作缺陷级联写回，回归冻结）", () => {
    const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    a.multiply(a); // this === t：写入先于读取（AGENTS.md 怪癖 4）
    expect(Array.from(a.data)).toEqual([30, 66, 102, 94, 205, 316, 681, 1482, 2283]);
  });

  it("multiplyScalar/add/addToDiagonal", () => {
    const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    m.multiplyScalar(2);
    expect(Array.from(m.data)).toEqual([2, 8, 14, 4, 10, 16, 6, 12, 18]);
    m.identity();
    m.add(new Matrix3());
    expect(Array.from(m.data)).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2]);
    m.addToDiagonal(3);
    expect(Array.from(m.data)).toEqual([5, 0, 0, 0, 5, 0, 0, 0, 5]);
  });

  it("setInverse：正交矩阵逆=转置；奇异回退 identity（PCOL 怪癖 2）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noNegZero = (a: Float32Array) => Array.from(a).map((v) => (v === 0 ? 0 : v));
    const r = new Matrix3().set(0, 0, -1, 0, 1, 0, 1, 0, 0);
    const inv = new Matrix3().setInverse(r);
    expect(noNegZero(inv.data)).toEqual(noNegZero(r.clone().transpose().data));
    expect(warn).not.toHaveBeenCalled();

    const fallback = new Matrix3().setInverse(new Matrix3().set(1, 2, 3, 2, 4, 6, 7, 8, 9));
    expect(Array.from(fallback.data)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("setInverse(): can't invert matrix, determinant is 0");
  });

  it("setSkewSymmetric 对应向量叉乘矩阵 v×", () => {
    const skew = new Matrix3().setSkewSymmetric(new Vec3(1, 2, 3));
    const out = new Vec3();
    skew.transform(UNIT_X, out);
    expect(out).toEqual({ x: 0, y: 3, z: -2 }); // v=(1,2,3) × X = (0,3,-2)
  });

  it("setComponents：三个向量按列写入", () => {
    const m = new Matrix3();
    m.setComponents(UNIT_X, UNIT_Y, UNIT_Z); // 原作无返回值，不得链式
    const out = new Vec3();
    m.transform(new Vec3(1, 1, 1), out);
    expect(out).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("copy/clone/setTranspose/transpose 往返", () => {
    const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(Array.from(m.clone().data)).toEqual(Array.from(m.data));
    expect(Array.from(new Matrix3().copy(m).data)).toEqual(Array.from(m.data));
    const t = new Matrix3().setTranspose(m);
    expect(Array.from(t.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    t.transpose();
    expect(Array.from(t.data)).toEqual(Array.from(m.data));
  });

  it("toString", () => {
    expect(new Matrix3().toString()).toContain("Mat: [");
  });
});

describe("Quaternion", () => {
  it("构造默认 (0,0,0,1)", () => {
    expect(new Quaternion()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(new Quaternion(1, 2, 3, 4)).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  it("setFromAngleAxis：Y 90°", () => {
    const q = new Quaternion().setFromAngleAxis(UNIT_Y, Math.PI / 2);
    expect(q.x).toBeCloseTo(0, 15);
    expect(q.y).toBeCloseTo(Math.SQRT1_2, 15);
    expect(q.z).toBeCloseTo(0, 15);
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it("setFromEuler：缺省序与 XYZ 分支一致（PCOL 观察到的实现细节）", () => {
    const a = new Quaternion().setFromEuler(0.3, -0.8, 1.1);
    const b = new Quaternion().setFromEuler(0.3, -0.8, 1.1, "XYZ");
    expect(a).toEqual(b);
  });

  it("setFromEuler：未知序抛错", () => {
    const q = new Quaternion();
    expect(() => q.setFromEuler(0, 0, 0, "XYX" as "XYZ")).toThrow("Unknown order");
  });

  it("multiply：X90 ⊗ X90 = X180；应用后 Y → −Y", () => {
    const x90 = new Quaternion().setFromEuler(Math.PI / 2, 0, 0);
    const x180 = new Quaternion().copy(x90).multiply(x90);
    expect(new Vec3(0, 1, 0).applyQuaternion(x180).y).toBeCloseTo(-1, 12);
  });

  it("normalize：零长度重置为单位四元数（PCOL 怪癖 3，区别于 Vec3）", () => {
    expect(new Quaternion(0, 0, 0, 0).normalize()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    const scaled = new Quaternion(0, 2, 0, 2).normalize();
    expect(scaled.y).toBeCloseTo(0.7071067811865476, 15);
    expect(scaled.w).toBeCloseTo(0.7071067811865476, 15);
  });

  it("integrate：与解析旋转在细分步进下收敛", () => {
    const omega = UNIT_Y; // 1 rad/s
    const q = new Quaternion();
    const steps = 1000;
    const dt = Math.PI / steps; // 累计旋转 π（90°*2）
    for (let i = 0; i < steps; i++) {
      q.integrate(omega, dt);
    }
    const target = new Quaternion().setFromAngleAxis(UNIT_Y, Math.PI);
    // 一阶积分的条件性偏移在多步细分下量化到目标附近
    expect(q.x).toBeCloseTo(target.x, 2);
    expect(q.y).toBeCloseTo(target.y, 2);
    expect(q.w).toBeCloseTo(target.w, 2);
    // 且始终是单位（长度恒 1）
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    expect(len).toBeCloseTo(1, 10);
  });

  it("integrateQuad 与 integrate 公式结构一致（对恒等目标等价）", () => {
    const identity = new Quaternion().setFromAngleAxis(UNIT_Y, 0);
    const omega = UNIT_Y;
    const dt = Math.PI / 2;
    const viaIntegrate = new Quaternion(0, 0, 0, 1).integrate(omega, dt);
    const viaQuad = new Quaternion(0, 0, 0, 1).integrateQuad(identity, omega, dt);
    expect(viaQuad).toEqual(viaIntegrate);
  });

  it("slerpQuaternions：identity→Y90 中点即 Y45（原作无返回值，写入自身）", () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion().setFromAngleAxis(UNIT_Y, Math.PI / 2);
    const mid = new Quaternion();
    mid.slerpQuaternions(a, b, 0.5);
    expect(mid.y).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(mid.w).toBeCloseTo(Math.cos(Math.PI / 8), 12);
    // 端点
    const zero = new Quaternion();
    zero.slerpQuaternions(a, b, 0);
    expect(zero).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    const one = new Quaternion();
    one.slerpQuaternions(a, b, 1);
    expect(one).toEqual(b);
  });

  it("slerpQuaternions 近同轴（cos>0.999999）走 lerp 分支且不抛错", () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 1e-7, 0, 1).normalize();
    const out = new Quaternion();
    out.slerpQuaternions(a, b, 0.5);
    expect(out).not.toBeNull();
  });

  it("toArray/fromArray", () => {
    const buf = new Array<number>(4).fill(0);
    new Quaternion(1, 2, 3, 4).toArray(buf, 0);
    expect(buf).toEqual([1, 2, 3, 4]);
    const q = new Quaternion();
    expect(q.fromArray([5, 6, 7, 8])).toBe(4);
    expect(q).toEqual({ x: 5, y: 6, z: 7, w: 8 });
  });
});
