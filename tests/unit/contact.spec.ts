import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { Matrix3 } from "../../src/core/math/matrix3.js";
import { Body } from "../../src/core/physics/body.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { ContactBase, ContactSS, type ContactPoolRef } from "../../src/core/physics/contact.js";
import { TipContact } from "../../src/core/physics/tip-contact.js";

function makePair(): { bi: BodySphere; bj: BodySphere } {
  // 单位球：r=1, m=1 → invInertia = 1/(0.4·1·1²) = 2.5 对角
  const bi = new BodySphere(1, 1, 1, 0, 0);
  const bj = new BodySphere(1, 1, 0, 0, 0);
  return { bi, bj };
}

/** 原作数据流装填法线的公开路径：resetWithBiBj + resetRestingWithPeneNormal。 */
function setupContact(c: ContactSS, bi: Body, bj: Body, normal: Vec3, depth = 0): void {
  c.resetWithBiBj(bi, bj);
  c.resetRestingWithPeneNormal(depth, normal);
}

describe("ContactBase 空间变换（PCOL L9595）", () => {
  it("法线=(0,1,0)：正交基 n/a/o", () => {
    const c = new ContactSS(null, -1);
    const bi = new Body(1);
    const bj = new Body(1);
    setupContact(c, bi, bj, new Vec3(0, 1, 0));

    const l2w = c.spaceTransformL2W;
    const out = new Vec3();
    l2w.transform(new Vec3(1, 0, 0), out);
    expect(out).toEqual({ x: 0, y: 1, z: 0 }); // 局部 x → 法线
    l2w.transform(new Vec3(0, 1, 0), out);
    expect(out).toEqual({ x: 0, y: 0, z: 1 }); // 局部 y → a
    l2w.transform(new Vec3(0, 0, 1), out);
    expect(out).toEqual({ x: 1, y: 0, z: 0 }); // 局部 z → o
  });

  it("法线=(1,0,0) 分支：正交且右手系", () => {
    const c = new ContactSS(null, -1);
    const bi = new Body(1);
    const bj = new Body(1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    const l2w = c.spaceTransformL2W;
    const out = new Vec3();
    l2w.transform(new Vec3(1, 0, 0), out);
    expect(out).toEqual({ x: 1, y: 0, z: 0 });
    l2w.transform(new Vec3(0, 1, 0), out);
    expect(out).toEqual({ x: 0, y: 0, z: -1 }); // a = (0,0,-1)
    l2w.transform(new Vec3(0, 0, 1), out);
    expect(out).toEqual({ x: 0, y: 1, z: 0 }); // o = (0,1,0)
  });
});

describe("ContactSS 相对速度与缓存（PCOL L11646-11668）", () => {
  it("相向运动：closeSpeed = −2 且 relVel 缓存随 vChangedCount 失效", () => {
    const { bi, bj } = makePair();
    const pool: ContactPoolRef = { freeIndex: vi.fn() };
    const c = new ContactSS(pool, 5);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    bi.v.set(-1, 0, 0);
    bj.v.set(1, 0, 0);

    expect(c.getCloseSpeed()).toBe(-2); // (−1,0,0)−(1,0,0)=(−2,0,0) · n=(1,0,0)
    expect(c.getRelativeVelocity()).toEqual({ x: -2, y: 0, z: 0 });

    bi.applyImpulseAtPoint(new Vec3(10, 0, 0), new Vec3(0, 0, 0), 0);
    expect(c.getCloseSpeed()).toBe(8); // (9,0,0)−(1,0,0)
  });

  it("bounceThreshold：gt·normal（World.stepSize setter 对接位）", () => {
    ContactBase.gt.set(0, -0.7259, 0);
    const c = new ContactSS(null, -1);
    const bi = new Body(1);
    const bj = new Body(1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    expect(c.bounceThreshold).toBeCloseTo(0, 12); // gt·X = 0
    // 换法线 → 脏标记重算
    c.resetRestingWithPeneNormal(0, new Vec3(0, 1, 0));
    expect(c.bounceThreshold).toBeCloseTo(-0.7259, 12);
    ContactBase.gt.set(0, 0, 0);
  });
});

describe("ContactSS 力臂与冲量变换（PCOL L11641-11646/11670-11686）", () => {
  it("力臂：armI = −lenI·n（指向接触面）；armJ 反向", () => {
    const { bi, bj } = makePair(); // bi 在 +x
    const c = new ContactSS(null, -1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    expect(c.armI.x).toBeCloseTo(-1, 12);
    expect(c.armJ.x).toBeCloseTo(1, 12);
    expect(c.armLenI).toBe(1);
    expect(c.armLenJ).toBe(1);
  });

  it("冲量-等效速度变换往返：B·B⁻¹ ≈ I", () => {
    const { bi, bj } = makePair();
    const c = new ContactSS(null, -1);
    setupContact(c, bi, bj, new Vec3(0, 1, 0));
    const bInv = c.transformLocVel2Imp; // B⁻¹
    const b = (c as unknown as { _m_imp2LocVel: Matrix3 })._m_imp2LocVel; // B
    const out = new Matrix3().copy(bInv).multiply(b);
    expect(out.data[0]).toBeCloseTo(1, 5);
    expect(out.data[1]).toBeCloseTo(0, 5);
    expect(out.data[2]).toBeCloseTo(0, 5);
    expect(out.data[4]).toBeCloseTo(1, 5);
    expect(out.data[8]).toBeCloseTo(1, 5);
  });

  it("startResting：restitution=min，friction=max；needsUpdateResting 位置敏感", () => {
    const { bi, bj } = makePair();
    bi.restitution = 0.9;
    bj.restitution = 0.4;
    bi.friction = 0.05;
    bj.friction = 0.2;
    const c = new ContactSS(null, -1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    c.startResting();
    expect(c.restitution).toBe(0.4);
    expect(c.friction).toBe(0.2);
    expect(c.needsUpdateResting()).toBe(false);
    bi.position.x += 1;
    expect(c.needsUpdateResting()).toBe(true);
  });

  it("resetWithBiBj 换球 → markObjectChanged（armDirty）", () => {
    const { bi, bj } = makePair();
    const c = new ContactSS(null, -1);
    c.resetWithBiBj(bi, bj);
    expect(c.getRelativeVelocity()).not.toBeNull();
    const armDirty = (c as unknown as { armDirty: boolean });
    armDirty.armDirty = false;
    c.resetWithBiBj(bi, bj); // 相同组合不重标
    expect(armDirty.armDirty).toBe(false);
    const bj2 = new BodySphere(1, 1, 0, 1, 0);
    c.resetWithBiBj(bi, bj2);
    expect(armDirty.armDirty).toBe(true);
    expect(c.idj).toBe(bj2.uid);
  });

  it("free：bi/bj 清空 + 池回收回调 + inUse 翻转", () => {
    const { bi, bj } = makePair();
    const freeIndex = vi.fn();
    const c = new ContactSS({ freeIndex }, 3);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    c.free();
    expect(c.bi).toBeNull();
    expect(c.bj).toBeNull();
    expect(c.inUse).toBe(false);
    expect(freeIndex).toHaveBeenCalledWith(3);
  });

  it("activate：toi=MAX、life=0、inUse", () => {
    const c = new ContactSS(null, -1);
    c.toi = 5;
    c.life = 9;
    c.activate();
    expect(c.toi).toBe(Number.MAX_VALUE);
    expect(c.life).toBe(0);
    expect(c.inUse).toBe(true);
  });

  it("isOutdated：cdRoundI/J 或 killed 标记", () => {
    const { bi, bj } = makePair();
    const c = new ContactSS(null, -1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    c.cdRoundI = bi.cdRound;
    c.cdRoundJ = bj.cdRound;
    expect(c.isOutdated()).toBe(false);
    bi.cdRound++;
    expect(c.isOutdated()).toBe(true);
    c.cdRoundI = bi.cdRound;
    c.markedAsKilled = true;
    expect(c.isOutdated()).toBe(true);
  });

  it("stopResting 唤醒双方", () => {
    const { bi, bj } = makePair();
    bi.setSleep();
    bj.setSleep();
    const c = new ContactSS(null, -1);
    setupContact(c, bi, bj, new Vec3(1, 0, 0));
    c.stopResting();
    expect(bi.asleep).toBe(false);
    expect(bj.asleep).toBe(false);
  });
});

describe("TipContact（PCOL L13645，spec 02 §5）", () => {
  it("击球契约：normal=球心−触点；皮头端速度=方向×力度；半径透传", () => {
    const ball = new BodySphere(0.02625, 1.5, 0, 0, 0);
    const tip = new TipContact(0.15);
    tip.resetTip(ball, [0, -0.02625, 0, 0, 1, 0, 5, 0.011]);
    expect(tip.friction).toBe(0.9);
    expect(tip.restitution).toBe(0);
    expect((tip as unknown as { _normal: Vec3 })._normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(tip.bj!.v).toEqual({ x: 0, y: 5, z: 0 });
    expect(tip.bj!.radius).toBe(0.011);
    expect(tip.bj!.mass).toBe(0.15);
    expect(tip.bj!.invMass).toBeCloseTo(1 / 0.15, 10);
    // 无限质量：invInertia 全零
    expect(Array.from(tip.bj!.invInertia.data)).toEqual(Array.from(new Float32Array(9)));
  });

  it("closeSpeed = −5：皮头以 5 m/s 逼近母球（normal 用公开路径）", () => {
    const ball = new BodySphere(0.02625, 1.5, 0, 0, 0);
    const tip = new TipContact(0.15);
    tip.resetTip(ball, [0, -0.02625, 0, 0, 1, 0, 5, 0.011]);
    tip.markNormalDirty(); // 走公开脏路径重建派生缓存
    expect(tip.getCloseSpeed()).toBeCloseTo(-5, 12);
  });

  it("偏心触点：normal 偏离方向轴（加塞入口的数值形态）", () => {
    const ball = new BodySphere(0.02625, 1.5, 0, 0, 0);
    const tip = new TipContact(0.15);
    // 触点 (0.02, -0.016174902, 0)：normal = (−0.02, 0.01617, 0) 归一
    tip.resetTip(ball, [0.02, -0.016174902, 0, 0, 1, 0, 5, 0.011]);
    const n = (tip as unknown as { _normal: Vec3 })._normal;
    expect(n.x).toBeCloseTo(-0.777540888506361, 10);
    expect(n.y).toBeCloseTo(0.6288323836291659, 10);
  });

  it("free/dispose 语义", () => {
    const ball = new BodySphere(1, 1);
    const tip = new TipContact(0.15);
    tip.resetTip(ball, [0, 0, 0, 0, 1, 0, 5, 0.01]);
    tip.free();
    expect(tip.bi).toBeNull();
    expect(tip.bj).not.toBeNull();
    tip.dispose();
    expect(tip.bj).toBeNull();
    expect(tip.bi).toBeNull();
  });
});
