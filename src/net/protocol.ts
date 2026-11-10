import type { PauseView } from "../core/match-pause.js";
/**
 * 联机开发原型窄接口 v0（2026-11-07 登记于 docs/architecture.md §4.8）。
 * 仅覆盖第 0—3 单元的双开发席位真实击球原型；不是正式账号、房间、存档或排行榜 API。
 * 纯类型与校验，禁止 DOM、WebSocket 与 Node 依赖。
 */
import type { SerialData } from "../core/simulator/shot-result.js";
import type { FrameResult, MatchProgressView, MatchResult } from "../core/match-progress.js";
export type { FrameResult, MatchProgressView, MatchResult } from "../core/match-progress.js";

export const NET_PROTOCOL_VERSION = 6;
export const DEFAULT_NET_PORT = 8787;
export const DEFAULT_DEV_TOKEN = "dev-local";
export const ROOM_RULESET = "classic" as const;

export type SeatIndex = 0 | 1;
export type StateVersion = number;
export type RoomPhase = "ready" | "simulating" | "deciding" | "between-frames" | "finished";

/** 开发入口只允许两个固定席位；正式账号与游客权限不在本原型内。 */
export const DEV_SEATS: readonly SeatIndex[] = [0, 1];

/** 稳定拒绝码：重复命令返回同一结果，未知/非法请求不改变状态。 */
export const REJECT = {
  BAD_PROTOCOL: "bad-protocol",
  BAD_TOKEN: "bad-dev-token",
  ROOM_FULL: "room-full",
  SEAT_CONFLICT: "seat-conflict",
  NOT_YOUR_TURN: "not-your-turn",
  STALE_VERSION: "stale-version",
  WRONG_PHASE: "wrong-phase",
  INVALID_PARAMS: "invalid-params",
  DUPLICATE_MISMATCH: "duplicate-command-mismatch",
  CUE_BALL_INACTIVE: "cue-ball-inactive",
  UNKNOWN_ACTION: "unknown-action"
} as const;

export type RejectReason = (typeof REJECT)[keyof typeof REJECT];

export interface LobbySeat {
  readonly seat: SeatIndex;
  readonly connected: boolean;
}

export interface LatencyConfig {
  /** 是否开启仅开发环境可用的延迟注入。 */
  readonly enabled: boolean;
  /** 每个方向的固定延迟（毫秒）。配置值按单程生效，往返约为两倍。 */
  readonly inboundMs: number;
  readonly outboundMs: number;
  /** 每个方向随机抖动的上限（毫秒，0 表示无抖动）。 */
  readonly jitterMs: number;
  /** 明确延迟注入的计量方式，避免把配置误读成往返时间。 */
  readonly appliesTo: "one-way-per-direction";
}

export interface MatchConfigView {
  readonly ruleset: typeof ROOM_RULESET;
  readonly mode: "single-play";
  readonly tickHz: number;
  readonly snapshotHz: number;
  /** 服务器接受击球意图到权威触球的固定提前量。 */
  readonly prepareLeadMs: number;
}

export interface SnapshotBall {
  readonly index: number;
  readonly number: number;
  readonly active: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 显示姿态（模拟器 getBallView().renderOrientation）。 */
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
}

export interface ContextView {
  readonly playerIndex: number;
  readonly ballOn: number;
  readonly inHand: 0 | 1 | 2;
  readonly scores: readonly number[];
  readonly round: number;
}

export interface PendingShotView {
  readonly vars: readonly number[];
  readonly shotId: string;
  readonly seat: SeatIndex;
  readonly touchAtServerMs: number;
}

export interface MotionSample {
  readonly serverTimeMs: number;
  readonly balls: readonly SnapshotBall[];
}

export interface SnapshotMessage {
  readonly pause: PauseView;
  readonly motion?: readonly MotionSample[];
  readonly type: "snapshot";
  readonly match: MatchProgressView;
  readonly version: StateVersion;
  readonly eventSeq: number;
  readonly serverTimeMs: number;
  readonly phase: RoomPhase;
  readonly context: ContextView;
  readonly balls: readonly SnapshotBall[];
  /** 仅局面稳定（ready/deciding/finished）时携带，供客户端恢复本地预测模拟器。 */
  readonly checkpoint: SerialData | null;
  readonly pendingShot: PendingShotView | null;
}

