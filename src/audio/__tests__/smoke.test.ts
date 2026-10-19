import { describe, expect, it } from "vitest";
import { EventBus, type ContactEvent } from "../../core/event-bus.js";
import { AudioHooks } from "../hooks.js";
import { mixContact, type SoundBackend, type SoundDecision } from "../mixer.js";

function setup() {
  const bus = new EventBus();
  const played: SoundDecision[] = [];
  const backend: SoundBackend = { play: decision => { played.push(decision); } };
  const hooks = new AudioHooks(backend);
  hooks.attach(bus);
  return { bus, hooks, played };
}

describe("audio mixer", () => {
  it.each([
    { label: "12->13", isSS: true, sound: "ball-ball" },
    { label: "12->13", isSS: false, sound: "ball-cushion" },
    { label: "tip", isSS: false, sound: "tip" },
    { label: "tip", isSS: true, sound: "tip" }
  ] as const)("$label / isSS=$isSS → $sound", ({ label, isSS, sound }) => {
    expect(mixContact({ label, isSS, speeds: [-0.25, 0.5] }))
      .toEqual({ sound, volume: 0.5 });
  });

  it.each([
    { speeds: [-0.75, 0.25], volume: 0.75 },
    { speeds: [0.25, -0.75], volume: 0.75 },
    { speeds: [0, 0], volume: 0 },
    { speeds: [-3, 2], volume: 1 },
    { speeds: [NaN, 0.5], volume: 0 },
    { speeds: [0.5, Infinity], volume: 0 },
    { speeds: [-Infinity, 0.5], volume: 0 }
  ] as const)("$speeds → volume=$volume", ({ speeds, volume }) => {
    expect(mixContact({ label: "ball", isSS: true, speeds }).volume).toBe(volume);
  });

  it("只读输入，同一接触产生相同播放决策", () => {
    const contact: Readonly<ContactEvent> = Object.freeze({
      label: "12->13", isSS: true, speeds: Object.freeze([-0.25, 0.5] as const)
    });
    const expected = { sound: "ball-ball", volume: 0.5 };
    expect(mixContact(contact)).toEqual(expected);
    expect(mixContact(contact)).toEqual(expected);
    expect(contact.speeds).toEqual([-0.25, 0.5]);
  });
});

describe("audio smoke：EventBus → SoundBackend", () => {
  it("球球、球库和皮头接触按事件映射音色与响度", () => {
    const { bus, played } = setup();
    bus.emit("sim/touch-presolve", { label: "1->2", isSS: true, speeds: [-0.3, 0.1] });
    bus.emit("sim/touch-presolve", { label: "1->2", isSS: false, speeds: [0, -0.7] });
    bus.emit("sim/touch-presolve", { label: "tip", isSS: false, speeds: [0, 2] });
    expect(played).toEqual([
      { sound: "ball-ball", volume: 0.3 },
      { sound: "ball-cushion", volume: 0.7 },
      { sound: "tip", volume: 1 }
    ]);
  });

  it("零速和非有限速度不调用后端", () => {
    const { bus, played } = setup();
    bus.emit("sim/touch-presolve", { label: "1->2", isSS: true, speeds: [0, 0] });
    bus.emit("sim/touch-presolve", { label: "1->2", isSS: true, speeds: [NaN, 1] });
    expect(played).toEqual([]);
  });

  it("相同接触事件逐次触发，不擅自去重", () => {
    const { bus, played } = setup();
    const contact: ContactEvent = { label: "1->2", isSS: true, speeds: [-0.5, 0] };
    bus.emit("sim/touch-presolve", contact);
    bus.emit("sim/touch-presolve", contact);
    expect(played).toEqual([
      { sound: "ball-ball", volume: 0.5 }, { sound: "ball-ball", volume: 0.5 }
    ]);
  });

  it("出界只生成通用提示，不按球号猜测袋口", () => {
    const { bus, played } = setup();
    bus.emit("sim/out-of-bounds", Object.freeze({ ballIndex: 0, ballNumber: 0 }));
    bus.emit("sim/out-of-bounds", Object.freeze({ ballIndex: 21, ballNumber: 7 }));
    expect(played).toEqual([
      { sound: "out-of-bounds", volume: 1 }, { sound: "out-of-bounds", volume: 1 }
    ]);
  });

  it("无犯规不播放，多个犯规位仍只触发一次提示", () => {
    const { bus, played } = setup();
    bus.emit("game/foul", { foulCode: 0, description: "", score: 0 });
    expect(played).toEqual([]);
    bus.emit("game/foul", Object.freeze({ foulCode: 1 | 8, description: "FOUL", score: -4 }));
    expect(played).toEqual([{ sound: "foul", volume: 1 }]);
  });

  it("重复 detach 安全，解绑后三种事件均不再触发", () => {
    const { bus, hooks, played } = setup();
    hooks.detach();
    hooks.detach();
    bus.emit("sim/touch-presolve", { label: "tip", isSS: false, speeds: [0, 1] });
    bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    bus.emit("game/foul", { foulCode: 1, description: "FOUL", score: -4 });
    expect(played).toEqual([]);
  });

  it("重复 attach 只保留一组订阅，切换总线释放旧订阅", () => {
    const { bus, hooks, played } = setup();
    hooks.attach(bus);
    bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    expect(played).toHaveLength(1);
    const nextBus = new EventBus();
    hooks.attach(nextBus);
    bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    expect(played).toHaveLength(1);
    nextBus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    expect(played).toHaveLength(2);
  });

  it("shooting-start 不冒充皮头撞击", () => {
    const { bus, played } = setup();
    bus.emit("sim/shooting-start", { playerIndex: 0 });
    expect(played).toEqual([]);
  });

  it("未提供后端时三种事件均可在 Node 中消费", () => {
    const hooks = new AudioHooks();
    const bus = new EventBus();
    hooks.attach(bus);
    expect(() => {
      bus.emit("sim/touch-presolve", { label: "tip", isSS: false, speeds: [0, 1] });
      bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
      bus.emit("game/foul", { foulCode: 1, description: "FOUL", score: -4 });
      hooks.detach();
    }).not.toThrow();
  });
});
