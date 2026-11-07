/**
 * 联机开发原型出杆命令跟踪：命令身份与超时重试、待处理击球阶段、最近一杆时序测量。
 * 纯状态，零 DOM、零物理、零定时器；所有时间由调用方显式传入 nowMs。
 * 重试始终复用同一 commandId 与原报文，不自行回滚或重新生成出杆。
 */
import {
  DEFAULT_COMMAND_RETRY,
  type AckMessage,
  type CommandMessage,
  type CommandRetryPolicy,
  type RejectReason,
  type SeatIndex,
  type ServerEvent,
  type SnapshotBall
} from "./protocol.js";

/** 本地出杆意图阶段：idle → awaiting-ack → prepared → fired → settled。 */
export type PendingShotPhase = "idle" | "awaiting-ack" | "prepared" | "fired" | "settled";

/** 最近一杆的时序测量，值均为本地时钟（默认 performance.now）；无值用 null。 */
export interface ShotTimingRecord {
  readonly spaceAtMs: number | null;
  readonly commandSentAtMs: number | null;
  readonly ackAtMs: number | null;
  readonly rttMs: number | null;
  readonly projectedTouchAtMs: number | null;
  readonly animationTouchAtMs: number | null;
  readonly firstMotionSnapshotAtMs: number | null;
  readonly firedEventAtMs: number | null;
  readonly retries: number;
  readonly shotId: string | null;
}

export interface ShotCommandTrackerOptions {
  readonly ackTimeoutMs?: number;
  readonly maxRetries?: number;
  /** 测试注入；生产默认使用随机 ID。重试始终复用已存储的报文，不重新生成。 */
  readonly commandIdFactory?: () => string;
}

interface MutableShotTiming {
  spaceAtMs: number | null;
  commandSentAtMs: number | null;
  ackAtMs: number | null;
  rttMs: number | null;
  projectedTouchAtMs: number | null;
  animationTouchAtMs: number | null;
  firstMotionSnapshotAtMs: number | null;
  firedEventAtMs: number | null;
  retries: number;
  shotId: string | null;
}

interface BallPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const MOTION_EPSILON_SQ = 1e-8;
let commandSequence = 0;

function defaultCommandId(): string {
  commandSequence = (commandSequence + 1) % 1_000_000;
  const random = Math.floor(Math.random() * 0xffff_ffff).toString(36);
  const clock = typeof Date.now === "function" ? Date.now().toString(36) : "0";
  return `c-${clock}-${commandSequence.toString(36)}-${random}`;
}

function emptyTiming(): MutableShotTiming {
  return { spaceAtMs: null, commandSentAtMs: null, ackAtMs: null, rttMs: null,
    projectedTouchAtMs: null, animationTouchAtMs: null, firstMotionSnapshotAtMs: null,
    firedEventAtMs: null, retries: 0, shotId: null };
}

export class ShotCommandTracker {
  private readonly ackTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly commandIdFactory: () => string;
  private pendingPhaseValue: PendingShotPhase = "idle";
  private pendingCommand: CommandMessage | null = null;
  private pendingShotIdValue: string | null = null;
  private touchAtServerMsValue: number | null = null;
  private nextRetryAtMs = Infinity;
  private timingValue = emptyTiming();
  private previousPositions: readonly BallPoint[] | null = null;
  private cancelValue: RejectReason | null = null;