export function isPauseView(value: unknown): value is PauseView {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PauseView>;
  return ["running", "requested", "waiting", "paused", "resuming"].includes(String(v.phase)) &&
    (v.requester === null || isSeatIndex(v.requester)) &&
    Array.isArray(v.used) && v.used.length === 2 && v.used.every(n => Number.isSafeInteger(n) && n >= 0) &&
    Array.isArray(v.ready) && v.ready.length === 2 && v.ready.every(n => typeof n === "boolean") &&
    (v.remainingSeconds === null || (typeof v.remainingSeconds === "number" && Number.isFinite(v.remainingSeconds) && v.remainingSeconds >= 0)) &&
    typeof v.countdownSeconds === "number" && Number.isFinite(v.countdownSeconds) && v.countdownSeconds >= 0;
}

export function isMatchProgressView(value: unknown): value is MatchProgressView {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<MatchProgressView>;
  const pair = (items: unknown, type: "number" | "boolean"): boolean =>
    Array.isArray(items) && items.length === 2 && items.every(item => typeof item === type &&
      (type !== "number" || (Number.isSafeInteger(item) && item >= 0)));
  return [match.matchId, match.frameId, match.attemptId].every(id => typeof id === "string" && id.length > 0) &&
    [match.bestOf, match.frameNumber, match.attemptNumber].every(n => typeof n === "number" && Number.isSafeInteger(n) && n > 0) &&
    isSeatIndex(match.firstOpeningPlayer) && isSeatIndex(match.openingPlayer) &&
    ["active", "between-frames", "finished"].includes(String(match.phase)) &&
    pair(match.frameWins, "number") && pair(match.ready, "boolean") &&
    typeof match.shotCount === "number" && Number.isSafeInteger(match.shotCount) && match.shotCount >= 0 &&
    (match.lastShotId === null || typeof match.lastShotId === "string") && Array.isArray(match.frames) &&
    match.frames.every(frame => frame && isSeatIndex(frame.winner) && pair(frame.scores, "number")) &&
    (match.result === null || (typeof match.result === "object" && match.result !== undefined &&
      isSeatIndex(match.result.winner) && typeof match.result.resultId === "string" && pair(match.result.frameWins, "number")));
}

export type ServerEvent =
  | { readonly type: "frame-ended"; readonly frame: FrameResult }
  | { readonly type: "frame-started"; readonly match: MatchProgressView }
  | { readonly type: "match-ended"; readonly result: MatchResult }
  | { readonly type: "shot-prepared"; readonly shotId: string; readonly seat: SeatIndex;
      readonly touchAtServerMs: number; readonly prepareLeadMs: number; readonly vars: readonly number[] }
  | { readonly type: "shot-fired"; readonly shotId: string; readonly seat: SeatIndex;
      readonly touchAtServerMs: number; readonly firedAtServerMs: number }
  | { readonly type: "shot-settled"; readonly shotId: string; readonly seat: SeatIndex;
      readonly score: number; readonly foulCode: number; readonly potted: readonly number[];
      readonly outOfBounds: readonly number[]; readonly settledAtServerMs: number }
  | { readonly type: "shot-cancelled"; readonly shotId: string; readonly reason: RejectReason }
  | { readonly type: "seat-changed"; readonly seats: readonly LobbySeat[] };

export interface ServerEventMessage {
  readonly type: "event";
  readonly seq: number;
  readonly serverTimeMs: number;
  readonly event: ServerEvent;
}

export interface AckMessage {
  readonly type: "ack";
  readonly commandId: string;
  readonly accepted: boolean;
  readonly reason?: RejectReason;
  readonly stateVersion: StateVersion;
  readonly serverTimeMs: number;
  /** 命中已处理命令缓存时返回原裁决，不重复执行。 */
  readonly duplicate: boolean;
  readonly shotId?: string;
  readonly touchAtServerMs?: number;
  readonly detail?: string;
}

