import { MatchProgress } from "../../core/match-progress.js";
import { describe, expect, it } from "vitest";
import {
  NetSessionState,
  type NetSessionOptions
} from "../net-session-state.js";
import {
  NET_PROTOCOL_VERSION,
  type AckMessage,
  type ContextView,
  type PendingShotView,
  type RoomPhase,
  type SeatIndex,
  type ServerEvent,
  type ServerEventMessage,
  type SnapshotBall,
  type SnapshotMessage,
  type StateVersion,
  type WelcomeMessage
} from "../protocol.js";
import type { SerialData } from "../../core/simulator/shot-result.js";

const CONTEXT: ContextView = { playerIndex: 0, ballOn: 2, inHand: 0, scores: [0, 0], round: 0 };

function welcome(seat: SeatIndex = 0, stateVersion = 3): WelcomeMessage {
  return {
    type: "welcome", protocolVersion: NET_PROTOCOL_VERSION, roomId: "room-a", seat,
    seats: [{ seat: 0, connected: true }, { seat: 1, connected: true }],
    match: { ruleset: "classic", mode: "single-play", tickHz: 60, snapshotHz: 20, prepareLeadMs: 300 },
    latency: { enabled: false, inboundMs: 0, outboundMs: 0, jitterMs: 0, appliesTo: "one-way-per-direction" },
    stateVersion, serverTimeMs: 5_000
  };
}

function ball(index: number, number: number, x: number, y: number, z: number, active = true): SnapshotBall {
  return { index, number, active, x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 };
}

function snapshot(version: StateVersion, serverTimeMs: number,
  options: { balls?: readonly SnapshotBall[]; phase?: RoomPhase; eventSeq?: number; context?: ContextView;
    checkpoint?: SerialData | null; pendingShot?: PendingShotView | null } = {}): SnapshotMessage {
  return {
    type: "snapshot", match: new MatchProgress({ matchId: "test-match", bestOf: 3, firstOpeningPlayer: 0 }).view, version, eventSeq: options.eventSeq ?? version, serverTimeMs,
    phase: options.phase ?? "ready", context: options.context ?? CONTEXT,
    balls: options.balls ?? [ball(0, 0, 0, 0.9, 0), ball(1, 1, 0.5, 0.9, 0)],
    checkpoint: options.checkpoint === undefined ? null : options.checkpoint,
    pendingShot: options.pendingShot ?? null
  };
}

function event(seq: number, serverTimeMs: number, payload: ServerEvent): ServerEventMessage {
  return { type: "event", seq, serverTimeMs, event: payload };
}

function makeSession(options: NetSessionOptions = {}): NetSessionState {
  let id = 0;
  return new NetSessionState({ commandIdFactory: () => `cmd-${++id}`, ...options });
}

function readySession(seat: SeatIndex = 0, playerIndex = 0): NetSessionState {
  const session = makeSession();
  session.beginConnect(0);
  session.onSocketOpen(1);
  session.onWelcome(welcome(seat), 2);
  session.onSnapshot(snapshot(3, 5_000, { context: { ...CONTEXT, playerIndex } }), 3);
  return session;
}

describe("NetSessionState 连接与快照", () => {
  it("welcome 建立席位、版本与时钟种子", () => {
    const session = makeSession();
    session.beginConnect(0);
    session.onSocketOpen(1);
    session.onWelcome(welcome(1, 9), 2);
    expect(session.connectionState).toBe("ready");
    expect(session.seat).toBe(1);
    expect(session.roomId).toBe("room-a");
    expect(session.version).toBe(9);
    expect(session.phase).toBe("ready");
    expect(session.projectServerTime(5_000)).toBe(2);
  });

  it("协议版本不匹配进入错误状态", () => {
    const session = makeSession();
    session.beginConnect(0);
    session.onWelcome({ ...welcome(), protocolVersion: NET_PROTOCOL_VERSION + 1 }, 1);
    expect(session.connectionState).toBe("error");
    expect(session.lastError).toContain("bad-protocol");
  });

  it("旧版本快照被丢弃，同版本更新的服务器时间被接受", () => {
    const session = readySession();
    expect(session.onSnapshot(snapshot(2, 5_100), 10)).toBe(false);
    expect(session.version).toBe(3);
    expect(session.onSnapshot(snapshot(3, 5_050), 11)).toBe(true);
    expect(session.onSnapshot(snapshot(3, 5_040), 12)).toBe(false);
    expect(session.context?.round).toBe(0);
  });

  it("事件按 seq 去重", () => {
    const session = readySession();
    const seats = [{ seat: 0, connected: false }] as const;
    expect(session.onEvent(event(4, 5_000, { type: "seat-changed", seats }), 10)).toBe(true);
    expect(session.seats).toEqual(seats);
    expect(session.onEvent(event(4, 5_000, { type: "seat-changed", seats: [] }), 11)).toBe(false);
    expect(session.seats).toEqual(seats);
  });
});

