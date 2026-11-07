import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import { MeshBody } from "../../core/physics/mesh-body.js";
import { Simulator } from "../../core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../core/simulator/scene.js";
import { PersonController } from "../person-controller.js";
import { ShotController } from "../shot-controller.js";
import { AIRunner } from "../ai-runner.js";
import { InHand } from "../in-hand.js";
import { MatchClock } from "../../core/match-clock.js";
import { TipMotion } from "../tip-motion.js";

function setup(playerIndex = 0, clock?: MatchClock) {
  const mesh = new MeshBody({ ground: {
    p: [-10, .88, -10, 10, .88, -10, 10, .88, 10, -10, .88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } });
  const simulator = new Simulator(mesh, { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, .3, 0] });
  const bus = new EventBus();
  const person = new PersonController(simulator, bus, .02625, playerIndex);
  const calls: (number | string)[] = [];
  const begin = vi.fn(() => true);
  const stroke = vi.fn((_index: number, vars: Float32Array) => {
    if (clock && !clock.strike()) return false;
    calls.push("stroke"); simulator.stroke(vars); return true;
  });
  const shots = new ShotController(bus, { begin, stroke, step: dt => { calls.push(dt); simulator.step(dt); },
    advanceTime: clock ? dt => {
      const expiry = clock.advance(dt);
      if (expiry) { shots.finish(); return false; }
      return true;
    } : undefined });
  const aim = () => { person.gotoState1(true); for (let i = 0; i < 30; ++i) person.update(.016); };
  return { simulator, bus, person, shots, begin, stroke, calls, aim };
}

describe("Controller shot flow", () => {
  it.each([-0.001, 0.001])("同一长帧内按触球相对截止的时刻处理：%s秒", margin => {
    const clock = new MatchClock(); clock.confirmPlacement();
    const { person, shots, stroke, aim } = setup(0, clock);
    aim();
    const delay = new TipMotion().launch(person.stick, person.strokePower);
    clock.advance(20 - delay + margin);
    expect(shots.launch(person)).toBe(true);
    shots.update(1, dt => person.update(dt));
    expect(stroke).toHaveBeenCalledTimes(margin < 0 ? 1 : 0);
    expect(clock.view.phase).toBe(margin < 0 ? "rolling" : "shot-expired");
    if (margin < 0) expect(clock.view.shotSeconds).toBeCloseTo(.001, 10);
  });
  it("本地控制席位1同样锁输入并启用观察，不能用编号判断AI", () => {
    const { person, shots, aim } = setup();
    person.playerIndex = 1;
    aim();
    expect(shots.launch(person)).toBe(true);
    expect(shots.inputLocked).toBe(true);
    expect(person.camera.shotView.active).toBe(true);
    shots.finish();
    expect(person.camera.shotView.active).toBe(false);
  });
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
  it("进入只显示母球原位；鼠标移动后才计算候选；合法点击放球并结束摆球模式", () => {
    const { person } = setup();
    const place = vi.fn(() => true);
    const ray = vi.fn(() => ({ origin: { x: -1.2, y: 2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }));
    const mode = new InHand(person.camera, { ray, valid: () => true, place });
    mode.enter();
    expect(mode.active).toBe(true);
    expect(mode.visible).toBe(false);
    mode.update();
    expect(mode.visible).toBe(false);
    expect(ray).not.toHaveBeenCalled();
    mode.move(300, 200);
    mode.update();
    expect(mode.visible).toBe(true);
    expect(mode.valid).toBe(true);
    expect(mode.spot).toEqual({ x: -1.2, y: .88, z: 0 });
    expect(mode.click(300, 200)).toBe(true);
    expect(place).toHaveBeenCalledTimes(1);
    expect(mode.active).toBe(false);
    expect(mode.visible).toBe(false);
    mode.move(320, 200);
    mode.update();
    expect(mode.visible).toBe(false);
  });

  it("非法位置或背离台面的射线不放球，并保持摆球模式", () => {
    const { person } = setup();
    const place = vi.fn(() => true);
    const flat = new InHand(person.camera, {
      ray: () => ({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      valid: () => true, place
    });
    flat.enter(); flat.move(0, 0); flat.update();
    expect(flat.visible).toBe(false);
    expect(flat.click(0, 0)).toBe(false);
    flat.exit();
    const blocked = new InHand(person.camera, {
      ray: () => ({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }),
      valid: () => false, place
    });
    blocked.enter(); blocked.move(0, 0); blocked.update();
    expect(blocked.visible).toBe(true);
    expect(blocked.valid).toBe(false);
    expect(blocked.click(0, 0)).toBe(false);
    expect(blocked.active).toBe(true);
    expect(place).not.toHaveBeenCalled();
  });

  it("点击提交按当前坐标重新拾取，不使用上一帧缓存", () => {
    const { person } = setup();
    const place = vi.fn((_point: { x: number; y: number; z: number }) => true);
    let x = -1.2;
    const mode = new InHand(person.camera, {
      ray: () => ({ origin: { x, y: 2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }),
      valid: () => true, place
    });
    mode.enter(); mode.move(300, 200); mode.update();
    expect(mode.spot.x).toBe(-1.2);
    x = -1.1;
    expect(mode.click(316, 208)).toBe(true);
    expect(place.mock.calls[0][0]).toMatchObject({ x: -1.1, z: 0 });
  });

  it("每次进入摆球模式聚焦母球一次；同一次进入不重复拉镜头", () => {
    const { person } = setup();
    const look = vi.spyOn(person.camera, "lookTo");
    person.camera.bodyPosition.copyFromFloats(0, 1.7, 0);
    person.camera.azimuth.setSlope(1, 0);
    const mode = new InHand(person.camera, {
      ray: () => ({ origin: { x: 0, y: 2, z: 0 }, direction: { x: 0, y: -1, z: 0 } }),
      valid: () => true, place: () => true, focus: () => ({ x: -1.04, y: .88, z: 0 })
    });
    mode.enter(); mode.update();
    expect(look).toHaveBeenCalledTimes(1);
    mode.move(300, 200); mode.update();
    expect(look).toHaveBeenCalledTimes(1);
    mode.exit(); mode.enter(); mode.update();
    expect(look).toHaveBeenCalledTimes(2);
  });
});
