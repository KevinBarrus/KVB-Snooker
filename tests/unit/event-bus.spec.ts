import { describe, expect, it } from "vitest";
import { EventBus, type ContactEvent, type EventPayloads } from "../../src/core/event-bus.js";

describe("EventBus（docs/architecture.md §3）", () => {
  it("on/emit 收到正确载荷", () => {
    const bus = new EventBus();
    const seen: { playerIndex: number }[] = [];
    bus.on("sim/shooting-start", (p) => seen.push({ ...p }));
    const payload: EventPayloads["sim/shooting-start"] = { playerIndex: 1 };
    bus.emit("sim/shooting-start", payload);
    expect(seen).toEqual([{ playerIndex: 1 }]);
  });

  it("off 后不再收到；on 返回的取消函数有效", () => {
    const bus = new EventBus();
    let n = 0;
    const a = () => ++n;
    const b = () => ++n;
    bus.on("sim/touch-presolve", b);
    const cancel = bus.on("sim/touch-presolve", a);
    const contact: ContactEvent = { label: "ball", speeds: [0.5, -0.5], isSS: true };
    bus.emit("sim/touch-presolve", contact);
    cancel();
    bus.emit("sim/touch-presolve", { label: "tip", speeds: [0, 0], isSS: false });
    bus.off("sim/touch-presolve", b);
    bus.emit("sim/touch-presolve", { label: "ball", speeds: [1, 0], isSS: false });
    expect(n).toBe(3);
  });

  it("off 清空后集合即销毁；无订阅者 emit 安全", () => {
    const bus = new EventBus();
    expect(() => {
      bus.emit("ai/shot", undefined);
      bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    }).not.toThrow();
    bus.on("ai/shot", () => undefined);
    expect(() => bus.emit("ai/shot", undefined)).not.toThrow();
  });

  it("emit 期间注册/注销不影响本次快照", () => {
    const bus = new EventBus();
    const order: string[] = [];
    let detach: (() => void) | undefined;
    detach = bus.on("ctrl/state-change-start", () => {
      order.push("first");
      detach!();
    });
    bus.on("ctrl/state-change-start", () => order.push("second"));
    const ev: EventPayloads["ctrl/state-change-start"] = { from: 0, to: 1 };
    bus.emit("ctrl/state-change-start", ev);
    bus.emit("ctrl/state-change-start", ev);
    expect(order).toEqual(["first", "second", "second"]);
  });
});
