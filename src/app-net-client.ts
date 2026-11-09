/**
 * 联机开发原型的浏览器传输层：原生 WebSocket 收发、hello、1 秒 ping、
 * prepare-shot 未确认时的同 ID 自动重试（超时/次数可配置），以及最小结构校验。
 * 只做传输，不裁决规则、不推进物理；报文类型唯一来源是 src/net/protocol.ts。
 */
import {
  DEFAULT_COMMAND_RETRY,
  NET_PROTOCOL_VERSION,
  isSeatIndex,
  isStateVersion,
  isCuePose,
  isMatchProgressView, validMotionSamples,
  type CuePoseMessage,
  type CuePoseState,
  type ClientMessage,
  type CommandMessage,
  type HelloMessage,
  type PingMessage,
  type ServerMessage
} from "./net/protocol.js";

export type NetSocketState = "idle" | "connecting" | "open" | "closed" | "error";

export interface NetClientOptions {
  readonly url: string;
  readonly roomId: string;
  readonly devToken: string;
  readonly requestedSeat?: 0 | 1;
  readonly onMessage: (message: ServerMessage) => void;
  readonly now?: () => number;
  readonly ackTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly pingIntervalMs?: number;
  /** 超时后返回要原样重发的命令；null 表示已确认/已放弃。缺省则传输层自行重发原命令。 */
  readonly retrySource?: (nowMs: number) => CommandMessage | null;
  readonly onRetry?: (command: CommandMessage, attempt: number) => void;
  readonly onStateChange?: (state: NetSocketState) => void;
}

interface PendingCommand {
  readonly message: CommandMessage;
  retries: number;
}

const KNOWN_SERVER_TYPES = ["welcome", "snapshot", "event", "ack", "pong", "error", "cue-pose"] as const;

/** 开发原型客户端连接。浏览器专用（WebSocket/DOM），由联机装配根创建。 */
export class NetClient {
  private socketValue: WebSocket | null = null;
  private stateValue: NetSocketState = "idle";
  private errorValue: string | null = null;
  private pending: PendingCommand | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;
  private readonly now: () => number;
  private readonly ackTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly pingIntervalMs: number;

  constructor(private readonly options: NetClientOptions) {
    this.now = options.now ?? (() => performance.now());
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_COMMAND_RETRY.ackTimeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULT_COMMAND_RETRY.maxRetries;
    this.pingIntervalMs = options.pingIntervalMs ?? 1_000;
  }

  get connectionState(): NetSocketState { return this.stateValue; }
  get lastError(): string | null { return this.errorValue; }
  get url(): string { return this.options.url; }
  get pendingCommandId(): string | null { return this.pending?.message.commandId ?? null; }
  get retryCount(): number { return this.pending?.retries ?? 0; }

