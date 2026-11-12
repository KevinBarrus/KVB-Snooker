import { PausePanel, type PauseControl } from "./ui/pause-panel.js";
import type { NetSessionState } from "./net/net-session-state.js";
import type { CommandMessage, PauseAction, ServerMessage } from "./net/protocol.js";

export class NetPausePanel {
  private readonly panel: PausePanel;
  private pending: CommandMessage | null = null;
  private retryAt = 0;
  private retries = 0;
  private retryVersion: number | null = null;
  private error = "";

  constructor(private readonly session: NetSessionState, private readonly send: (command: CommandMessage) => boolean,
    focus: () => void) {
    this.panel = new PausePanel(action => this.command(action), focus);
    this.panel.element.hidden = true;
  }

  receive(message: ServerMessage): void {
    if (message.type !== "ack" || message.commandId !== this.pending?.commandId) return;
    if (!message.accepted && message.reason === "stale-version" && this.pending.action.type === "pause-ready" && this.retries < 4) {
      this.retryVersion = message.stateVersion; return;
    }
    this.pending = null;
    this.retryVersion = null;
    this.error = message.accepted ? "" : message.reason === "stale-version" ? "局面已更新，请重试" : "当前无法执行暂停操作";
  }

  sync(nowMs: number): void {
    const snapshot = this.session.latestSnapshot, seat = this.session.seat;
    if (!snapshot || seat === null) return;
    if (this.pending && this.retryVersion !== null && snapshot.version >= this.retryVersion) {
      const action = this.pending.action;
      this.retryVersion = null;
      if (action.type === "pause-ready" && action.attemptId === snapshot.match.attemptId &&
          snapshot.pause.phase === "paused" && !snapshot.pause.ready[seat]) {
        this.pending = { ...this.pending, commandId: `${this.pending.commandId}-r${++this.retries}`, expectedVersion: snapshot.version };
        this.send(this.pending); this.retryAt = nowMs + 1000;
      } else this.pending = null;
    }
    if (this.pending && nowMs >= this.retryAt) {
      if (++this.retries <= 4) { this.send(this.pending); this.retryAt = nowMs + 1000; }
      else { this.pending = null; this.error = "请求未确认，请重试"; }
    }
    this.panel.sync(snapshot.pause, seat,
      this.session.lobby?.phase !== "waiting" && this.session.connectionState === "ready" && snapshot.match.phase === "active" && this.session.seats.every(s => s.connected),
      this.pending !== null, true, this.error);
  }

  private command(action: PauseControl): void {
    const snapshot = this.session.latestSnapshot;
    if (!snapshot || this.pending) return;
    const type: PauseAction["type"] = `pause-${action}`;
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.pending = { type: "command", commandId: `pause-${id}`, expectedVersion: snapshot.version,
      action: { type, attemptId: snapshot.match.attemptId } };
    this.retries = 0; this.retryVersion = null; this.error = ""; this.retryAt = performance.now() + 1000;
    if (!this.send(this.pending)) { this.pending = null; this.error = "连接不可用"; }
  }

  dispose(): void { this.panel.dispose(); }
}
