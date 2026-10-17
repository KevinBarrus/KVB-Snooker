import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { Body } from "../../src/core/physics/body.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { ContactBase, ContactSS } from "../../src/core/physics/contact.js";
import { TipContact } from "../../src/core/physics/tip-contact.js";
import { Solver } from "../../src/core/physics/solver.js";

function markDirty(body: Body): void {
  body.vProp_dirty = true;
  body.wProp_dirty = true;
  body.__vStateDirty = true;
  body.vChangedCount++;
}

function makeContact(bi = new BodySphere(1, 1, 2), bj = new BodySphere(1, 1), depth = 0): ContactSS {
  const contact = new ContactSS(null, -1);
  contact.resetWithBiBj(bi, bj);
  contact.resetRestingWithPeneNormal(depth, new Vec3(1, 0, 0));
  return contact;
}

function makeIsland(...contacts: ContactBase[]): Parameters<Solver["solveIsland"]>[0] {
  contacts.forEach((contact, index) => { contact.next = contacts[index + 1] ?? null; });
  return { dirty: true, totalItems: contacts.length, itemEntry: contacts[0] ?? null, next: null };
}

afterEach(() => {
  vi.restoreAllMocks();
  ContactBase.gt.setZero();
});

describe("Solver.solveContact（PCOL L9337-9367）", () => {
  it("sharedInstance 为同一 Solver，默认迭代上限为 4", () => {
    expect(Solver.sharedInstance).toBeInstanceOf(Solver);
    expect(new Solver().maxIter).toBe(4);
  });

  it.each([1, 0.17])("等质量弹性交换，m=%s：动量守恒、无自旋", mass => {
    const bi = new BodySphere(0.02625, mass, 0.0525);
    const bj = new BodySphere(0.02625, mass);
    const contact = makeContact(bi, bj);
    contact.restitution = 1;
    bi.v.set(-2, 0, 0);
    bj.v.set(1, 0, 0);
    markDirty(bi);
    markDirty(bj);
    const momentum = mass * (bi.v.x + bj.v.x);
    expect(contact.getCloseSpeed()).toBe(-3);

    new Solver().solveContact(contact);

    expect(bi.v.x).toBeCloseTo(1, 6);
    expect(bj.v.x).toBeCloseTo(-2, 6);
    expect(mass * (bi.v.x + bj.v.x)).toBeCloseTo(momentum, 12);
    expect(bi.w.lengthSq()).toBe(0);
    expect(bj.w.lengthSq()).toBe(0);
    expect(contact.getCloseSpeed()).toBeCloseTo(3, 6);
  });

  it.each([-0.25, -0.5, -1])("bounceThreshold=-0.5：法向速度 %s 的恢复分支", speed => {
    ContactBase.gt.set(-0.5, 0, 0);
    const contact = makeContact();
    contact.restitution = 1;
    contact.bi!.v.set(speed, 0, 0);
    markDirty(contact.bi!);

    new Solver().solveContact(contact);

    expect(contact.getCloseSpeed()).toBeCloseTo(speed >= -0.5 ? 0 : -speed, 6);
  });

  it("双切向冲量超过库仑锥时按比例截断，双方获得反向冲量", () => {
    const contact = makeContact();
    const bi = contact.bi!;
    const bj = contact.bj!;
    bi.v.set(-1, 6, 8);
    markDirty(bi);
    contact.friction = 0.2;
    const before = bi.v.clone();

    new Solver().solveContact(contact);

    const impulse = bi.v.clone().sub(before).scale(bi.mass);
    expect(impulse.x).toBeCloseTo(0.5, 6);
    expect(Math.hypot(impulse.y, impulse.z)).toBeCloseTo(0.2 * impulse.x, 6);
    expect(impulse.y).toBeCloseTo(-0.06, 6);
    expect(impulse.z).toBeCloseTo(-0.08, 6);
    expect(bj.v.clone().scale(bj.mass).add(impulse).length()).toBeCloseTo(0, 12);
    expect(bi.w.y).toBeCloseTo(-0.2, 6);
    expect(bi.w.z).toBeCloseTo(0.15, 6);
  });

  it("锥内切向冲量不截断，消除接触点切向相对速度", () => {
    const contact = makeContact();
    contact.friction = 0.9;
    contact.bi!.v.set(-1, 0.1, 0.2);
    markDirty(contact.bi!);

    new Solver().solveContact(contact);

    expect(contact.getRelativeVelocity().length()).toBeCloseTo(0, 6);
  });

  it("滚动摩擦单独按法向冲量/各自力臂传入，不改变平动冲量", () => {
    const bi = new BodySphere(2, 1, 3);
    const bj = new BodySphere(1, 1);
    const contact = makeContact(bi, bj);
    contact.rollingFriction = 0.3;
    contact.friction = 0.2;
    bi.v.set(-2, 1, 0);
    markDirty(bi);
    const applyI = vi.spyOn(bi, "applyImpulseAtPoint");
    const applyJ = vi.spyOn(bj, "applyImpulseAtPoint");

    new Solver().solveContact(contact);

    expect(bi.v.x).toBeCloseTo(-1, 6);
    expect(bj.v.x).toBeCloseTo(-1, 6);
    expect(applyI.mock.calls[0][2]).toBeCloseTo(0.15, 6);
    expect(applyJ.mock.calls[0][2]).toBeCloseTo(0.3, 6);
    expect(bi.rfPower).toBeCloseTo(0.15, 6);
    expect(bj.rfPower).toBeCloseTo(0.3, 6);
    expect(bi.rfDir.length()).toBeGreaterThan(0);
    expect(bj.rfDir.length()).toBeGreaterThan(0);
  });

  it.each([0, 0.012])("TipContact 偏移 %s：正杆无旋转，偏心产生加塞，仅作用于 I 侧", offset => {
    const radius = 0.02625;
    const ball = new BodySphere(radius, 0.17);
    const tip = new TipContact(0.15);
    tip.resetTip(ball, [-Math.sqrt(radius * radius - offset * offset), offset, 0, 1, 0, 0, 5, 0.011]);
    const tipVelocity = tip.bj!.v.clone();
    const applyTip = vi.spyOn(tip.bj!, "applyImpulseAtPoint");

    new Solver().solveContact(tip);

    expect(ball.v.x).toBeGreaterThan(0);
    expect(ball.w.x).toBeCloseTo(0, 6);
    expect(ball.w.y).toBeCloseTo(0, 6);
    if (offset === 0) {
      expect(ball.w.z).toBeCloseTo(0, 6);
      expect(ball.v.x).toBeCloseTo(5 * 0.15 / (0.17 + 0.15), 6);
    } else {
      const invInertia = 1 / (0.4 * ball.mass * radius * radius);
      const tangentResponse = ball.invMass + tip.bj!.invMass + radius * radius * invInertia;
      expect(ball.w.z).toBeCloseTo(-5 * offset * invInertia / tangentResponse, 4);
    }
    expect(applyTip).not.toHaveBeenCalled();
    expect(tip.bj!.v).toEqual(tipVelocity);
    expect(tip.bj!.w.lengthSq()).toBe(0);
  });
});