  connect(): void {
    if (this.socketValue) return;
    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }
    this.socketValue = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = event => this.handleData(event.data);
    socket.onerror = () => this.fail("WebSocket 连接错误");
    socket.onclose = event => this.handleClose(event.reason || `连接关闭 (${event.code})`);
  }

  /** 发送命令；prepare-shot 会启动同 ID 超时重试。 */
  sendCommand(command: CommandMessage): boolean {
    if (!this.sendRaw(command)) return false;
    if (command.action.type === "prepare-shot") {
      this.pending = { message: command, retries: 0 };
      this.scheduleAckCheck();
    }
    return true;
  }

  sendCuePose(message: CuePoseMessage): boolean { return this.sendRaw(message); }

  /** 收到 shot-settled / 断开时释放未决重试。 */
  cancelPendingCommand(): void {
    this.pending = null;
    this.clearAckTimer();
  }

  dispose(): void {
    this.clearAckTimer();
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
    const socket = this.socketValue;
    this.socketValue = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(1000, "client dispose"); } catch { /* 已关闭 */ }
    }
    this.setState("closed");
  }

  private handleOpen(): void {
    this.setState("open");
    const hello: HelloMessage = {
      type: "hello",
      protocolVersion: NET_PROTOCOL_VERSION,
      devToken: this.options.devToken,
      roomId: this.options.roomId,
      ...(this.options.requestedSeat === undefined ? {} : { requestedSeat: this.options.requestedSeat })
    };
    this.sendRaw(hello);
    this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
  }

  private sendPing(): void {
    const ping: PingMessage = { type: "ping", id: ++this.pingId, clientTimeMs: this.now() };
    this.sendRaw(ping);
  }

  private sendRaw(message: ClientMessage): boolean {
    const socket = this.socketValue;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.errorValue = "连接未就绪，报文未发送";
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private scheduleAckCheck(): void {
    this.clearAckTimer();
    this.ackTimer = setTimeout(() => this.checkAckTimeout(), this.ackTimeoutMs);
  }

  private checkAckTimeout(): void {
    this.ackTimer = null;
    const pending = this.pending;
    if (!pending) return;
    const retry = this.options.retrySource?.(this.now()) ?? null;
    const message = retry ?? (this.options.retrySource ? null : pending.message);
    if (!message) {
      // 会话状态机可能尚未到重试时刻（两处时钟有微小差值），给一个小窗口再问一次；
      // 已确认或达到上限时会话返回 null，此时按本地上限停止。
      if (pending.retries < this.maxRetries) {
        this.ackTimer = setTimeout(() => this.checkAckTimeout(), Math.min(50, this.ackTimeoutMs));
      } else {
        this.pending = null;
      }
      return;
    }
    pending.retries += 1;
    if (!this.sendRaw(message)) { this.pending = null; return; }
    this.options.onRetry?.(message, pending.retries);
    this.scheduleAckCheck();
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) { clearTimeout(this.ackTimer); this.ackTimer = null; }
  }

  private handleData(data: unknown): void {
    if (typeof data !== "string") { this.errorValue = "bad-protocol: 非文本报文"; return; }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.errorValue = "bad-protocol: JSON 解析失败";
      return;
    }
    const message = this.validate(parsed);
    if (!message) { this.errorValue = "bad-protocol: 报文结构不合法"; return; }
    if (message.type === "ack" && this.pending?.message.commandId === message.commandId) this.cancelPendingCommand();
    if (message.type === "error") this.errorValue = `${message.code}: ${message.message}`;
    this.options.onMessage(message);
  }

  /** 最小结构校验：只确认字段存在且类型正确，规则校验留在服务端。 */
  private validate(value: unknown): ServerMessage | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as { readonly type?: unknown };
    if (typeof candidate.type !== "string" || !(KNOWN_SERVER_TYPES as readonly string[]).includes(candidate.type)) return null;
    switch (candidate.type) {
      case "cue-pose": {
        const pose = value as Partial<CuePoseState>;
        if (!isStateVersion(pose.version) || !isStateVersion(pose.sequence) || !isSeatIndex(pose.seat) ||
            typeof pose.serverTimeMs !== "number" || !Number.isFinite(pose.serverTimeMs) || !isCuePose(pose.pose)) return null;
        return value as ServerMessage;
      }
      case "welcome": {
        const welcome = value as { readonly protocolVersion?: unknown; readonly roomId?: unknown;
          readonly seat?: unknown; readonly stateVersion?: unknown; readonly serverTimeMs?: unknown;
          readonly seats?: unknown; readonly match?: unknown; readonly latency?: unknown };
        if (typeof welcome.protocolVersion !== "number" || typeof welcome.roomId !== "string" ||
            !isSeatIndex(welcome.seat) || !isStateVersion(welcome.stateVersion) ||
            typeof welcome.serverTimeMs !== "number" || !Array.isArray(welcome.seats) ||
            !welcome.match || typeof welcome.match !== "object" || !welcome.latency || typeof welcome.latency !== "object") return null;
        return value as ServerMessage;
      }
      case "snapshot": {
        const snapshot = value as { readonly version?: unknown; readonly serverTimeMs?: unknown;
          readonly eventSeq?: unknown; readonly phase?: unknown; readonly context?: unknown;
          readonly balls?: unknown; readonly checkpoint?: unknown; readonly pendingShot?: unknown; readonly match?: unknown; readonly motion?: unknown };
        if (!isStateVersion(snapshot.version) || typeof snapshot.serverTimeMs !== "number" ||
            typeof snapshot.eventSeq !== "number" || typeof snapshot.phase !== "string" ||
            !snapshot.context || typeof snapshot.context !== "object" || !Array.isArray(snapshot.balls) ||
            !isMatchProgressView(snapshot.match) || !validMotionSamples(snapshot.motion, snapshot.serverTimeMs, snapshot.balls.length)) return null;
        return value as ServerMessage;
      }
      case "event": {
        const message = value as { readonly seq?: unknown; readonly event?: unknown };
        if (typeof message.seq !== "number" || !message.event || typeof message.event !== "object") return null;
        if (typeof (message.event as { readonly type?: unknown }).type !== "string") return null;
        return value as ServerMessage;
      }
      case "ack": {
        const ack = value as { readonly commandId?: unknown; readonly accepted?: unknown;
          readonly stateVersion?: unknown; readonly serverTimeMs?: unknown; readonly duplicate?: unknown };
        if (typeof ack.commandId !== "string" || typeof ack.accepted !== "boolean" ||
            !isStateVersion(ack.stateVersion) || typeof ack.serverTimeMs !== "number" ||
            typeof ack.duplicate !== "boolean") return null;
        return value as ServerMessage;
      }
      case "pong": {
        const pong = value as { readonly id?: unknown; readonly clientTimeMs?: unknown; readonly serverTimeMs?: unknown };
        if (typeof pong.id !== "number" || typeof pong.clientTimeMs !== "number" ||
            typeof pong.serverTimeMs !== "number") return null;
        return value as ServerMessage;
      }
      case "error": {
        const error = value as { readonly code?: unknown; readonly message?: unknown };
        if (typeof error.code !== "string" || typeof error.message !== "string") return null;
        return value as ServerMessage;
      }
      default:
        return null;
    }
  }

  private handleClose(reason: string): void {
    this.socketValue = null;
    this.cancelPendingCommand();
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.stateValue !== "error") this.errorValue = this.errorValue ?? reason;
    this.setState("closed");
  }

  private fail(message: string): void {
    this.errorValue = message;
    this.setState("error");
  }

  private setState(state: NetSocketState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.options.onStateChange?.(state);
  }
}
