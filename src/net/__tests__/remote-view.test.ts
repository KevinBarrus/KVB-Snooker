import { MatchProgress } from "../../core/match-progress.js";
import { describe, expect, it } from "vitest";
import { RemoteView } from "../remote-view.js";
import type { RoomPhase, SnapshotBall, SnapshotMessage, StateVersion } from "../protocol.js";
import type { SerialData } from "../../core/simulator/shot-result.js";

function ball(index: number, number: number, x: number, y: number, z: number, active = true,
  q = { x: 0, y: 0, z: 0, w: 1 }): SnapshotBall {
  return { index, number, active, x, y, z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}

function snapshot(version: StateVersion, serverTimeMs: number, balls: readonly SnapshotBall[],
  options: { phase?: RoomPhase; checkpoint?: SerialData | null } = {}): SnapshotMessage {
  return {
    type: "snapshot", match: new MatchProgress({ matchId: "test-match", bestOf: 3, firstOpeningPlayer: 0 }).view, version, eventSeq: version, serverTimeMs, phase: options.phase ?? "ready",
    context: { playerIndex: 0, ballOn: 2, inHand: 0, scores: [0, 0], round: 0 },
    balls, checkpoint: options.checkpoint === undefined ? null : options.checkpoint, pendingShot: null
  };
}

function positions(balls: readonly SnapshotBall[] = [ball(0, 0, 0, 0.9, 0), ball(1, 1, 0.5, 0.9, 0)]): readonly SnapshotBall[] {
  return balls;
}

function makeView(): RemoteView {
  return new RemoteView({ interpolationDelayMs: 100 });
}

describe("RemoteView 版本与缓冲", () => {
  it("换局直接采用新球台，不跨尝试插值，迟到旧局快照仍拒绝", () => {
    const view = makeView();
    const old = snapshot(4, 1000, positions([ball(0, 0, 0.6, .9, 0)]));
    view.pushSnapshot(old, 100);
    view.update(110);
    const match = new MatchProgress({ matchId: "test-match", bestOf: 3, firstOpeningPlayer: 0 });
    match.finishFrame(0, [7, 0], "played"); match.readyNextFrame(0); match.readyNextFrame(1);
    const next = { ...snapshot(7, 1100, positions([ball(0, 0, -1, .9, 0)])), match: match.view };
    view.pushSnapshot(next, 200);
    view.update(200);
    expect(view.frameCount).toBe(1);
    expect(view.getCueBallPosition().x).toBe(-1);
    expect(view.pushSnapshot(old, 201)).toBe(false);
  });
  it("旧 version 快照被丢弃，不用旧数据覆盖新数据", () => {
    const view = makeView();
    expect(view.pushSnapshot(snapshot(5, 5_000, positions()), 100)).toBe(true);
    expect(view.pushSnapshot(snapshot(4, 5_100, positions([ball(0, 0, 9, 0.9, 0)])), 110)).toBe(false);
    view.update(5_100);
    expect(view.version).toBe(5);
    expect(view.getBallView(0).renderPosition.x).toBe(0);
  });

  it("同版本但服务器时间倒退的快照被丢弃", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(5, 5_000, positions()), 100);
    expect(view.pushSnapshot(snapshot(5, 5_000, positions([ball(0, 0, 9, 0.9, 0)])), 110)).toBe(false);
    expect(view.pushSnapshot(snapshot(5, 5_010, positions([ball(0, 0, 1, 0.9, 0)])), 120)).toBe(true);
  });

  it("阶段变化按显示时间切换，绝不混合不同回合", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0)]), { phase: "simulating" }), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 1, 0.9, 0)]), { phase: "simulating" }), 110);
    expect(view.frameCount).toBe(2);
    view.pushSnapshot(snapshot(2, 1_100, positions([ball(0, 0, 9, 0.9, 0)]), { phase: "ready" }), 120);
    expect(view.frameCount).toBe(3);
    view.update(1_160);
    expect(view.getBallView(0).renderPosition.x).toBe(1);
    view.update(1_200);
    expect(view.getBallView(0).renderPosition.x).toBe(9);
  });
});

describe("RemoteView 插值", () => {
  it("按两个快照间隔延迟做线性位置插值", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0)])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 1, 0.9, 0)])), 110);
    view.update(1_100);
    expect(view.getBallView(0).renderPosition.x).toBe(0);
    view.update(1_125);
    expect(view.getBallView(0).renderPosition.x).toBeCloseTo(0.5, 10);
    view.update(1_150);
    expect(view.getBallView(0).renderPosition.x).toBe(1);
  });

  it("插值位置随本地时间单调、并在首尾夹取而不外推", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0)])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 1, 0.9, 0)])), 110);
    let previous = -Infinity;
    for (let now = 1_100; now <= 1_260; now += 5) {
      view.update(now);
      const x = view.getBallView(0).renderPosition.x;
      expect(x).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      previous = x;
    }
    view.update(900);
    expect(view.getBallView(0).renderPosition.x).toBe(0);
    view.update(9_000);
    expect(view.getBallView(0).renderPosition.x).toBe(1);
  });

  it("四元数插值结果归一化并走最短路径", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0, true, { x: 0, y: 0, z: 0, w: 1 })])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 0, 0.9, 0, true, { x: 0, y: 0, z: 0, w: -1 })])), 110);
    view.update(1_125);
    const orientation = view.getBallView(0).renderOrientation;
    expect(Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w)).toBeCloseTo(1, 10);
    expect(orientation.w).toBeCloseTo(1, 10);
  });

  it("非单位四元数输入在插值前归一化", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0, true, { x: 0, y: 0, z: 0, w: 2 })])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 0, 0.9, 0, true, { x: 0, y: 0, z: 3, w: 0 })])), 110);
    view.update(1_125);
    const orientation = view.getBallView(0).renderOrientation;
    expect(Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w)).toBeCloseTo(1, 10);
  });

  it("失活按权威 active 显示", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0, true)])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 0, 0.9, 0, false)])), 110);
    view.update(1_110);
    expect(view.getBallView(0).active).toBe(true);
    view.update(1_140);
    expect(view.getBallView(0).active).toBe(false);
  });

  it("提供母球位置、球数与空结果", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions()), 100);
    view.update(1_100);
    expect(view.getBallCount()).toBe(2);
    expect(view.getCueBallPosition()).toMatchObject({ x: 0, y: 0.9, z: 0 });
    expect(view.getResult().firstKissIndex).toBe(0);
    expect(() => view.getBallView(9)).toThrow(RangeError);
  });

  it("保留最近稳定检查点供本地预测恢复", () => {
    const checkpoint: SerialData = { balls: [0, 0.9, 0], mbid: "tiger-club-sno-rgb", evolution: 7 };
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions(), { checkpoint }), 100);
    view.pushSnapshot(snapshot(2, 1_050, positions(), { phase: "simulating", checkpoint: null }), 110);
    expect(view.getCheckpoint()).toEqual(checkpoint);
  });

  it("时钟偏移参与渲染目标时刻", () => {
    const view = makeView();
    view.pushSnapshot(snapshot(1, 1_000, positions([ball(0, 0, 0, 0.9, 0)])), 100);
    view.pushSnapshot(snapshot(1, 1_050, positions([ball(0, 0, 1, 0.9, 0)])), 110);
    view.setClockOffset(1_000);
    view.update(125);
    expect(view.getBallView(0).renderPosition.x).toBeCloseTo(0.5, 10);
  });
});
