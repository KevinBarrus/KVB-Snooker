import type { LobbyView } from "./lobby.js";
/**
 * 联机开发原型客户端会话状态（架构 §4.8 窄接口，零 DOM、零定时器、零物理）。
 * 维护连接/席位/版本/阶段与事件序号；命令重试、出杆阶段与时序测量委托 ShotCommandTracker，
 * ping 时钟偏移委托 PingClock。所有时间由调用方显式传入 nowMs；本模块不推进权威状态。
 */
import {
  NET_PROTOCOL_VERSION,
  type AckMessage,
  type CommandMessage,
  type CommandRetryPolicy,
  type ContextView,
  type LatencyConfig,
  type LobbySeat,
  type MatchConfigView,
  type PendingShotView,
  type PongMessage,
  type RejectReason,
  type RoomPhase,
  type SeatIndex,
  type ServerErrorMessage,
  type ServerEventMessage,
  type SnapshotMessage,
  type StateVersion,
  type WelcomeMessage
} from "./protocol.js";
import { PingClock } from "./clock-sync.js";
import { ShotCommandTracker, type PendingShotPhase, type ShotTimingRecord } from "./command-tracker.js";

export type { PendingShotPhase, ShotTimingRecord } from "./command-tracker.js";

export type NetConnectionState = "idle" | "connecting" | "open" | "ready" | "closed" | "error";

export interface NetSessionOptions {
  readonly ackTimeoutMs?: number;
  readonly maxRetries?: number;
  /** 测试注入；生产默认使用随机 ID。重试始终复用已存储的报文，不重新生成。 */
  readonly commandIdFactory?: () => string;
  readonly clockCapacity?: number;
}

/** 联机开发原型客户端状态机。权威状态只来自 welcome/snapshot/event，客户端不派生裁决。 */
export class NetSessionState {
  private lobbyValue: LobbyView | null = null;
  get lobby(): LobbyView | null { return this.lobbyValue; }
  onLobby(lobby: LobbyView): void { this.lobbyValue = lobby; }
  private readonly clock: PingClock;
  private readonly tracker: ShotCommandTracker;
  private connectionValue: NetConnectionState = "idle";
  private roomIdValue: string | null = null;
  private seatValue: SeatIndex | null = null;
  private seatsValue: readonly LobbySeat[] = [];
  private matchValue: MatchConfigView | null = null;
  private latencyValue: LatencyConfig | null = null;
  private versionValue: StateVersion = -1;
  private phaseValue: RoomPhase = "ready";
  private contextValue: ContextView | null = null;
  private snapshotValue: SnapshotMessage | null = null;
  private lastSnapshotServerMs = -1;
  private lastEventSeq = -1;
  private errorValue: string | null = null;
  private rejectValue: RejectReason | null = null;