  constructor(options: ShotCommandTrackerOptions = {}) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_COMMAND_RETRY.ackTimeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULT_COMMAND_RETRY.maxRetries;
    this.commandIdFactory = options.commandIdFactory ?? defaultCommandId;
  }

  get pendingPhase(): PendingShotPhase { return this.pendingPhaseValue; }
  get pendingCommandId(): string | null { return this.pendingCommand?.commandId ?? null; }
  get pendingShotId(): string | null { return this.pendingShotIdValue; }
  get touchAtServerMs(): number | null { return this.touchAtServerMsValue; }
  get lastCancelReason(): RejectReason | null { return this.cancelValue; }
  get retryPolicy(): CommandRetryPolicy { return { ackTimeoutMs: this.ackTimeoutMs, maxRetries: this.maxRetries }; }
  get readyForNewShot(): boolean {
    return this.pendingPhaseValue === "idle" || this.pendingPhaseValue === "settled";
  }

  timing(): ShotTimingRecord { return { ...this.timingValue }; }

  /** 冻结击球意图并生成新命令；调用方保证当前允许出杆（稳定阶段、本地球权）。 */
  begin(vars: ArrayLike<number>, expectedVersion: number, nowMs: number,
    snapshotBalls: readonly SnapshotBall[] | null): CommandMessage | null {
    if (!this.readyForNewShot || vars.length !== 8) return null;
    const values: number[] = [];
    for (let index = 0; index < 8; ++index) {
      const value = vars[index];
      if (!Number.isFinite(value)) return null;
      values.push(value);
    }
    const command: CommandMessage = {
      type: "command",
      commandId: this.commandIdFactory(),
      expectedVersion,
      action: { type: "prepare-shot", vars: values, clientSentAtMs: nowMs }
    };
    this.timingValue = emptyTiming();
    this.timingValue.spaceAtMs = nowMs;
    this.timingValue.commandSentAtMs = nowMs;
    this.pendingCommand = command;
    this.pendingPhaseValue = "awaiting-ack";
    this.pendingShotIdValue = null;
    this.touchAtServerMsValue = null;
    this.cancelValue = null;
    this.nextRetryAtMs = nowMs + this.ackTimeoutMs;
    this.previousPositions = snapshotBalls?.map(ball => ({ x: ball.x, y: ball.y, z: ball.z })) ?? null;
    return command;
  }

  /** 超时后用同一 commandId、同一报文重发；返回 null 表示无需重试（已确认、已放弃或未在等待）。 */
  pollRetry(nowMs: number): CommandMessage | null {
    const command = this.pendingCommand;
    if (!command || command.action.type !== "prepare-shot") return null;
    if (this.timingValue.ackAtMs !== null) return null;
    if (nowMs < this.nextRetryAtMs) return null;
    if (this.timingValue.retries >= this.maxRetries) return null;
    this.timingValue.retries += 1;
    this.nextRetryAtMs = nowMs + this.ackTimeoutMs;
    return command;
  }

  onAck(ack: AckMessage, nowMs: number, projectServerTime: (serverMs: number) => number, rttMs: number | null): void {
    const command = this.pendingCommand;
    if (!command || command.commandId !== ack.commandId) return;
    this.pendingCommand = null;
    this.nextRetryAtMs = Infinity;
    this.timingValue.ackAtMs ??= nowMs;
    this.timingValue.rttMs ??= rttMs;
    if (!ack.accepted) {
      this.pendingPhaseValue = "idle";
      return;
    }
    this.pendingShotIdValue = ack.shotId ?? this.pendingShotIdValue;
    if (ack.touchAtServerMs !== undefined) {
      this.touchAtServerMsValue = ack.touchAtServerMs;
      this.timingValue.projectedTouchAtMs ??= projectServerTime(ack.touchAtServerMs);
    }
    this.timingValue.shotId = this.pendingShotIdValue;
    if (this.pendingPhaseValue === "awaiting-ack") this.pendingPhaseValue = "prepared";
  }

  /** 处理只影响本地待处理击球的权威事件。 */
  handleEvent(event: ServerEvent, seat: SeatIndex | null, nowMs: number,
    projectServerTime: (serverMs: number) => number): void {
    switch (event.type) {
      case "shot-prepared":
        if (event.seat !== seat || this.pendingPhaseValue === "idle") return;
        this.pendingShotIdValue = event.shotId;
        this.touchAtServerMsValue = event.touchAtServerMs;
        this.timingValue.projectedTouchAtMs ??= projectServerTime(event.touchAtServerMs);
        this.timingValue.shotId = event.shotId;
        this.pendingPhaseValue = "prepared";
        return;
      case "shot-fired":
        if (event.seat !== seat || this.pendingPhaseValue === "idle") return;
        if (this.pendingShotIdValue !== null && event.shotId !== this.pendingShotIdValue) return;
        this.pendingShotIdValue = event.shotId;
        this.touchAtServerMsValue ??= event.touchAtServerMs;
        this.timingValue.projectedTouchAtMs ??= projectServerTime(event.touchAtServerMs);
        this.timingValue.firedEventAtMs ??= nowMs;
        this.pendingPhaseValue = "fired";
        return;
      case "shot-settled":
        if (event.seat !== seat || this.pendingPhaseValue === "idle") return;
        if (this.pendingShotIdValue !== null && event.shotId !== this.pendingShotIdValue) return;
        this.pendingShotIdValue = event.shotId;
        this.pendingPhaseValue = "settled";
        this.pendingCommand = null;
        this.nextRetryAtMs = Infinity;
        return;
      case "shot-cancelled":
        if (this.pendingPhaseValue === "idle") return;
        if (this.pendingShotIdValue !== null && event.shotId !== this.pendingShotIdValue) return;
        this.cancelValue = event.reason;
        this.pendingPhaseValue = "idle";
        this.pendingCommand = null;
        this.nextRetryAtMs = Infinity;
        return;
    }
  }

  /** 运动快照监测：仅用于记录首个运动快照时刻，不改变任何权威状态。 */
  observeSnapshot(balls: readonly SnapshotBall[], nowMs: number): void {
    const positions = balls.map(ball => ({ x: ball.x, y: ball.y, z: ball.z }));
    if (this.pendingPhaseValue === "idle" || this.timingValue.firstMotionSnapshotAtMs !== null) {
      this.previousPositions = positions;
      return;
    }
    const previous = this.previousPositions;
    if (previous === null || previous.length !== positions.length) {
      this.previousPositions = positions;
      return;
    }
    for (let index = 0; index < positions.length; ++index) {
      const dx = positions[index].x - previous[index].x;
      const dy = positions[index].y - previous[index].y;
      const dz = positions[index].z - previous[index].z;
      if (dx * dx + dy * dy + dz * dz > MOTION_EPSILON_SQ) {
        this.timingValue.firstMotionSnapshotAtMs = nowMs;
        break;
      }
    }
    this.previousPositions = positions;
  }

  noteAnimationTouch(nowMs: number): void {
    this.timingValue.animationTouchAtMs ??= nowMs;
  }

  projectedTouchAtMs(): number | null {
    return this.timingValue.projectedTouchAtMs;
  }
}
