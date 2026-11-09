import { GAME_STATE, GameSession } from "../core/game.js";
import type { MeshBody } from "../core/physics/mesh-body.js";
import type { Simulator } from "../core/simulator/simulator.js";
import { Simulator as SimulatorClass } from "../core/simulator/simulator.js";
import type { AIControllerDependencies } from "../core/ai/task-pipeline.js";
import { RouteCache } from "../core/ai/route-cache.js";
import { SeededRandom } from "../core/rng.js";
import {
  DEFAULT_STROKE_BOUNDS, NET_PROTOCOL_VERSION, REJECT, ROOM_RULESET,
  isSeatIndex, validateCueContact, validateStrokeVars,
  type AckMessage, type CommandMessage, type DecideTurnAction, type LobbySeat,
  type MatchAction, type MatchConfigView, type PendingShotView, type PrepareShotAction, type RejectReason,
  type SeatIndex, type ServerEvent, type ServerEventMessage, type SnapshotMessage, type WelcomeMessage
} from "../net/protocol.js";
import { commandSignature, isDecideTurnAction, isMatchAction, isPrepareShotAction } from "./room-command.js";
import { ensureCueBallActive } from "./cue-placement.js";
import { RoomMotion } from "./room-motion.js";
import { RoomMatch } from "./room-match.js";
import { RoomCuePose } from "./cue-pose.js";
import type { CuePoseMessage, CuePoseState } from "../net/protocol.js";
import { NO_LATENCY, buildSnapshot, eventMessage } from "./room-view.js";
import type { RoomCommandResult, RoomJoinOutcome, RoomOptions, RoomTickResult } from "./room-types.js";

export type { RoomJoinOutcome, RoomJoinResult, RoomOptions, RoomTickResult } from "./room-types.js";

interface PendingShot {
  readonly shotId: string;
  readonly seat: SeatIndex;
  readonly vars: Float32Array;
  readonly touchAtServerMs: number;
}

interface ActiveShot {
  readonly shotId: string;
  readonly seat: SeatIndex;
}

interface DedupEntry {
  readonly signature: string;
  readonly ack: AckMessage;
}

interface QueuedEvent {
  readonly event: ServerEvent;
  readonly atMs: number;
}

const MAX_DEDUP_ENTRIES = 256;
/** 单次 tick 最多补算的固定步数，避免长时间卡顿后死循环；正常 60Hz 每 tick 一步。 */
const MAX_CATCH_UP_STEPS = 6;

/** 一个开发房间 = 一个真实 Simulator + 一个 GameSession("single-play", 经典规则)。 */
export class RoomSession {
  readonly roomId: string;
  readonly config: MatchConfigView;
  readonly simulator: Simulator;
  private readonly match: RoomMatch;
  get session(): GameSession { return this.match.session; }
  readonly aiDependencies: Required<AIControllerDependencies>;
  private readonly options: RoomOptions;
  private readonly seatByConnection = new Map<string, SeatIndex>();
  private readonly connections = new Map<SeatIndex, string>();
  private readonly dedup = new Map<string, DedupEntry>();
  private readonly queuedEvents: QueuedEvent[] = [];
  private pendingShot: PendingShot | null = null;
  private activeShot: ActiveShot | null = null;
  private version = 0;
  private eventSeq = 0;
  private lastTickMs: number | null = null;
  private lastNowMs = 0;
  private lastSnapshotMs: number | null = null;
  private accumulatorMs = 0;
  private closed = false;
  private readonly motion = new RoomMotion();
  private readonly poses = new RoomCuePose();