describe("NetSessionState 命令身份与重试", () => {
  it("冻结击球意图并携带当前版本", () => {
    const session = readySession();
    const command = session.beginShot(new Float32Array([0, 0.9, 0, 1, 0, 0, 10, 0.005]), 1_000);
    expect(command).not.toBeNull();
    expect(command?.type).toBe("command");
    expect(command?.expectedVersion).toBe(3);
    expect(command?.action.type).toBe("prepare-shot");
    expect(session.pendingPhase).toBe("awaiting-ack");
    expect(session.beginShot(new Float32Array(8), 1_001)).toBeNull();
  });

  it("超时重发同一 commandId 与原报文，不重新生成出杆", () => {
    const session = readySession();
    const command = session.beginShot(new Float32Array([0, 0.9, 0, 1, 0, 0, 10, 0.005]), 1_000);
    expect(session.pollRetry(1_000)).toBeNull();
    expect(session.pollRetry(1_600)).toBe(command);
    expect(session.pollRetry(1_600)).toBeNull();
    expect(session.pollRetry(2_200)).toBe(command);
    expect(session.timing().retries).toBe(2);
  });

  it("达到最大重试次数后停止", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 0);
    for (let retry = 0; retry < 4; ++retry) expect(session.pollRetry(1_000 * (retry + 1))).not.toBeNull();
    expect(session.pollRetry(10_000)).toBeNull();
    expect(session.timing().retries).toBe(4);
  });

  it("接受 Ack 后停止重试并进入 prepared", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 1_000);
    const ack: AckMessage = { type: "ack", commandId: "cmd-1", accepted: true, stateVersion: 4,
      serverTimeMs: 5_100, duplicate: false, shotId: "shot-1", touchAtServerMs: 5_300 };
    session.onAck(ack, 1_100);
    expect(session.pendingPhase).toBe("prepared");
    expect(session.pendingShotId).toBe("shot-1");
    expect(session.timing().ackAtMs).toBe(1_100);
    expect(session.pollRetry(9_999)).toBeNull();
  });

  it("拒绝 Ack 不产生执行，回到 idle 并记录原因", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 1_000);
    session.onAck({ type: "ack", commandId: "cmd-1", accepted: false, reason: "not-your-turn",
      stateVersion: 3, serverTimeMs: 5_100, duplicate: false }, 1_100);
    expect(session.pendingPhase).toBe("idle");
    expect(session.lastRejectReason).toBe("not-your-turn");
    expect(session.timing().ackAtMs).toBe(1_100);
    expect(session.pollRetry(9_999)).toBeNull();
  });

  it("迟到/无关 Ack 不改变当前命令", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 1_000);
    session.onAck({ type: "ack", commandId: "cmd-other", accepted: true,
      stateVersion: 4, serverTimeMs: 5_000, duplicate: false }, 1_100);
    expect(session.pendingPhase).toBe("awaiting-ack");
    expect(session.timing().ackAtMs).toBeNull();
  });
});

