import { describe, expect, it } from "vitest";
import { ShotCommandTracker } from "../command-tracker.js";
import type { AckMessage, SnapshotBall } from "../protocol.js";

function tracker(): ShotCommandTracker {
  let id = 0;
  return new ShotCommandTracker({ commandIdFactory: () => `cmd-${++id}` });
}

function balls(x: number): SnapshotBall[] {
  return [{ index: 0, number: 0, active: true, x, y: 0.9, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }];
}

function ack(overrides: Partial<AckMessage> = {}): AckMessage {
  return { type: "ack", commandId: "cmd-1", accepted: true, stateVersion: 4,
    serverTimeMs: 5_100, duplicate: false, shotId: "shot-1", touchAtServerMs: 5_400, ...overrides };
}

const project = (serverMs: number) => serverMs - 3_900;

describe("ShotCommandTracker", () => {
  it("生成命令并冻结原报文用于同 ID 重试", () => {
    const shots = tracker();
    const command = shots.begin(new Float32Array([0, 0.9, 0, 1, 0, 0, 10, 0.005]), 3, 1_000, balls(0));
    expect(command?.commandId).toBe("cmd-1");
    expect(shots.pendingPhase).toBe("awaiting-ack");
    expect(shots.begin(new Float32Array(8), 3, 1_100, null)).toBeNull();
    expect(shots.pollRetry(1_000)).toBeNull();
    expect(shots.pollRetry(1_600)).toBe(command);
    expect(shots.pollRetry(2_200)).toBe(command);
    expect(shots.timing().retries).toBe(2);
  });

  it("Ack 后停止重试并进入 prepared，投影触球使用时钟偏移", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, null);
    shots.onAck(ack(), 1_100, project, 100);
    expect(shots.pendingPhase).toBe("prepared");
    expect(shots.pendingShotId).toBe("shot-1");
    expect(shots.timing().projectedTouchAtMs).toBe(1_500);
    expect(shots.pollRetry(9_999)).toBeNull();
  });

  it("拒绝 Ack 回到 idle", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, null);
    shots.onAck(ack({ accepted: false, reason: "not-your-turn" }), 1_100, project, null);
    expect(shots.pendingPhase).toBe("idle");
    expect(shots.readyForNewShot).toBe(true);
  });

  it("权威事件推进阶段并记录 fired 与结算", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, null);
    shots.handleEvent({ type: "shot-prepared", shotId: "shot-1", seat: 0, touchAtServerMs: 5_400, prepareLeadMs: 300 },
      0, 1_100, project);
    expect(shots.pendingPhase).toBe("prepared");
    shots.handleEvent({ type: "shot-fired", shotId: "shot-1", seat: 0, touchAtServerMs: 5_400, firedAtServerMs: 5_410 },
      0, 1_300, project);
    expect(shots.pendingPhase).toBe("fired");
    expect(shots.timing().firedEventAtMs).toBe(1_300);
    shots.handleEvent({ type: "shot-settled", shotId: "shot-1", seat: 0, score: 0, foulCode: 0,
      potted: [], outOfBounds: [], settledAtServerMs: 6_000 }, 0, 1_600, project);
    expect(shots.pendingPhase).toBe("settled");
    expect(shots.readyForNewShot).toBe(true);
  });

  it("对手事件不改变本地待处理击球", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, null);
    shots.handleEvent({ type: "shot-fired", shotId: "other", seat: 1, touchAtServerMs: 5_400, firedAtServerMs: 5_410 },
      0, 1_300, project);
    expect(shots.pendingPhase).toBe("awaiting-ack");
  });

  it("shot-cancelled 记录原因并回到 idle", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, null);
    shots.handleEvent({ type: "shot-cancelled", shotId: "cmd-1", reason: "wrong-phase" }, 0, 1_200, project);
    expect(shots.pendingPhase).toBe("idle");
    expect(shots.lastCancelReason).toBe("wrong-phase");
  });

  it("首个运动快照只在权威位置变化后记录一次", () => {
    const shots = tracker();
    shots.begin(new Float32Array(8), 3, 1_000, balls(0));
    shots.observeSnapshot(balls(0), 1_100);
    expect(shots.timing().firstMotionSnapshotAtMs).toBeNull();
    shots.observeSnapshot(balls(0.1), 1_200);
    expect(shots.timing().firstMotionSnapshotAtMs).toBe(1_200);
    shots.observeSnapshot(balls(0.2), 1_300);
    expect(shots.timing().firstMotionSnapshotAtMs).toBe(1_200);
  });
});