  constructor(roomId: string, options: RoomOptions, mesh: MeshBody) {
    if (!Number.isFinite(options.prepareLeadMs) || options.prepareLeadMs < 0 ||
        !Number.isFinite(options.tickHz) || options.tickHz <= 0 ||
        !Number.isFinite(options.snapshotHz) || options.snapshotHz <= 0) {
      throw new Error("Invalid room options");
    }
    this.roomId = roomId;
    this.options = options;
    this.config = {
      ruleset: ROOM_RULESET, mode: "single-play",
      tickHz: options.tickHz, snapshotHz: options.snapshotHz, prepareLeadMs: options.prepareLeadMs
    };
    this.simulator = new SimulatorClass(mesh);
    this.match = new RoomMatch(this.simulator, options);
    const seeded = new SeededRandom(options.seed);
    this.aiDependencies = { routeCache: new RouteCache(), random: () => seeded.next() };
  }

  get stateVersion(): number { return this.version; }
  get eventSequence(): number { return this.eventSeq; }
  get seats(): readonly LobbySeat[] { return this.seatSnapshot(); }

  get cuePose(): CuePoseState | null {
    const pose = this.poses.latest;
    return this.match.active && !this.closed && !this.pendingShot && this.session.state === GAME_STATE.READY &&
      !this.session.finished && pose?.version === this.version &&
      pose.seat === this.session.context.playerIndex ? pose : null;
  }

  receiveCuePose(connectionId: string, message: CuePoseMessage, nowMs: number): CuePoseState | null {
    const seat = this.seatByConnection.get(connectionId);
    if (!this.match.active || this.closed || this.pendingShot || this.session.finished || this.session.state !== GAME_STATE.READY ||
        seat === undefined || seat !== this.session.context.playerIndex || message.expectedVersion !== this.version) return null;
    return this.poses.accept(connectionId, seat, message, nowMs);
  }

  join(connectionId: string, requestedSeat?: SeatIndex, nowMs = 0): RoomJoinOutcome {
    if (this.closed) return { reason: REJECT.ROOM_FULL };
    this.lastNowMs = nowMs;
    const existing = this.seatByConnection.get(connectionId);
    if (existing !== undefined) {
      return { seat: existing, welcome: this.welcome(existing, nowMs) };
    }
    if (requestedSeat !== undefined && !isSeatIndex(requestedSeat)) return { reason: REJECT.BAD_PROTOCOL };
    if (requestedSeat !== undefined && this.connections.has(requestedSeat)) return { reason: REJECT.SEAT_CONFLICT };
    let seat: SeatIndex | null = requestedSeat ?? null;
    if (seat === null) {
      if (!this.connections.has(0)) seat = 0;
      else if (!this.connections.has(1)) seat = 1;
    }
    if (seat === null) return { reason: REJECT.ROOM_FULL };
    this.seatByConnection.set(connectionId, seat);
    this.connections.set(seat, connectionId);
    this.queueSeatChange(nowMs);
    return { seat, welcome: this.welcome(seat, nowMs) };
  }

  release(connectionId: string): void {
    this.poses.forget(connectionId);
    const seat = this.seatByConnection.get(connectionId);
    if (seat === undefined) return;
    if (this.match.view.ready[seat]) this.version++;
    this.match.progress.clearReady(seat);
    this.seatByConnection.delete(connectionId);
    this.connections.delete(seat);
    this.queueSeatChange(this.lastNowMs);
  }

  command(connectionId: string, message: CommandMessage, nowMs: number): RoomTickResult {
    if (this.closed) return { events: [], snapshot: null };
    this.lastNowMs = nowMs;
    if (this.lastTickMs === null) this.lastTickMs = nowMs;
    const queued = this.flushQueuedEvents();
    const seat = this.seatByConnection.get(connectionId);
    if (seat === undefined) return { ack: this.rejectAck(message.commandId, REJECT.NOT_YOUR_TURN, nowMs), events: queued, snapshot: null };
    const signature = commandSignature(message.action);
    const key = `${seat}:${message.commandId}`;
    const cached = this.dedup.get(key);
    if (cached) {
      const ack = cached.signature === signature
        ? { ...cached.ack, duplicate: true }
        : this.rejectAck(message.commandId, REJECT.DUPLICATE_MISMATCH, nowMs, true);
      return { ack, events: queued, snapshot: null };
    }
    const outcome = this.dispatch(seat, message, nowMs);
    this.remember(key, signature, outcome.ack);
    return { ack: outcome.ack, events: [...queued, ...outcome.events], snapshot: outcome.snapshot };
  }

