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
    expect(clockPhaseText(view("placement"))).toBe("摆球中 · 计时继续");
    expect(clockPhaseText(view("placement", true))).toBe("蓝球决胜 · 摆球计时中");
    expect(clockPhaseText(view("aiming", true))).toBe("蓝球决胜 · 瞄准");
    expect(clockPhaseText(view("rolling"))).toBe("球运动中");
    expect(clockPhaseText(view("settling"))).toBe("等待本杆结算");
    expect(clockPhaseText(view("frame-expired"))).toBe("局时结束 · 等待本杆结算");
    expect(clockPhaseText(view("shot-expired"))).toBe("出杆超时");
    expect(clockPhaseText(view("finished"))).toBe("本局结束");
  });

  it("shotRatio 连续且三档：>10 正常、3–10 琥珀、≤3 紧急", () => {
    const clock = new MatchClock();
    const at = (seconds: number) => { clock.sync({ frameSeconds: 0, shotSeconds: seconds, phase: "aiming", shootout: false }); return clock; };
    expect(at(20).shotRatio).toBe(1);
    expect(at(10).shotRatio).toBe(0.5);
    expect(at(10).shotWarn).toBe(true);
    expect(at(10).shotUrgent).toBe(false);
    expect(at(12.5).shotWarn).toBe(false);
    expect(at(3).shotRatio).toBe(0.15);
    expect(at(3).shotWarn).toBe(false);
    expect(at(3).shotUrgent).toBe(true);
    expect(at(0).shotRatio).toBe(0);
    expect(at(-2).shotRatio).toBe(0);
    expect(at(Number.NaN).shotRatio).toBe(0);
    expect(at(25).shotRatio).toBe(1);
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

  it.each([
    [20, 1, false], [19.01, 19.01 / 20, false], [19, .95, false], [3.001, 3.001 / 20, false],
    [3, .15, true], [.1, .005, true], [0, 0, true], [-1, 0, true], [25, 1, false]
  ])("剩余%s秒占满比例%s，紧急状态%s", (seconds, ratio, urgent) => {
    const clock = new MatchClock();
    clock.sync({ ...view("aiming"), shotSeconds: seconds });
    expect(clock.shotRatio).toBeCloseTo(ratio, 6);
    expect(clock.shotUrgent).toBe(urgent);
  });

  it("球运动时保留本杆余量，下一杆新快照才恢复满条", () => {
    const clock = new MatchClock();
    clock.sync({ ...view("rolling"), shotSeconds: 8.5 });
    expect(clock.shotRatio).toBeCloseTo(.425, 6);
    clock.sync({ ...view("settling"), shotSeconds: 8.5 });
    expect(clock.shotRatio).toBeCloseTo(.425, 6);
    clock.sync({ ...view("placement"), shotSeconds: 20 });
    expect(clock.shotRatio).toBe(1);
    clock.sync(null);
    expect(clock.visible).toBe(false);
    expect(clock.shotRatio).toBe(0);
    expect(clock.shotUrgent).toBe(false);
    expect(clock.shotWarn).toBe(false);
  });
});
