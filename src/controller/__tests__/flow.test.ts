import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import { MeshBody } from "../../core/physics/mesh-body.js";
import { Simulator } from "../../core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../core/simulator/scene.js";
import { PersonController } from "../person-controller.js";
import { ShotController } from "../shot-controller.js";
import { AIRunner } from "../ai-runner.js";
import { InHand } from "../in-hand.js";

function setup(playerIndex = 0) {
  const mesh = new MeshBody({ ground: {
    p: [-10, .88, -10, 10, .88, -10, 10, .88, 10, -10, .88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } });
  const simulator = new Simulator(mesh, { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, .3, 0] });
  const bus = new EventBus();
  const person = new PersonController(simulator, bus, .02625, playerIndex);
  const calls: (number | string)[] = [];
  const begin = vi.fn(() => true);
  const stroke = vi.fn((_index: number, vars: Float32Array) => { calls.push("stroke"); simulator.stroke(vars); return true; });
  const shots = new ShotController(bus, { begin, stroke, step: dt => { calls.push(dt); simulator.step(dt); } });
  const aim = () => { person.gotoState1(true); for (let i = 0; i < 30; ++i) person.update(.016); };
  return { simulator, bus, person, shots, begin, stroke, calls, aim };
}

describe("Controller shot flow", () => {
  it("未完成瞄准或回合权限拒绝时不能发射，也不占用动画", () => {
    const { person, shots, begin, aim } = setup();
    expect(shots.launch(person)).toBe(false);
    expect(begin).not.toHaveBeenCalled();
    person.gotoState1(); person.update(.2);
    expect(shots.launch(person)).toBe(false);
    aim(); begin.mockReturnValue(false);
    expect(shots.launch(person)).toBe(false);
    expect(shots.busy).toBe(false);
    expect(shots.motion.isReady()).toBe(true);
  });

  it("触球前不发冲量；跨延迟分片只发一次，先stroke再step该片段", () => {
    const { person, shots, bus, stroke, calls, aim } = setup();
    aim();
    const event = vi.fn(); bus.on("sim/shooting-start", event);
    expect(shots.launch(person)).toBe(true);
    expect(shots.launch(person)).toBe(false);
    expect(shots.inputLocked).toBe(true);
    shots.update(.3, dt => person.update(dt));
    expect(stroke).not.toHaveBeenCalled();
    shots.update(.4, dt => person.update(dt));
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith({ playerIndex: 0 });
    expect(shots.inputLocked).toBe(false);
    const contact = calls.indexOf("stroke");
    expect(typeof calls[contact + 1]).toBe("number");
    expect(calls.slice(0, contact).every(step => typeof step === "number" && step <= .02)).toBe(true);
    for (let i = 0; i < 150; ++i) shots.update(.0167, dt => person.update(dt));
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(shots.canJudge).toBe(true);
    shots.finish();
    expect(shots.motion.isReady()).toBe(true);
    expect(person.camera.isFollowing).toBe(false);
  });

  it("预测按几何/力度变化刷新，读取和显示不改核心快照", () => {
    const { person, simulator, aim } = setup();
    aim();
    const predict = vi.spyOn(simulator, "predict");
    const before = simulator.serialize();
    expect(person.updatePrediction()).toBe(true);
    expect(person.updatePrediction()).toBe(false);
    person.strokePower = 10;
    expect(person.strokePower).toBe(1);
    expect(person.updatePrediction()).toBe(true);
    person.strokePower = -1;
    expect(person.strokePower).toBe(0);
    expect(predict).toHaveBeenCalledTimes(2);
    expect(simulator.serialize()).toEqual(before);
    person.activate();
    expect(person.prediction).toBeNull();
    expect(person.updatePrediction()).toBe(true);
  });

  it("跟杆结束后等待0.5秒且只触发一次起身，自然观察持续到回合收尾", () => {
    const { person, shots, aim } = setup();
    aim();
    const stand = vi.spyOn(person, "gotoState0");
    expect(shots.launch(person)).toBe(true);
    expect(person.camera.isFollowing).toBe(false);
    expect(person.camera.shotView.active).toBe(true);
    for (let i = 0; i < 2000 && shots.motion.needsUpdate; ++i) shots.update(.001, dt => person.update(dt));
    expect(shots.motion.needsUpdate).toBe(false);
    shots.update(.49, dt => person.update(dt));
    expect(stand).not.toHaveBeenCalled();
    shots.update(.02, dt => person.update(dt));
    expect(stand).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 180; ++i) shots.update(1 / 60, dt => person.update(dt));
    expect(stand).toHaveBeenCalledTimes(1);
    expect(person.camera.stateRatio).toBe(0);
    expect(person.camera.shotView.active).toBe(true);
    shots.finish();
    expect(person.camera.isFollowing).toBe(false);
    expect(person.camera.shotView.active).toBe(false);
  });

  it("AI等待后将路线注入同一个球杆/出杆通道，只发一次AI事件", () => {
    const { person, shots, bus, stroke } = setup(1);
    const next = vi.fn(() => ({ dx: 1, dz: .1, fbSpin: -.3, powerFactor: .4 }));
    const random = vi.fn(() => .25);
    const runner = new AIRunner(person, shots, bus, { restart: () => true, next, random });
    const event = vi.fn(); bus.on("ai/shot", event);
    runner.activate();
    runner.update(1);
    expect(next).not.toHaveBeenCalled();
    for (let i = 0; i < 400; ++i) {
      runner.update(.0167);
      shots.update(.0167, dt => person.update(dt));
    }
    expect(next).toHaveBeenCalledTimes(1);
    expect(person.strokePower).toBeCloseTo(.7);
    expect(random).toHaveBeenCalledTimes(2);
    expect(event).toHaveBeenCalledTimes(1);
    expect(stroke).toHaveBeenCalledTimes(1);
  });
});

describe("InHand", () => {
  it("首击仅初始化位置，脏预览不可放置，合法预览下一次点击才请求放球", () => {
    const { person } = setup();
    const place = vi.fn(() => true);
    const mode = new InHand(person.camera, {
      ray: () => ({ origin: { x: -1.2, y: 2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }),
      valid: () => true, place
    });
    mode.enter();
    expect(mode.press(300, 200)).toBe(false);
    expect(place).not.toHaveBeenCalled();
    mode.update();
    expect(mode.valid).toBe(true);
    expect(mode.spot).toEqual({ x: -1.2, y: .88, z: 0 });
    expect(mode.press(300, 200)).toBe(true);
    mode.move(301, 200);
    expect(mode.press(301, 200)).toBe(false);
    mode.exit();
    expect(mode.visible).toBe(false);
  });

  it("非法区域或背离台面的射线不可放球", () => {
    const { person } = setup();
    const place = vi.fn(() => true);
    const mode = new InHand(person.camera, {
      ray: () => ({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      valid: () => false, place
    });
    mode.enter(); mode.move(0, 0); mode.update();
    expect(mode.valid).toBe(false);
    expect(mode.press(0, 0)).toBe(false);
    expect(place).not.toHaveBeenCalled();
  });
});