  tick(nowMs: number): RoomTickResult {
    if (this.closed) return { events: [], snapshot: null };
    this.lastNowMs = nowMs;
    const events = this.flushQueuedEvents();
    if (this.lastTickMs === null) this.lastTickMs = nowMs;
    const touchAtMs = this.pendingShot?.touchAtServerMs;
    if (touchAtMs !== undefined && nowMs >= touchAtMs) this.fire(nowMs, events);

    const stepMs = 1000 / this.options.tickHz;
    const elapsed = Math.max(0, nowMs - Math.max(this.lastTickMs, touchAtMs ?? -Infinity));
    this.lastTickMs = nowMs;
    if (this.session.state === GAME_STATE.SIMULATING) {
      this.accumulatorMs = Math.min(this.accumulatorMs + elapsed, stepMs * MAX_CATCH_UP_STEPS);
      while (this.accumulatorMs >= stepMs && this.session.state === GAME_STATE.SIMULATING) {
        this.session.step(stepMs / 1000);
        this.accumulatorMs -= stepMs;
        if (this.session.state === GAME_STATE.SIMULATING) this.motion.capture(this.simulator, nowMs - this.accumulatorMs);
      }
      if (this.activeShot && this.session.state !== GAME_STATE.SIMULATING) this.settle(nowMs, events);
    } else {
      this.accumulatorMs = 0;
    }

    let snapshot: SnapshotMessage | null = null;
    const interval = 1000 / this.options.snapshotHz;
    if (events.length > 0 ||
        (this.session.state === GAME_STATE.SIMULATING &&
          (this.lastSnapshotMs === null || nowMs - this.lastSnapshotMs >= interval))) {
      snapshot = this.buildSnapshotNow(nowMs);
      this.lastSnapshotMs = nowMs;
      this.motion.sent();
    }
    return { events, snapshot };
  }

  snapshot(nowMs: number): SnapshotMessage {
    this.lastNowMs = nowMs;
    return this.buildSnapshotNow(nowMs);
  }

