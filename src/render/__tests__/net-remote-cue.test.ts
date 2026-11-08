import { describe, expect, it } from "vitest";
import { RemoteCue } from "../../app-net-remote-cue.js";
import { PersonController } from "../../controller/person-controller.js";
import { TipMotion } from "../../controller/tip-motion.js";
import { EventBus } from "../../core/event-bus.js";
import { MeshBody } from "../../core/physics/mesh-body.js";
import { Simulator } from "../../core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../core/simulator/scene.js";
import type { ServerEventMessage } from "../../net/protocol.js";

function setup(power = .5, spin = 0, elevation = 0) {
  const sim = new Simulator(new MeshBody({ ground: {
    p: [-10, .88, -10, 10, .88, -10, 10, .88, 10, -10, .88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } }), { ...DEFAULT_SCENE, ballSet: [0, 0, 0] });
  const person = new PersonController(sim, new EventBus(), sim.ballRadius);
  person.gotoState1(true);
  person.strokePower = power;
  person.stick.setTipPercent(spin, spin / 2);
  person.stick.setAngleV(elevation);
  for (let i = 0; i < 60; i++) person.update(.016);
  const vars = Array.from(person.getStrokeVars());
  const plan: ServerEventMessage = { type: "event", seq: 1, serverTimeMs: 0,
    event: { type: "shot-prepared", shotId: "s1", seat: 0, touchAtServerMs: 1000, prepareLeadMs: 1000, vars } };
  const remote = new RemoteCue(sim.ballRadius);
  return { sim, person, plan, remote, cue: sim.getCueBallPosition() };
}

describe("观看方球杆", () => {
  it.each([[0, 0, 0], [.5, 0, 0], [1, 0, 0], [.3, .8, .2], [.75, -.8, .6]])(
    "力度%s、加塞%s、抬杆%s：复用本地曲线，触点和方向不因观看相机改变", (power, spin, elevation) => {
      const t = setup(power, spin, elevation);
      const local = new TipMotion();
      const duration = local.launch(t.person.stick, power);
      const camera = t.person.camera.position.clone();
      t.remote.receive(t.plan, 1, t.cue);
      let elapsed = 0;
      for (let at = 0; at <= 1200; at += 10) {
        const target = Math.max(0, (at - 1000) / 1000 + duration);
        while (elapsed < target && local.needsUpdate) {
          const step = local.tick(target - elapsed);
          if (step <= 0) break;
          elapsed += step;
        }
        const cue = { ...t.cue, x: t.cue.x + Math.max(0, at - 1000) / 1000 };
        local.updateLength(cue, t.sim.ballRadius);
        t.remote.update(at, cue);
        expect(t.remote.visible).toBe(true);
        expect(t.remote.motion.length).toBeCloseTo(local.length, 5);
        expect(t.remote.struck).toBe(at >= 1000);
        const expected = t.person.stick.kissPoint.add(t.person.stick.kissDir.scale(local.length));
        expect(t.remote.position.x).toBeCloseTo(expected.x, 5);
        expect(t.remote.position.y).toBeCloseTo(expected.y, 5);
        expect(t.remote.position.z).toBeCloseTo(expected.z, 5);
      }
      expect(t.person.camera.position.equals(camera)).toBe(true);
    });

  it("晚到计划追赶，重复计划不重播，收杆后不复活", () => {
    const t = setup();
    t.remote.receive(t.plan, 1, t.cue);
    const moving = { ...t.cue, x: t.cue.x + .2 };
    t.remote.update(1100, moving);
    expect(t.remote.struck).toBe(true);
    expect(t.remote.motion.length).toBeGreaterThanOrEqual(0);
    const position = t.remote.position.clone();
    t.remote.receive(t.plan, 1, t.cue);
    t.remote.update(1100, moving);
    expect(t.remote.position.equals(position)).toBe(true);
    t.remote.update(3000, moving);
    expect(t.remote.visible).toBe(false);
    t.remote.receive(t.plan, 1, t.cue);
    t.remote.update(3100, moving);
    expect(t.remote.visible).toBe(false);
  });

  it("结算先到不截断显示，取消或断线立即隐藏", () => {
    const t = setup();
    t.remote.receive(t.plan, 1, t.cue);
    t.remote.receive({ type: "event", seq: 2, serverTimeMs: 1100, event: {
      type: "shot-settled", shotId: "s1", seat: 0, score: 0, foulCode: 0,
      potted: [], outOfBounds: [], settledAtServerMs: 1100
    } }, 1, t.cue);
    t.remote.update(900, t.cue);
    expect(t.remote.visible).toBe(true);
    expect(t.remote.struck).toBe(false);
    t.remote.receive({ type: "event", seq: 3, serverTimeMs: 1100,
      event: { type: "shot-cancelled", shotId: "s1", reason: "wrong-phase" } }, 1, t.cue);
    t.remote.update(1000, t.cue);
    expect(t.remote.visible).toBe(false);
    if (t.plan.event.type !== "shot-prepared") throw new Error("missing plan");
    const next: ServerEventMessage = { ...t.plan, event: { ...t.plan.event, shotId: "s2" } };
    t.remote.receive(next, 1, t.cue);
    t.remote.update(900, t.cue);
    expect(t.remote.visible).toBe(true);
    t.remote.clear();
    t.remote.update(1000, t.cue);
    expect(t.remote.visible).toBe(false);
  });

  it("自己的出杆不显示第二根球杆，非法参数不产生NaN动画", () => {
    const t = setup();
    t.remote.receive(t.plan, 0, t.cue);
    t.remote.update(900, t.cue);
    expect(t.remote.visible).toBe(false);
    if (t.plan.event.type !== "shot-prepared") throw new Error("missing plan");
    t.remote.receive({ ...t.plan, event: { ...t.plan.event, vars: [NaN] } }, 1, t.cue);
    t.remote.update(1100, t.cue);
    expect(t.remote.visible).toBe(false);
    expect(Number.isFinite(t.remote.position.x)).toBe(true);
  });
});