describe("NetSessionState 出杆阶段与时序记录", () => {
  it("记录 Space、命令、Ack、投影触球、动画触球、首个运动快照与 shot-fired", () => {
    const session = readySession();
    session.onPong({ type: "pong", id: 1, clientTimeMs: 1_000, serverTimeMs: 5_000 }, 1_100);
    session.beginShot(new Float32Array(8), 1_200);
    session.onAck({ type: "ack", commandId: "cmd-1", accepted: true, stateVersion: 4,
      serverTimeMs: 5_100, duplicate: false, shotId: "shot-1", touchAtServerMs: 5_400 }, 1_300);
    expect(session.projectedTouchAtMs()).toBe(1_450);
    session.noteAnimationTouch(1_420);
    session.onSnapshot(snapshot(4, 5_300, { phase: "simulating", pendingShot: { shotId: "shot-1", seat: 0, touchAtServerMs: 5_400, vars: [0, .9, 0, 1, 0, 0, 20, .005] } }), 1_320);
    session.onSnapshot(snapshot(4, 5_350, { phase: "simulating",
      balls: [ball(0, 0, 0.1, 0.9, 0), ball(1, 1, 0.5, 0.9, 0)],
      pendingShot: { shotId: "shot-1", seat: 0, touchAtServerMs: 5_400, vars: [0, .9, 0, 1, 0, 0, 20, .005] } }), 1_370);
    session.onEvent(event(1, 5_400, { type: "shot-fired", shotId: "shot-1", seat: 0, touchAtServerMs: 5_400, firedAtServerMs: 5_410 }), 1_400);
    expect(session.pendingPhase).toBe("fired");
    const timing = session.timing();
    expect(timing.spaceAtMs).toBe(1_200);
    expect(timing.commandSentAtMs).toBe(1_200);
    expect(timing.ackAtMs).toBe(1_300);
    expect(timing.rttMs).toBe(100);
    expect(timing.projectedTouchAtMs).toBe(1_450);
    expect(timing.animationTouchAtMs).toBe(1_420);
    expect(timing.firstMotionSnapshotAtMs).toBe(1_370);
    expect(timing.firedEventAtMs).toBe(1_400);
    expect(timing.shotId).toBe("shot-1");
  });

  it("shot-settled 结束本杆，允许下一杆并可重新发起", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 1_000);
    session.onAck({ type: "ack", commandId: "cmd-1", accepted: true, stateVersion: 4,
      serverTimeMs: 5_000, duplicate: false, shotId: "shot-1", touchAtServerMs: 5_200 }, 1_100);
    session.onEvent(event(1, 5_200, { type: "shot-fired", shotId: "shot-1", seat: 0, touchAtServerMs: 5_200, firedAtServerMs: 5_210 }), 1_200);
    session.onEvent(event(2, 6_000, { type: "shot-settled", shotId: "shot-1", seat: 0, score: 0,
      foulCode: 0, potted: [], outOfBounds: [], settledAtServerMs: 6_000 }), 1_600);
    expect(session.pendingPhase).toBe("settled");
    session.onSnapshot(snapshot(5, 6_000, { phase: "ready" }), 1_610);
    expect(session.canLaunch()).toBe(true);
    const next = session.beginShot(new Float32Array(8), 1_700);
    expect(next?.commandId).toBe("cmd-2");
    expect(session.timing().spaceAtMs).toBe(1_700);
  });

  it("shot-cancelled 回到 idle 并记录原因", () => {
    const session = readySession();
    session.beginShot(new Float32Array(8), 1_000);
    session.onAck({ type: "ack", commandId: "cmd-1", accepted: true, stateVersion: 4,
      serverTimeMs: 5_000, duplicate: false, shotId: "shot-1", touchAtServerMs: 5_200 }, 1_100);
    session.onEvent(event(1, 5_100, { type: "shot-cancelled", shotId: "shot-1", reason: "wrong-phase" }), 1_200);
    expect(session.pendingPhase).toBe("idle");
    expect(session.lastCancelReason).toBe("wrong-phase");
  });

  it("非本地球权不能发起命令", () => {
    const session = readySession(1, 0);
    expect(session.isLocalTurn()).toBe(false);
    expect(session.canLaunch()).toBe(false);
    expect(session.beginShot(new Float32Array(8), 1_000)).toBeNull();
  });

  it("非稳定阶段不能发起命令", () => {
    const session = readySession();
    session.onSnapshot(snapshot(4, 5_010, { phase: "simulating" }), 10);
    expect(session.canLaunch()).toBe(false);
  });
});