  close(): void {
    this.closed = true;
    this.pendingShot = null;
    this.activeShot = null;
    this.seatByConnection.clear();
    this.connections.clear();
    this.dedup.clear();
    this.queuedEvents.length = 0;
  }
  private dispatch(seat: SeatIndex, message: CommandMessage, nowMs: number): RoomCommandResult {
    const action = message.action;
    if (!isPrepareShotAction(action) && !isDecideTurnAction(action) && !isMatchAction(action)) {
      return this.cachedReject(message, REJECT.UNKNOWN_ACTION, nowMs);
    }
    if (message.expectedVersion !== this.version) return this.cachedReject(message, REJECT.STALE_VERSION, nowMs);
    if (isMatchAction(action)) return this.matchCommand(seat, message, action, nowMs);
    if (!this.match.active) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    return isPrepareShotAction(action)
      ? this.prepareShot(seat, message, action, nowMs)
      : this.decideTurn(seat, message, action, nowMs);
  }
  private matchCommand(seat: SeatIndex, message: CommandMessage, action: MatchAction, nowMs: number): RoomCommandResult {
    if (action.attemptId !== this.match.view.attemptId) return this.cachedReject(message, REJECT.STALE_VERSION, nowMs);
    let events: readonly ServerEvent[] | null;
    if (action.type === "ready-next-frame") {
      if (this.connections.size !== 2) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
      events = this.match.ready(seat);
    } else {
      if (!this.match.active || this.pendingShot || this.activeShot ||
          ![GAME_STATE.READY, GAME_STATE.DECIDING].some(state => state === this.session.state)) {
        return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
      }
      events = this.match.finish(seat === 0 ? 1 : 0, "conceded");
    }
    if (events === null) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    this.version++;
    const messages = events.map(event => this.pushEvent(event, nowMs));
    return { ack: { type: "ack", commandId: message.commandId, accepted: true,
      stateVersion: this.version, serverTimeMs: nowMs, duplicate: false },
      events: messages, snapshot: this.buildSnapshotNow(nowMs) };
  }
  private prepareShot(seat: SeatIndex, message: CommandMessage, action: PrepareShotAction, nowMs: number): RoomCommandResult {
    const session = this.session;
    if (this.pendingShot || session.state !== GAME_STATE.READY || session.finished) {
      return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    }
    if (seat !== session.context.playerIndex) return this.cachedReject(message, REJECT.NOT_YOUR_TURN, nowMs);
    const bounds = { ...DEFAULT_STROKE_BOUNDS, ballRadius: this.simulator.ballRadius };
    const invalidVars = validateStrokeVars(action.vars, bounds);
    if (invalidVars) return this.cachedReject(message, invalidVars, nowMs);
    if (!this.simulator.getBallAtIndex(0).active) return this.cachedReject(message, REJECT.CUE_BALL_INACTIVE, nowMs);
    const cue = this.simulator.getCueBallPosition();
    const invalidContact = validateCueContact(action.vars, cue.x, cue.y, cue.z, this.simulator.ballRadius);
    if (invalidContact) return this.cachedReject(message, invalidContact, nowMs);
    const vars = Float32Array.from(action.vars);
    if (!session.prepareStroke(seat, vars)) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    const shotId = this.match.progress.reserveShotId()!;
    const touchAtServerMs = nowMs + this.options.prepareLeadMs;
    this.pendingShot = { shotId, seat, vars, touchAtServerMs };
    this.version++;
    const ack: AckMessage = {
      type: "ack", commandId: message.commandId, accepted: true, stateVersion: this.version,
      serverTimeMs: nowMs, duplicate: false, shotId, touchAtServerMs
    };
    const event = this.pushEvent({ type: "shot-prepared", shotId, seat, touchAtServerMs,
      prepareLeadMs: this.options.prepareLeadMs, vars: Array.from(vars) }, nowMs);
    return { ack, events: [event], snapshot: this.buildSnapshotNow(nowMs) };
  }
  private decideTurn(seat: SeatIndex, message: CommandMessage, action: DecideTurnAction, nowMs: number): RoomCommandResult {
    const session = this.session;
    if (session.state !== GAME_STATE.DECIDING) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    const decision = session.decision;
    if (!decision || decision.playerIndex !== seat) return this.cachedReject(message, REJECT.NOT_YOUR_TURN, nowMs);
    const next: SeatIndex = action.takeOver ? seat : seat === 0 ? 1 : 0;
    if (!session.chooseNextPlayer(seat, next)) return this.cachedReject(message, REJECT.WRONG_PHASE, nowMs);
    this.ensureCueBallActive();
    this.version++;
    const ack: AckMessage = {
      type: "ack", commandId: message.commandId, accepted: true, stateVersion: this.version,
      serverTimeMs: nowMs, duplicate: false
    };
    return { ack, events: [], snapshot: this.buildSnapshotNow(nowMs) };
  }
  private fire(nowMs: number, events: ServerEventMessage[]): void {
    const pending = this.pendingShot;
    if (!pending) return;
    const reason = this.canFire(pending.seat);
    if (reason) {
      this.pendingShot = null;
      events.push(this.pushEvent({ type: "shot-cancelled", shotId: pending.shotId, reason }, nowMs));
      return;
    }
    if (!this.session.stroke(pending.seat, pending.vars)) {
      this.pendingShot = null;
      events.push(this.pushEvent({ type: "shot-cancelled", shotId: pending.shotId, reason: REJECT.WRONG_PHASE }, nowMs));
      return;
    }
    this.motion.begin(this.match.view.attemptId);
    this.pendingShot = null;
    this.activeShot = { shotId: pending.shotId, seat: pending.seat };
    this.match.progress.recordStrike(pending.shotId);
    this.version++;
    events.push(this.pushEvent({
      type: "shot-fired", shotId: pending.shotId, seat: pending.seat,
      touchAtServerMs: pending.touchAtServerMs, firedAtServerMs: nowMs
    }, nowMs));
  }
  private canFire(seat: SeatIndex): RejectReason | null {
    if (this.session.finished || this.session.state !== GAME_STATE.READY) return REJECT.WRONG_PHASE;
    if (seat !== this.session.context.playerIndex) return REJECT.NOT_YOUR_TURN;
    return null;
  }
  private settle(nowMs: number, events: ServerEventMessage[]): void {
    const shot = this.activeShot;
    if (!shot) return;
    this.activeShot = null;
    const result = this.simulator.getResult();
    this.version++;
    events.push(this.pushEvent({
      type: "shot-settled", shotId: shot.shotId, seat: shot.seat,
      score: this.session.result.score, foulCode: this.session.result.foulCode,
      potted: [...result.pottedIndices], outOfBounds: [...result.outOfBoundsIndices],
      settledAtServerMs: nowMs
    }, nowMs));
    events.push(...this.match.settle().map(event => this.pushEvent(event, nowMs)));
    if (this.session.state === GAME_STATE.READY) this.ensureCueBallActive();
  }
  private ensureCueBallActive(): boolean {
    return ensureCueBallActive(this.session, this.simulator);
  }
  private welcome(seat: SeatIndex, nowMs: number): WelcomeMessage {
    return {
      type: "welcome", protocolVersion: NET_PROTOCOL_VERSION, roomId: this.roomId, seat,
      seats: this.seatSnapshot(), match: this.config,
      latency: this.options.latency ?? NO_LATENCY,
      stateVersion: this.version, serverTimeMs: nowMs
    };
  }
  private seatSnapshot(): LobbySeat[] {
    return [
      { seat: 0, connected: this.connections.has(0) },
      { seat: 1, connected: this.connections.has(1) }
    ];
  }
  private pendingView(): PendingShotView | null {
    const pending = this.pendingShot;
    return pending ? { shotId: pending.shotId, seat: pending.seat, touchAtServerMs: pending.touchAtServerMs, vars: Array.from(pending.vars) } : null;
  }
  private buildSnapshotNow(nowMs: number): SnapshotMessage {
    return { ...buildSnapshot(this.session, this.version, this.eventSeq, nowMs, this.pendingView(), this.match.view),
      motion: this.pendingShot ? [] : this.motion.view(this.match.view.attemptId) };
  }
  private pushEvent(event: ServerEvent, nowMs: number): ServerEventMessage {
    this.eventSeq++;
    return eventMessage(this.eventSeq, nowMs, event);
  }
  private queueSeatChange(nowMs: number): void {
    this.queuedEvents.push({ event: { type: "seat-changed", seats: this.seatSnapshot() }, atMs: nowMs });
  }
  private flushQueuedEvents(): ServerEventMessage[] {
    const messages = this.queuedEvents.map(queued => this.pushEvent(queued.event, queued.atMs));
    this.queuedEvents.length = 0;
    return messages;
  }
  private cachedReject(message: CommandMessage, reason: RejectReason, nowMs: number): RoomCommandResult {
    const ack = this.rejectAck(message.commandId, reason, nowMs);
    return { ack, events: [], snapshot: null };
  }
  private rejectAck(commandId: string, reason: RejectReason, nowMs: number, duplicate = false): AckMessage {
    return {
      type: "ack", commandId, accepted: false, reason, stateVersion: this.version,
      serverTimeMs: nowMs, duplicate
    };
  }
  private remember(commandId: string, signature: string, ack: AckMessage): void {
    if (this.dedup.size >= MAX_DEDUP_ENTRIES) {
      const oldest = this.dedup.keys().next();
      if (!oldest.done) this.dedup.delete(oldest.value);
    }
    this.dedup.set(commandId, { signature, ack });
  }
}
