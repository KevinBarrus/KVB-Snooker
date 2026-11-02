import { describe, expect, it } from "vitest";
import { MatchClock, clockPhaseText, formatFrame, formatShot } from "../match-clock";

const view = (phase: "placement" | "aiming" | "rolling" | "settling" | "frame-expired" | "shot-expired" | "finished",
  shootout = false) => ({ frameSeconds: 0, shotSeconds: 0, phase, shootout });

describe("ui match clock", () => {
  it("局时按分秒向下取整，出杆最后数秒显示十分之一", () => {
    expect(formatFrame(900)).toBe("15:00");
    expect(formatFrame(899.9)).toBe("14:59");
    expect(formatFrame(-3)).toBe("0:00");
    expect(formatShot(20)).toBe("20");
    expect(formatShot(4.96)).toBe("5.0");
    expect(formatShot(0)).toBe("0.0");
    expect(formatShot(Number.POSITIVE_INFINITY)).toBe("--");
  });

  it("阶段文案区分摆球、滚动、结算与决胜", () => {
    expect(clockPhaseText(view("placement"))).toBe("摆球暂停");
    expect(clockPhaseText(view("placement", true))).toBe("蓝球决胜 · 摆球暂停");
    expect(clockPhaseText(view("aiming", true))).toBe("蓝球决胜 · 瞄准");
    expect(clockPhaseText(view("rolling"))).toBe("球运动中");
    expect(clockPhaseText(view("settling"))).toBe("等待本杆结算");
    expect(clockPhaseText(view("frame-expired"))).toBe("局时结束 · 等待本杆结算");
    expect(clockPhaseText(view("shot-expired"))).toBe("出杆超时");
    expect(clockPhaseText(view("finished"))).toBe("本局结束");
  });

  it("sync 复制快照并保持可见性", () => {
    const clock = new MatchClock();
    expect(clock.visible).toBe(false);
    const source = { frameSeconds: 120, shotSeconds: 7.5, phase: "aiming" as const, shootout: false };
    clock.sync(source);
    expect(clock.visible).toBe(true);
    expect(clock.frameText).toBe("2:00");
    expect(clock.shotText).toBe("8");
    expect(clock.phaseText).toBe("瞄准中");
    clock.sync(null);
    expect(clock.visible).toBe(false);
  });
});
