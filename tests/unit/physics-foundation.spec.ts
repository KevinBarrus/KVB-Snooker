import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { Quaternion } from "../../src/core/math/quaternion.js";
import { PHYSICS, getGravityDir, setBallFrictionAndRestitution, setPolyFrictionAndRestitution } from "../../src/core/physics/constants.js";
import { Body } from "../../src/core/physics/body.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { SeededRandom, setCoreRandom } from "../../src/core/rng.js";

const UNIT_Y = new Vec3(0, 1, 0);

/** 原作语义备忘：v/w 只经 predVelocities / applyImpulse 路径被置脏；
 *  测试里手工 set 后需手动置脏，否则 getter 读到旧缓存（与原作一致）。 */
function markDirty(b: Body): void {
  b.vProp_dirty = true;
  b.wProp_dirty = true;
  b.__vStateDirty = true;
}

afterEach(() => {
  vi.restoreAllMocks();
  setCoreRandom(null);
  Body.minEnergy = NaN;
  Body.maxEnergy = NaN;
  Body.wakeUpEnergy = NaN;
});

describe("physics/constants（PCOL L8932 常量表逐值）", () => {
  it("全量数值断言", () => {
    expect(PHYSICS.gravity).toEqual({ x: 0, y: -19, z: 0 });
    expect(PHYSICS.tPrecision).toBe(3e-4);
    expect(PHYSICS.islandUpdMinDisSq).toBe(0.1);
    expect(PHYSICS.airAngularDamping).toBe(0.99);
    expect(PHYSICS.frictionS).toBe(0.01);
    expect(PHYSICS.frictionP).toBe(0.15);
    expect(PHYSICS.restitution).toEqual({
      ball: 0.985,
      ground: 0.3,
      sidehard: 0.92,
      sidesoft: 0.45,
      tunnel: 0,
      pocket: 0.002,
      default: 0.5
    });
  });

  it("getGravityDir 缓存归一", () => {
    const dir = getGravityDir();
    expect(dir.y).toBeCloseTo(-1, 15);
    expect(dir.x).toBe(0);
  });

  it("setBall / setPoly 摩擦弹性查表", () => {
    const ball = { friction: 0, restitution: 0 };
    setBallFrictionAndRestitution(ball);
    expect(ball).toEqual({ friction: 0.01, restitution: 0.985 });

    const poly = { sidehard: true, friction: 0, restitution: 0 };
    setPolyFrictionAndRestitution(poly as typeof poly & Record<string, unknown>);
    expect(poly.restitution).toBe(0.92);
    expect(poly.friction).toBe(0.15);

    const plain = { friction: 0, restitution: 0 };
    setPolyFrictionAndRestitution(plain);
    expect(plain.restitution).toBe(0.5);
  });
});