export interface WelcomeMessage {
  readonly type: "welcome";
  readonly protocolVersion: number;
  readonly roomId: string;
  readonly seat: SeatIndex;
  readonly seats: readonly LobbySeat[];
  readonly match: MatchConfigView;
  readonly latency: LatencyConfig;
  readonly stateVersion: StateVersion;
  readonly serverTimeMs: number;
}

export interface PongMessage {
  readonly type: "pong";
  readonly id: number;
  readonly clientTimeMs: number;
  readonly serverTimeMs: number;
}

export interface ServerErrorMessage {
  readonly type: "error";
  readonly code: RejectReason;
  readonly message: string;
}

export interface CuePose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface CuePoseMessage {
  readonly type: "cue-pose";
  readonly expectedVersion: StateVersion;
  readonly sequence: number;
  readonly pose: CuePose | null;
}

export interface CuePoseState {
  readonly type: "cue-pose";
  readonly version: StateVersion;
  readonly sequence: number;
  readonly seat: SeatIndex;
  readonly serverTimeMs: number;
  readonly pose: CuePose | null;
}

export function isCuePose(value: unknown): value is CuePose | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const pose = value as Partial<CuePose>;
  return [pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(v => typeof v === "number" && Number.isFinite(v)) &&
    Math.abs(pose.x!) <= 10 && Math.abs(pose.z!) <= 10 && pose.y! >= 0 && pose.y! <= 5 &&
    Math.abs(pose.yaw!) <= 4 * Math.PI && Math.abs(pose.pitch!) <= Math.PI;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | ServerEventMessage | AckMessage | PongMessage | ServerErrorMessage | CuePoseState;

export interface HelloMessage {
  readonly type: "hello";
  readonly protocolVersion: number;
  readonly devToken: string;
  readonly roomId: string;
  readonly requestedSeat?: SeatIndex;
}

export interface PrepareShotAction {
  readonly type: "prepare-shot";
  /** 长度 8 的 Float32 击球参数，语义见 docs/architecture.md §4.2 / spec 02 §4。 */
  readonly vars: readonly number[];
  readonly clientSentAtMs: number;
}

export interface DecideTurnAction {
  readonly type: "decide-turn";
  readonly takeOver: boolean;
}

export interface MatchAction {
  readonly type: "ready-next-frame" | "concede-frame";
  readonly attemptId: string;
}

export interface PauseAction {
  readonly type: "pause-request" | "pause-accept" | "pause-decline" | "pause-cancel" | "pause-ready";
  readonly attemptId: string;
}
export type ClientCommandAction = PrepareShotAction | DecideTurnAction | MatchAction | PauseAction;

export interface CommandMessage {
  readonly type: "command";
  readonly commandId: string;
  readonly expectedVersion: StateVersion;
  readonly action: ClientCommandAction;
}

export interface PingMessage {
  readonly type: "ping";
  readonly id: number;
  readonly clientTimeMs: number;
}

export type ClientMessage = HelloMessage | CommandMessage | PingMessage | CuePoseMessage;

/** 击球参数合法范围：只做服务端防御性校验，不改变核心物理公式。 */
export interface StrokeVarBounds {
  readonly ballRadius: number;
  readonly maxSpeed: number;
  readonly minTipRadius: number;
  readonly maxTipRadius: number;
}

export const DEFAULT_STROKE_BOUNDS: StrokeVarBounds = {
  ballRadius: 0.02625,
  maxSpeed: 200,
  minTipRadius: 0.001,
  maxTipRadius: 0.02
};

/**
 * 返回 null 表示通过；否则返回稳定拒绝码。
 * e[0..2] 是皮头触点的世界坐标（不是相对球心的偏移）；调用方还须校验该点确实落在当前母球表面附近。
 * 合法上限依据 StickController.getStrokeVars：速度 = getTouchSpdWithPower(power) * (3.2 + 6 * power)，满力约 106。
 */
export function validateStrokeVars(vars: unknown, bounds: StrokeVarBounds = DEFAULT_STROKE_BOUNDS): RejectReason | null {
  if (!Array.isArray(vars) || vars.length !== 8) return REJECT.INVALID_PARAMS;
  const values = vars as unknown[];
  if (!values.every(value => typeof value === "number" && Number.isFinite(value))) return REJECT.INVALID_PARAMS;
  const [x, y, z, dx, dy, dz, speed, tipRadius] = values as number[];
  const directionLength = Math.hypot(dx, dy, dz);
  if (directionLength < 0.9 || directionLength > 1.1) return REJECT.INVALID_PARAMS;
  if (speed <= 0 || speed > bounds.maxSpeed) return REJECT.INVALID_PARAMS;
  if (tipRadius < bounds.minTipRadius || tipRadius > bounds.maxTipRadius) return REJECT.INVALID_PARAMS;
  if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 10) return REJECT.INVALID_PARAMS;
  return null;
}

