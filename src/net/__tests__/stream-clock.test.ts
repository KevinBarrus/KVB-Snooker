import { MatchProgress } from "../../core/match-progress.js";
import { describe, expect, it } from "vitest";
import { RemoteView } from "../remote-view.js";
import type { SnapshotMessage } from "../protocol.js";

function snapshot(time: number, phase: SnapshotMessage["phase"], pending = false): SnapshotMessage {
  return { type: "snapshot", rules: { players: [{ pts: 0, penalty: 0, brk: 0 }, { pts: 0, penalty: 0, brk: 0 }], decision: null, freeBall: false, nomination: { enabled: false, selected: null, options: [] }, touching: [] }, pause: { phase: "running", requester: null, used: [0, 0], ready: [false, false], remainingSeconds: null, countdownSeconds: 0 }, match: new MatchProgress({ matchId: "test-match", bestOf: 3, firstOpeningPlayer: 0 }).view, serverTimeMs: time, version: phase === "ready" ? 1 : 2, eventSeq: 0, phase,
    context: { playerIndex: 0, ballOn: 2, inHand: 0, scores: [0, 0], round: 0 },
    balls: [{ index: 0, number: 0, active: true, x: phase === "ready" ? 0 : (time - 1700) / 1000,
      y: 0.9, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }], checkpoint: null,
    pendingShot: pending ? { shotId: "s1", seat: 0, touchAtServerMs: 1700, vars: [0, .9, 0, 1, 0, 0, 20, .005] } : null };
}

describe("运动显示时钟", () => {
  it("120Hz 显示承受每秒83ms时基漂移及秒级校时跳变，仍连续且保有缓冲", () => {
    const view = new RemoteView({ interpolationDelayMs: 100 });
    view.setClockOffset(-600);
    view.pushSnapshot(snapshot(1000, "ready", true), 0);
    let nextPacket = 1704;
    let previous = -Infinity;
    let empty = 0;
    let maximumStep = 0;
    for (let frame = 0; frame <= 1080; frame++) {
      const now = frame * 1000 / 120;
      const serverNow = 1000 + now * 11 / 12;
      while (nextPacket <= serverNow) {
        view.pushSnapshot(snapshot(nextPacket, "simulating"), (nextPacket - 1000) * 12 / 11);
        nextPacket += 64;
      }
      view.setClockOffset(now < 1500 ? -600 : now < 6500 ? 1000 : 900);
      view.update(now);
      const stats = view.interpolationStats;
      expect(stats.targetServerMs).toBeGreaterThanOrEqual(previous);
      if (Number.isFinite(previous)) maximumStep = Math.max(maximumStep, stats.targetServerMs - previous);
      previous = stats.targetServerMs;
      if (now > 1500 && stats.marginMs <= 0) empty++;
    }
    expect(maximumStep).toBeLessThanOrEqual(1000 / 120 * 1.21);
    expect(empty).toBe(0);
    expect(view.interpolationStats.marginMs).toBeLessThan(150);
  });

  it("缺包只停在已知球位，恢复后不倒放，结算后允许回合就绪", () => {
    const view = new RemoteView({ interpolationDelayMs: 100 });
    view.pushSnapshot(snapshot(1000, "ready", true), 0);
    let previous = -Infinity;
    for (let now = 0; now <= 4000; now += 10) {
      if (now >= 700 && now % 50 === 0 && !(now > 2000 && now < 2400)) {
        view.pushSnapshot(snapshot(1000 + now, "simulating"), now);
      }
      view.update(now);
      expect(view.interpolationStats.targetServerMs).toBeGreaterThanOrEqual(previous);
      if (now >= 700) expect(view.interpolationStats.targetServerMs).toBeLessThanOrEqual(1000 + now);
      previous = view.interpolationStats.targetServerMs;
    }
    const stable = { ...snapshot(5000, "ready"), version: 3 };
    view.pushSnapshot(stable, 4000);
    view.setClockOffset(-5000);
    for (let now = 4010; now <= 4500; now += 10) {
      view.update(now);
      expect(view.interpolationStats.targetServerMs).toBeGreaterThanOrEqual(previous);
      previous = view.interpolationStats.targetServerMs;
    }
    expect(view.interpolationStats.marginMs).toBeLessThanOrEqual(0);
  });
});
