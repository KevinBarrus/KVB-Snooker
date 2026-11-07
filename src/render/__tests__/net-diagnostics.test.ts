import { describe, expect, it } from "vitest";
import { NetDiagnostics } from "../../app-net-diagnostics.js";
import { RemoteView } from "../../net/remote-view.js";
import type { SnapshotMessage } from "../../net/protocol.js";

function snapshot(time: number, phase: "ready" | "simulating" = "simulating", shotId?: string): SnapshotMessage {
  return { type: "snapshot", serverTimeMs: time, version: 1, eventSeq: 1, phase,
    context: { playerIndex: 0, ballOn: 2, inHand: 0, scores: [0, 0], round: 0 },
    balls: [{ index: 0, number: 0, active: true, x: time / 1000, y: 0.9, z: 0,
      qx: 0, qy: 0, qz: 0, qw: 1 }], checkpoint: null,
    pendingShot: shotId ? { shotId, seat: 0, touchAtServerMs: 1000 } : null };
}

function frame(nowMs: number, margin = 50, dtMs = 1000 / 120) {
  return { nowMs, dtMs, phase: "simulating" as const, displayServerMs: nowMs - 100,
    latestServerMs: nowMs - 100 + margin, clockOffsetMs: 0, rttMs: 4,
    visible: true, balls: [1, nowMs / 1000, 0.9, 0] };
}

function stream(buffer: number, offset = 0) {
  const trace = new NetDiagnostics(buffer);
  const view = new RemoteView({ interpolationDelayMs: buffer });
  view.setClockOffset(offset);
  trace.message(snapshot(0, "ready", "s1"), 0, offset);
  let nextPacket = 1000;
  for (let now = 1000; now < 3000; now += 1000 / 120) {
    while (nextPacket <= now) {
      const packet = snapshot(nextPacket);
      view.pushSnapshot(packet, now);
      trace.message(packet, now, offset);
      nextPacket += 64;
    }
    view.update(now);
    trace.frame({ ...frame(now), clockOffsetMs: offset, ...view.interpolationStats,
      displayServerMs: view.interpolationStats.targetServerMs,
      balls: [1, view.getCueBallPosition().x, 0.9, 0] });
  }
  return trace.report();
}

describe("联机本杆诊断", () => {
  it("静止负余量和首包前等待不计为运动缓冲耗尽", () => {
    const trace = new NetDiagnostics(100);
    trace.frame(frame(500, -500));
    expect(trace.report().frames).toHaveLength(0);
    trace.message(snapshot(0, "ready", "s1"), 0, 0);
    trace.frame({ ...frame(800, -800), phase: "ready" });
    trace.message(snapshot(1000), 1002, 0);
    trace.frame(frame(1050, -200));
    trace.frame(frame(1110, 50));
    trace.message(snapshot(1100), 1102, 0);
    expect(trace.report().summary.motionFrames).toBe(1);
    expect(trace.report().summary.bufferEmptyFrames).toBe(0);
    trace.message(snapshot(1200, "ready"), 1202, 0);
    trace.frame(frame(1600));
    expect(trace.recording).toBe(false);
  });

  it("120Hz 显示与 64ms 快照：100ms 缓冲连续，0ms 会大量重复球位", () => {
    const buffered = stream(100);
    const unbuffered = stream(0);
    expect(buffered.summary.motionFrames).toBeGreaterThan(200);
    expect(buffered.summary.bufferEmptyFrames).toBe(0);
    expect(buffered.summary.repeatedFrames).toBe(0);
    expect(buffered.summary.serverGapMs?.p50).toBe(64);
    expect(unbuffered.summary.repeatedFrames).toBeGreaterThan(150);
  });

  it("低 RTT 下仍记录校时偏差造成的负余量，不用平均 FPS 掩盖长帧", () => {
    const skewed = stream(100, 300);
    expect(skewed.summary.bufferEmptyFrames).toBeGreaterThan(150);
    expect(skewed.summary.estimatedAgeAtArrivalMs?.min).toBeGreaterThanOrEqual(300);
    const trace = new NetDiagnostics(100);
    trace.message(snapshot(0, "ready", "s1"), 0, 0);
    trace.message(snapshot(1000), 1002, 0);
    trace.frame(frame(1110, 50, 150));
    trace.message(snapshot(1100), 1102, 0);
    expect(trace.report().summary.framesOver50Ms).toBe(1);
    expect(trace.report().summary.frameIntervalMs?.max).toBe(150);
  });

  it("保留原始 pong 和选用的偏移，拒收包单独标记", () => {
    const trace = new NetDiagnostics(100);
    trace.message({ type: "pong", id: 1, serverTimeMs: 102, clientTimeMs: 100 }, 104, 0);
    trace.message(snapshot(0, "ready", "s1"), 200, 0);
    trace.message({ type: "pong", id: 2, serverTimeMs: 302, clientTimeMs: 300 }, 1300, 0);
    trace.message(snapshot(1000), 1002, 0, false);
    const report = trace.report();
    expect(report.pongs.map(p => p.rttMs)).toEqual([4, 1000]);
    expect(report.pongs[1].selectedOffsetMs).toBe(0);
    expect(report.summary.rejectedPackets).toBe(1);
    expect(report.summary.motionPackets).toBe(0);
  });

  it("采样有上限，导出不泄漏内部可变数组，下一杆重置", () => {
    const trace = new NetDiagnostics(100);
    trace.message(snapshot(0, "ready", "s1"), 0, 0);
    for (let now = 0; now < 12010; now++) trace.frame(frame(now));
    const report = trace.report();
    expect(report.truncated).toBe(true);
    expect(report.frames).toHaveLength(12000);
    report.frames[0].balls[0] = 123;
    expect(trace.report().frames[0].balls[0]).toBe(1);
    trace.message(snapshot(0, "ready", "s2"), 13000, 0);
    expect(trace.report().frames).toHaveLength(0);
    expect(trace.report().truncated).toBe(false);
  });
});