/** 触点必须是当前母球表面附近的点；只做防御性校验，不改动物理参数。 */
export function validateCueContact(vars: readonly number[], cueX: number, cueY: number, cueZ: number,
  ballRadius: number): RejectReason | null {
  if (vars.length !== 8) return REJECT.INVALID_PARAMS;
  const distance = Math.hypot(vars[0] - cueX, vars[1] - cueY, vars[2] - cueZ);
  if (distance < 0.5 * ballRadius || distance > 1.5 * ballRadius) return REJECT.INVALID_PARAMS;
  return null;
}

export function isSeatIndex(value: unknown): value is SeatIndex {
  return value === 0 || value === 1;
}

export function isStateVersion(value: unknown): value is StateVersion {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 解析客户端报文的最小结构校验；完整字段级校验由房间命令处理。 */
export function parseClientMessage(raw: string): { readonly message: ClientMessage } | { readonly reason: RejectReason } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { reason: REJECT.BAD_PROTOCOL };
  }
  if (!value || typeof value !== "object") return { reason: REJECT.BAD_PROTOCOL };
  const candidate = value as { readonly type?: unknown };
  if (candidate.type === "hello") return { message: value as HelloMessage };
  if (candidate.type === "ping") return { message: value as PingMessage };
  if (candidate.type === "cue-pose") return { message: value as CuePoseMessage };
  if (candidate.type === "command") return { message: value as CommandMessage };
  return { reason: REJECT.BAD_PROTOCOL };
}

/** 客户端请求的超时重试：同 ID 重发时服务器必须先查去重缓存。 */
export interface CommandRetryPolicy {
  readonly ackTimeoutMs: number;
  readonly maxRetries: number;
}

export const DEFAULT_COMMAND_RETRY: CommandRetryPolicy = { ackTimeoutMs: 600, maxRetries: 4 };

export function isCommandRetryable(reason: RejectReason | undefined): boolean {
  return reason === undefined || reason === REJECT.STALE_VERSION;
}

export function validMotionSamples(value: unknown, endMs: number, ballCount: number): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8) return false;
  let previous = -Infinity;
  return value.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const sample = entry as Partial<MotionSample>;
    if (typeof sample.serverTimeMs !== "number" || !Number.isFinite(sample.serverTimeMs) ||
        sample.serverTimeMs <= previous || sample.serverTimeMs > endMs || !Array.isArray(sample.balls) ||
        sample.balls.length !== ballCount || ballCount > 64) return false;
    previous = sample.serverTimeMs;
    return sample.balls.every((value: unknown, index: number) => {
      if (!value || typeof value !== "object") return false;
      const ball = value as Partial<SnapshotBall>;
      return ball.index === index && typeof ball.active === "boolean" &&
        [ball.number, ball.x, ball.y, ball.z, ball.qx, ball.qy, ball.qz, ball.qw]
          .every(n => typeof n === "number" && Number.isFinite(n));
    });
  });
}