describe("Body（PCOL L11324 刚体基类）", () => {
  it("构造默认值：uid=-1、invMass、位置与欧拉姿态", () => {
    const identity = new Body(2, 1, 2, 3);
    expect(identity.uid).toBe(-1);
    expect(identity.active).toBe(true);
    expect(identity.invMass).toBe(0.5);
    expect(identity.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(identity.orientation).toEqual(new Quaternion().setFromEuler(0, 0, 0));
    expect(identity.serializable).toBe(true);
    expect(identity.collisionGroup).toBe(1);

    const rotated = new Body(2, 0, 0, 0, 0.1, 0.2, 0.3);
    expect(rotated.orientation).toEqual(new Quaternion().setFromEuler(0.1, 0.2, 0.3));
    expect(rotated.orientation).not.toEqual(identity.orientation);

    // statics：未设定前 minEnergy 为 NaN，energy 构造时取该值（同原作）
    expect(Body.baseSleepBias).toBe(0.3);
    expect(identity.energy).toBe(NaN);
    expect(Body.vStates).toEqual({ ZERO: 0, SLOWER: 1, FASTER: 2, DIR_CHANGE: 3 });
  });

  it("两个刚体的 acc 独立（gravity.clone 语义）", () => {
    const a = new Body(1);
    const c = new Body(1);
    a.applyForce(new Vec3(0, -5, 0));
    expect(a.acc.y).toBeCloseTo(-24, 12);
    expect(c.acc.y).toBe(-19);
  });

  it("reset 后 acc 回到基准重力且速度清零", () => {
    const b = new Body(1);
    b.applyForce(new Vec3(0, -5, 0));
    b.reset(0, 0, 0);
    expect(b.acc).toEqual({ x: 0, y: -19, z: 0 });
    expect(b.v).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.asleep).toBe(false);
  });

  it("predVelocities：acc·dt 与角阻尼；rf 钳制走位（PCOL 怪癖 4）", () => {
    const b = new Body(1);
    b.v.set(3, 0.5, 0);
    b.w.set(1.5, 0.5, 0);
    b.rfDir.set(0, 3, 0);
    b.rfPower = 2;
    b.predVelocities(0.5);
    // v += acc·dt → (3, 0.5 - 9.5, 0)
    expect(b.v.x).toBe(3);
    expect(b.v.y).toBeCloseTo(-9, 12);
    // rf = rfDir 归一×rfPower = (0,2,0)；w 各轴按分量钳制：x 分量 rf=0 不受钳，1.5×0.99
    expect(b.w.x).toBeCloseTo(1.5 * 0.99, 12);
    expect(b.w.y).toBe(0);
    expect(b.w.z).toBe(0);
    expect(b.rfPower).toBe(0);
    expect(b.rfDir).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.vChangedCount).toBe(1);
  });

  it("step：睡眠保持 / 位置积分 / acc 复位 / steppedLenSq 学分", () => {
    const asleepBody = new Body(1);
    asleepBody.setSleep();
    expect(asleepBody.step(0.1)).toBe(true);
    expect(asleepBody.steppedLenSq).toBe(0);

    Body.minEnergy = 0.001;
    Body.maxEnergy = 10;
    const b = new Body(1, 0, 0, 0);
    b.v.set(2, 0, 0);
    markDirty(b); // 真实流程中 predVelocities 已置脏
    expect(b.step(0.5)).toBe(false);
    expect(b.position.x).toBeCloseTo(1, 12);
    expect(b.acc).toEqual({ x: 0, y: -19, z: 0 });
    expect(b.steppedLenSq).toBeCloseTo(4 * 0.5, 12);
  });

  it("step：能量衰减入眠（返回 true，v/w 清零）", () => {
    Body.minEnergy = 1;
    Body.maxEnergy = 10;
    const b = new Body(1); // energy = minEnergy = 1
    expect(b.step(1)).toBe(true);
    expect(b.asleep).toBe(true);
    expect(b.energy).toBe(0);
    expect(b.v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("step：能量上限钳制到 maxEnergy", () => {
    Body.minEnergy = 0.001;
    Body.maxEnergy = 5;
    const b = new Body(1); // energy = 0.001
    b.v.set(10, 0, 0);
    markDirty(b);
    expect(b.step(1)).toBe(false);
    // i = 0.3·0.001 + 0.7·100 = 70 → 钳制 5
    expect(b.energy).toBeCloseTo(5, 12);
  });

  it("applyImpulseAtPoint：v+=冲量·invMass，w+=invInertia(e×t)，rfDir 累加扭矩", () => {
    const b = new Body(1);
    b.applyImpulseAtPoint(new Vec3(1, 0, 0), new Vec3(0, 1, 0), 0.3);
    expect(b.v).toEqual({ x: 1, y: 0, z: 0 });
    expect(b.w).toEqual({ x: 0, y: 0, z: -1 }); // (0,1,0)×(1,0,0)
    expect(b.rfPower).toBe(0.3);
    expect(b.rfDir).toEqual({ x: 0, y: 0, z: -1 });
    expect(b.canSleep).toBe(true);
    expect(b.asleep).toBe(false);
    expect(b.vChangedCount).toBe(1);
  });

  it("addPeneOffset：取更负者，深度<-0.001 唤醒；step 应用修正并令 canSleep=false", () => {
    const b = new Body(1);
    b.addPeneOffset(-0.002, new Vec3(0, 1, 0));
    b.setSleep();
    b.addPeneOffset(-0.0025, new Vec3(0, 1, 0));
    expect(b.penetration).toBe(-0.0025);
    expect(b.asleep).toBe(false);
    b.predVelocities(0.01);
    expect(b.step(0.01)).toBe(false);
    // 起点原点：v 经 acc·dt=(0,-0.19,0)，位置积 (0,-19·0.01²,0)，再 + peneOffset(0,1,0)
    expect(b.position.y).toBeCloseTo(1 - 19 * 0.0001, 10);
    expect(b.penetration).toBe(0);
    expect(b.canSleep).toBe(false);
  });

  it("updateVProps：低于 EPSILON 原地清零（PCOL 怪癖）", () => {
    const b = new Body(1);
    b.v.set(1e-9, 0, 0);
    b.updateVProps();
    expect(b.vProp_sq).toBe(0);
    expect(b.v).toEqual({ x: 0, y: 0, z: 0 });
    // 正常值：dir 缩放
    const c = new Body(1);
    c.v.set(3, 4, 0);
    c.updateVProps();
    expect(c.vProp_sq).toBe(25);
    expect(c.vDir.x).toBeCloseTo(0.6, 15);
    expect(c.vDir.y).toBeCloseTo(0.8, 15);
    expect(c.vDir.z).toBe(0);
  });

  it("updateVState：ZERO/FASTER/SLOWER/DIR_CHANGE 四分支", () => {
    // ZERO：v 为零
    const z = new Body(1);
    z.updateVState();
    expect(z.__vState).toBe(0);
    // FASTER：vSq > vProp0_sq
    const f = new Body(1);
    f.v.set(1, 0, 0);
    f.updateVProps();
    markDirty(f);
    f.updateVState();
    expect(f.__vState).toBe(2);
    // SLOWER：同向等速（dot=1 ≥ 1−ε）
    const s = new Body(1);
    s.v.set(5, 0, 0);
    s.vProp0_dir.set(5, 0, 0);
    s.vProp0_sq = 25;
    s.updateVProps();
    s.updateVState();
    expect(s.__vState).toBe(1);
    // DIR_CHANGE：反向（dot=-1 < 1−ε）
    s.v.set(-5, 0, 0);
    s.vProp_dirty = true;
    s.updateVState();
    expect(s.__vState).toBe(3);
  });

  it("getMotion：vSq + wSq（置脏后读取）", () => {
    const b = new Body(1);
    b.v.set(1, 0, 0);
    b.w.set(2, 0, 0);
    markDirty(b);
    expect(b.getMotion()).toBe(5);
  });

  it("serialize ↔ deserialize 全字段往返", () => {
    Body.minEnergy = 0.05;
    Body.maxEnergy = 0.6;
    Body.wakeUpEnergy = 0.07;
    const src = new BodySphere(0.02625, 1.5, 0.1, 0.2, 0.3, 0, 0.4, 0);
    src.uid = 7;
    src.v.set(0.5, -1.25, 0.75);
    src.w.set(0.11, 0.22, 0.33);
    src.predVelocities(0.0167);
    src.step(0.0167);
    const data: number[] = [];
    src.serialize(data);

    const dst = new BodySphere(0.02625, 1.5);
    // 原作 deserialize 不恢复 uid（由 World._rebuildEnvironment 重排）
    expect(data[0]).toBe(7);
    const next = dst.deserialize(data, 0);
    expect(next).toBe(data.length);
    expect(dst.active).toBe(true);
    expect(dst.mass).toBe(1.5);
    expect(dst.invMass).toBeCloseTo(2 / 3, 12);
    expect(dst.energy).toBeCloseTo(src.energy, 14);
    expect(dst.position).toEqual(src.position);
    expect(dst.orientation).toEqual(src.orientation);
    expect(dst.acc).toEqual(src.acc);
    expect(dst.vSq).toBeCloseTo(src.vSq, 14);
    expect(dst.steppedLenSq).toBeCloseTo(src.steppedLenSq, 14);
    expect(dst.vChangedCount).toBe(src.vChangedCount);
  });

  it("serialize：非可序列化体写播种标记（AGENTS 怪癖 6，登记差异：确定性替代随机）", () => {
    setCoreRandom(new SeededRandom(42));
    const b = new Body(1);
    b.serializable = false;
    const data: number[] = [];
    b.serialize(data);
    expect(data[0]).toBeLessThan(0);

    setCoreRandom(new SeededRandom(42));
    const other = new Body(1);
    other.serializable = false;
    const again: number[] = [];
    other.serialize(again);
    expect(again[0]).toBe(data[0]);
  });

  it("serialize：失活体快路径；uid<-1 标记在反序列化走 1 位跳过", () => {
    const b = new Body(1);
    b.uid = 3;
    b.active = false;
    const data: number[] = [];
    b.serialize(data);
    expect(data).toEqual([3, 0]);
    const dst = new Body(1);
    const next = dst.deserialize(data, 0);
    expect(next).toBe(2);
    expect(dst.active).toBe(false);

    // uid=-1 + active → 首位 <0 触发跳过路径（原作语义：由解析方甄别）
    const edge = new Body(1);
    edge.active = false;
    const edgeData: number[] = [];
    edge.serialize(edgeData);
    const fresh = new Body(1);
    expect(fresh.deserialize(edgeData, 0)).toBe(1);
  });

  it("setSleep / wakeUp 能量与速度语义", () => {
    Body.minEnergy = 0.2;
    Body.wakeUpEnergy = 0.3;
    const b = new Body(1);
    b.v.set(1, 0, 0);
    b.setSleep();
    expect(b.asleep).toBe(true);
    expect(b.energy).toBe(0);
    expect(b.v).toEqual({ x: 0, y: 0, z: 0 });
    b.wakeUp();
    expect(b.asleep).toBe(false);
    expect(b.energy).toBe(0.3);
  });
});

describe("BodySphere（PCOL L11577）", () => {
  it("实心球惯量 invInertia = 1/(0.4·m·r²)", () => {
    const ball = new BodySphere(0.02625, 1.5, 0.1, 0.2, 0.3);
    const expected = 1 / (0.4 * 1.5 * 0.02625 * 0.02625);
    // invInertia 存 Float32Array，精度按 3 位小数校验
    expect(ball.invInertia.data[0]).toBeCloseTo(expected, 3);
    expect(ball.invInertia.data[4]).toBeCloseTo(expected, 3);
    expect(ball.invInertia.data[8]).toBeCloseTo(expected, 3);
    expect(ball.invInertia.data[1]).toBe(0);
    expect(ball.radiusSq).toBeCloseTo(0.02625 ** 2, 15);
  });

  it("getMotion：vSq + wSq·r²（Sphere 加权 vs 基类裸相加）", () => {
    const ball = new BodySphere(2, 1);
    ball.v.set(1, 0, 0);
    ball.w.set(0, 1, 0);
    markDirty(ball);
    expect(ball.getMotion()).toBe(1 + 1 * 4);

    const base = new Body(1);
    base.v.set(1, 0, 0);
    base.w.set(0, 1, 0);
    markDirty(base);
    expect(base.getMotion()).toBe(2);
  });

  it("syncStates：位置视觉插值 + 姿态半步跟随", () => {
    const ball = new BodySphere(1, 1, 1, 0, 0);
    ball.v.set(2, 0, 0);
    ball.w.set(0, 2, 0);
    markDirty(ball);
    ball.syncStates(0.25);
    expect(ball.states.position).toEqual({ x: 1.5, y: 0, z: 0 });
    const o = ball.states.orientation;
    const len = o.x * o.x + o.y * o.y + o.z * o.z + o.w * o.w;
    expect(len).toBeCloseTo(1, 12);
    expect(o.y).toBeGreaterThan(0);
  });
});