describe("Solver.solveIsland（PCOL L9386-9413）", () => {
  it("重叠球双方各退半个穿透量，经 Body.step 后贴住", () => {
    const bi = new BodySphere(1, 1, 1.8);
    const bj = new BodySphere(1, 1);
    const island = makeIsland(makeContact(bi, bj, -0.2));

    new Solver().solveIsland(island);

    expect(island.dirty).toBe(false);
    expect(bi.position.x).toBe(1.8);
    expect(bj.position.x).toBe(0);
    expect(bi.peneOffset.x).toBeCloseTo(0.1, 12);
    expect(bj.peneOffset.x).toBeCloseTo(-0.1, 12);
    bi.step(0);
    bj.step(0);
    expect(bi.position.distanceTo(bj.position)).toBeCloseTo(2, 12);
    expect(bi.canSleep).toBe(false);
    expect(bj.canSleep).toBe(false);
  });

  it("穿透等于 −EPSILON 不修正", () => {
    const contact = makeContact(undefined, undefined, -Vec3.EPSILON);
    new Solver().solveIsland(makeIsland(contact));
    expect(contact.bi!.penetration).toBe(0);
    expect(contact.bj!.penetration).toBe(0);
  });

  it("非 SS 穿透只登记 I 侧偏移", () => {
    const contact = makeContact(undefined, undefined, -0.2);
    contact.isSS = false;
    new Solver().solveIsland(makeIsland(contact));
    expect(contact.bi!.peneOffset.x).toBeCloseTo(0.1, 12);
    expect(contact.bj!.penetration).toBe(0);
    expect(contact.bj!.peneOffset.lengthSq()).toBe(0);
  });

  it("三球链每次重选最负闭速度，并使用冲量置脏后的新速度", () => {
    const left = new BodySphere(1, 1, 0);
    const middle = new BodySphere(1, 1, 2);
    const right = new BodySphere(1, 1, 4);
    middle.v.set(-1, 0, 0);
    right.v.set(-3, 0, 0);
    markDirty(middle);
    markDirty(right);
    const first = makeContact(middle, left);
    const second = makeContact(right, middle);
    first.restitution = second.restitution = 1;
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveContact");

    solver.solveIsland(makeIsland(first, second));

    expect(solve.mock.calls.map(([contact]) => contact)).toEqual([second, first, second]);
    expect(first.getCloseSpeed()).toBeGreaterThanOrEqual(-Vec3.EPSILON);
    expect(second.getCloseSpeed()).toBeGreaterThanOrEqual(-Vec3.EPSILON);
    expect(left.v.x).toBeCloseTo(-3, 6);
    expect(middle.v.x).toBeCloseTo(-1, 6);
    expect(right.v.x).toBeCloseTo(0, 6);
  });

  it.each([-Vec3.EPSILON, -Vec3.EPSILON / 2, 0, 1])("全部闭速度 ≥ −EPSILON（%s）时首轮提前退出", speed => {
    const first = makeContact();
    const second = makeContact();
    first.bi!.v.set(speed, 0, 0);
    second.bi!.v.set(speed, 0, 0);
    markDirty(first.bi!);
    markDirty(second.bi!);
    const readFirst = vi.spyOn(first, "getCloseSpeed");
    const readSecond = vi.spyOn(second, "getCloseSpeed");
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveContact");

    solver.solveIsland(makeIsland(first, second));

    expect(solve).not.toHaveBeenCalled();
    expect(readFirst).toHaveBeenCalledTimes(1);
    expect(readSecond).toHaveBeenCalledTimes(1);
  });

  it("无法闭合时最多 4 轮，每轮 totalItems 次，仍执行穿透修正", () => {
    const first = makeContact(undefined, undefined, -0.2);
    const second = makeContact();
    vi.spyOn(first, "getCloseSpeed").mockReturnValue(-1);
    vi.spyOn(second, "getCloseSpeed").mockReturnValue(-2);
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveContact").mockImplementation(() => {});

    solver.solveIsland(makeIsland(first, second));

    expect(solve).toHaveBeenCalledTimes(8);
    expect(solve.mock.calls.every(([contact]) => contact === second)).toBe(true);
    expect(first.bi!.peneOffset.x).toBeCloseTo(0.1, 12);
  });

  it("单接触分支最多求解一次即退出", () => {
    const contact = makeContact();
    const speed = vi.spyOn(contact, "getCloseSpeed").mockReturnValue(-1);
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveContact").mockImplementation(() => {});

    solver.solveIsland(makeIsland(contact));

    expect(solve).toHaveBeenCalledTimes(1);
    expect(speed).toHaveBeenCalledTimes(1);
  });
});

describe("Solver.solveList（PCOL L9368-9385）", () => {
  it.each([false, true])("all=%s：按 dirty 筛选或求解全部岛屿", all => {
    const clean = makeIsland(makeContact());
    const dirty = makeIsland(makeContact());
    clean.dirty = false;
    clean.next = dirty;
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveIsland");

    solver.solveList({ entry: clean }, all);

    expect(solve.mock.calls.map(([island]) => island)).toEqual(all ? [clean, dirty] : [dirty]);
    expect(dirty.dirty).toBe(false);
  });

  it("空列表与空岛屿直接完成", () => {
    const solver = new Solver();
    const solve = vi.spyOn(solver, "solveContact");
    solver.solveList({ entry: null }, true);
    const island = makeIsland();
    solver.solveIsland(island);
    expect(solve).not.toHaveBeenCalled();
    expect(island.dirty).toBe(false);
  });
});