  constructor(options: NetSessionOptions = {}) {
    this.clock = new PingClock(options.clockCapacity);
    this.tracker = new ShotCommandTracker({
      ...(options.ackTimeoutMs === undefined ? {} : { ackTimeoutMs: options.ackTimeoutMs }),
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options.commandIdFactory === undefined ? {} : { commandIdFactory: options.commandIdFactory })
    });
  }

  get connectionState(): NetConnectionState { return this.connectionValue; }
  get roomId(): string | null { return this.roomIdValue; }
  get seat(): SeatIndex | null { return this.seatValue; }
  get seats(): readonly LobbySeat[] { return this.seatsValue; }
  get matchConfig(): MatchConfigView | null { return this.matchValue; }
  get latencyConfig(): LatencyConfig | null { return this.latencyValue; }
  get version(): StateVersion { return this.versionValue; }
  get paused(): boolean { return this.snapshotValue?.pause.phase === "paused" || this.snapshotValue?.pause.phase === "resuming"; }
  get phase(): RoomPhase { return this.phaseValue; }
  get context(): ContextView | null { return this.contextValue; }
  get latestSnapshot(): SnapshotMessage | null { return this.snapshotValue; }
  get lastError(): string | null { return this.errorValue; }
  get lastRejectReason(): RejectReason | null { return this.rejectValue; }
  get lastCancelReason(): RejectReason | null { return this.tracker.lastCancelReason; }
  get pendingPhase(): PendingShotPhase { return this.tracker.pendingPhase; }
  get pendingCommandId(): string | null { return this.tracker.pendingCommandId; }
  get pendingShotId(): string | null { return this.tracker.pendingShotId; }
  get touchAtServerMs(): number | null { return this.tracker.touchAtServerMs; }
  get retryPolicy(): CommandRetryPolicy { return this.tracker.retryPolicy; }
  get clockOffsetMs(): number | null { return this.clock.offsetMs; }
  get rttMs(): number | null { return this.clock.rttMs; }
  /** 服务器当前待处理击球（只读快照附带），仅调试/测试读取。 */
  get pendingServerShot(): PendingShotView | null { return this.snapshotValue?.pendingShot ?? null; }

  timing(): ShotTimingRecord { return this.tracker.timing(); }

  /** 本地席位是否为当前持权者；不判断阶段与准备状态。 */
  isLocalTurn(): boolean {
    return this.seatValue !== null && this.contextValue !== null &&
      this.contextValue.playerIndex === this.seatValue;
  }

  /** 犯规/选择阶段：本地席位是否拥有下一步选择权（最简 decide-turn）。 */
  canDecide(): boolean {
    return this.lobbyValue?.phase !== "waiting" && !this.paused && this.connectionValue === "ready" && this.phaseValue === "deciding" &&
      this.seatValue !== null && this.contextValue !== null && this.contextValue.playerIndex === this.seatValue;
  }

  /** 是否允许在本机发起新出杆意图：稳定阶段、本地球权、无未完成意图。 */
  canLaunch(): boolean {
    return this.lobbyValue?.phase !== "waiting" && !this.paused && this.connectionValue === "ready" && this.phaseValue === "ready" &&
      this.versionValue >= 0 && this.tracker.readyForNewShot && this.isLocalTurn();
  }

  /** 发起连接前清空会话权威状态；时钟样本保留（同一客户端时钟）。 */
  beginConnect(nowMs: number): void {
    void nowMs;
    this.lobbyValue = null;
    this.connectionValue = "connecting";
    this.errorValue = null;
    this.rejectValue = null;
    this.snapshotValue = null;
    this.contextValue = null;
    this.versionValue = -1;
    this.lastSnapshotServerMs = -1;
    this.lastEventSeq = -1;
  }

  onSocketOpen(nowMs: number): void {
    void nowMs;
    if (this.connectionValue === "connecting") this.connectionValue = "open";
  }

  onWelcome(welcome: WelcomeMessage, nowMs: number): void {
    if (welcome.protocolVersion !== NET_PROTOCOL_VERSION) {
      this.errorValue = `bad-protocol: 客户端 ${NET_PROTOCOL_VERSION}，服务器 ${welcome.protocolVersion}`;
      this.connectionValue = "error";
      return;
    }
    this.connectionValue = "ready";
    this.roomIdValue = welcome.roomId;
    this.seatValue = welcome.seat;
    this.seatsValue = welcome.seats;
    this.matchValue = welcome.match;
    this.latencyValue = welcome.latency;
    this.versionValue = welcome.stateVersion;
    this.clock.seed(welcome.serverTimeMs, nowMs);
  }

  onSnapshot(snapshot: SnapshotMessage, nowMs: number): boolean {
    if (this.connectionValue !== "ready") return false;
    if (snapshot.version < this.versionValue) return false;
    if (snapshot.version === this.versionValue && snapshot.serverTimeMs <= this.lastSnapshotServerMs) return false;
    this.versionValue = snapshot.version;
    this.phaseValue = snapshot.phase;
    this.contextValue = snapshot.context;
    this.snapshotValue = snapshot;
    if (this.lobbyValue && snapshot.match.phase === "finished") this.lobbyValue = { ...this.lobbyValue, phase: "finished" };
    this.lastSnapshotServerMs = snapshot.serverTimeMs;
    this.tracker.observeSnapshot(snapshot.balls, nowMs);
    return true;
  }

  /** 事件按 seq 单调去重；返回是否应用。 */
  onEvent(message: ServerEventMessage, nowMs: number): boolean {
    if (message.seq <= this.lastEventSeq) return false;
    this.lastEventSeq = message.seq;
    if (message.event.type === "seat-changed") {
      this.seatsValue = message.event.seats;
      return true;
    }
    this.tracker.handleEvent(message.event, this.seatValue, nowMs, serverMs => this.clock.project(serverMs));
    return true;
  }

  onAck(ack: AckMessage, nowMs: number): void {
    if (!ack.accepted) this.rejectValue = ack.reason ?? null;
    this.tracker.onAck(ack, nowMs, serverMs => this.clock.project(serverMs), this.clock.rttMs);
  }

  onPong(pong: PongMessage, nowMs: number): void {
    this.clock.add(pong.serverTimeMs, pong.clientTimeMs, nowMs);
  }

  onServerError(error: ServerErrorMessage, nowMs: number): void {
    void nowMs;
    this.errorValue = `${error.code}: ${error.message}`;
    if (error.code === "bad-dev-token" || error.code === "bad-protocol" || error.code === "room-full") {
      this.connectionValue = "error";
    }
  }

  onClose(): void {
    this.connectionValue = "closed";
  }

  /** 冻结本杆击球意图并生成新命令；返回 null 表示当前不允许出杆。 */
  beginShot(vars: ArrayLike<number>, nowMs: number): CommandMessage | null {
    if (!this.canLaunch()) return null;
    return this.tracker.begin(vars, this.versionValue, nowMs, this.snapshotValue?.balls ?? null);
  }

  /** 超时后用同一 commandId、同一报文重发；返回 null 表示无需重试。 */
  pollRetry(nowMs: number): CommandMessage | null {
    return this.tracker.pollRetry(nowMs);
  }

  noteAnimationTouch(nowMs: number): void {
    this.tracker.noteAnimationTouch(nowMs);
  }

  projectServerTime(serverTimeMs: number): number {
    return this.clock.project(serverTimeMs);
  }

  projectedTouchAtMs(): number | null {
    return this.tracker.projectedTouchAtMs();
  }
}
