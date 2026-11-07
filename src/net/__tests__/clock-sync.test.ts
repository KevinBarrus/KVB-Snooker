import { describe, expect, it } from "vitest";
import { PingClock } from "../clock-sync.js";

describe("PingClock", () => {
  it("估计单程偏移与往返时间", () => {
    const clock = new PingClock();
    expect(clock.add(5_000, 1_000, 1_100)).toBe(true);
    expect(clock.rttMs).toBe(100);
    expect(clock.offsetMs).toBe(3_950);
    expect(clock.project(5_000)).toBe(1_050);
  });

  it("取最近样本中位数以抵抗抖动", () => {
    const clock = new PingClock();
    clock.add(10_000, 1_000, 1_100);
    clock.add(10_200, 2_000, 2_100);
    clock.add(9_900, 3_000, 3_100);
    expect(clock.offsetMs).toBe(8_150);
  });

  it("低 RTT 样本优先，剔除主线程卡顿造成的迟到样本", () => {
    const clock = new PingClock();
    clock.add(5_000, 1_000, 1_002);
    clock.add(6_000, 2_000, 2_002);
    expect(clock.offsetMs).toBe(3_999);
    // 页面卡顿 1 秒后处理 pong：RTT 巨大、偏移偏差近 500ms，不应污染偏移。
    clock.add(7_000, 3_000, 4_000);
    expect(clock.offsetMs).toBe(3_999);
    expect(clock.rttMs).toBe(2);
  });

  it("拒绝负 RTT 与超范围样本", () => {
    const clock = new PingClock();
    expect(clock.add(5_000, 1_000, 900)).toBe(false);
    expect(clock.add(5_000, 1_000, 999_999)).toBe(false);
    expect(clock.offsetMs).toBeNull();
  });

  it("welcome 播种后 pong 修正", () => {
    const clock = new PingClock();
    clock.seed(10_000, 1_000);
    expect(clock.offsetMs).toBe(9_000);
    clock.add(10_100, 1_100, 1_102);
    expect(clock.offsetMs).toBe(8_999);
  });
});
