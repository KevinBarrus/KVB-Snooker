import type { NetSessionState } from "./net/net-session-state.js";
import type { CommandMessage, MatchAction, ServerMessage } from "./net/protocol.js";

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function commandId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID()
    : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class NetMatchPanel {
  readonly element = document.createElement("section");
  private readonly title = document.createElement("div");
  private readonly detail = document.createElement("div");
  private readonly readyButton = document.createElement("button");
  private readonly concedeButton = document.createElement("button");
  private readonly cancelButton = document.createElement("button");
  private confirming = false;
  private attemptId: string | null = null;
  private pending: CommandMessage | null = null;
  private retryAt = 0;
  private retries = 0;
  private retryVersion: number | null = null;

  constructor(private readonly session: NetSessionState,
    private readonly send: (command: CommandMessage) => boolean, private readonly focus: () => void) {
    this.element.className = "net-match";
    this.element.setAttribute("aria-label", "整场比赛");
    this.title.setAttribute("aria-live", "polite");
    this.readyButton.textContent = "准备下一局";
    this.cancelButton.textContent = "取消";
    for (const button of [this.readyButton, this.concedeButton, this.cancelButton]) button.type = "button";
    this.readyButton.addEventListener("click", () => this.command("ready-next-frame"));
    this.concedeButton.addEventListener("click", () => {
      if (this.confirming) this.command("concede-frame");
      else this.confirming = true;
    });
    this.cancelButton.addEventListener("click", () => { this.confirming = false; this.focus(); });
    this.element.append(this.title, this.detail, this.readyButton, this.concedeButton, this.cancelButton);
  }

  receive(message: ServerMessage): void {
    if (message.type !== "ack" || message.commandId !== this.pending?.commandId) return;
    if (!message.accepted && message.reason === "stale-version" && this.retries < 4) {
      this.retryVersion = message.stateVersion;
      return;
    }
    this.pending = null;
    this.retryVersion = null;
  }

  sync(nowMs: number, shotBusy: boolean): void {
    const snapshot = this.session.latestSnapshot;
    const seat = this.session.seat;
    this.element.hidden = !snapshot || seat === null || this.session.lobby?.phase === "waiting";
    if (!snapshot || seat === null) return;
    const match = snapshot.match;
    if (this.attemptId !== match.attemptId) {
      this.attemptId = match.attemptId;
      this.pending = null;
      this.confirming = false;
      this.retryVersion = null;
    }
    const between = match.phase === "between-frames";
    const stable = !this.session.paused && match.phase === "active" && !snapshot.pendingShot && !shotBusy &&
      (snapshot.phase === "ready" || snapshot.phase === "deciding");
    if (!stable) this.confirming = false;
    if (this.pending && ((this.pending.action.type === "ready-next-frame" && match.ready[seat]) ||
        (this.pending.action.type === "concede-frame" && match.phase !== "active"))) this.pending = null;
    if (this.pending && this.session.connectionState === "ready") {
      if (this.retryVersion !== null && snapshot.version >= this.retryVersion) {
        const action = this.pending.action;
        this.retryVersion = null;
        this.retries++;
        this.pending = { ...this.pending, commandId: commandId(), expectedVersion: snapshot.version };
        if ((action.type === "ready-next-frame" && between) || (action.type === "concede-frame" && stable)) {
          this.send(this.pending); this.retryAt = nowMs + 1000;
        } else this.pending = null;
      } else if (nowMs >= this.retryAt) {
        if (this.retries++ < 4) { this.send(this.pending); this.retryAt = nowMs + 1000; }
        else this.pending = null;
      }
    }
    setText(this.title, `第 ${match.frameNumber} 局 · ${match.bestOf} 局 ${Math.ceil(match.bestOf / 2)} 胜 · 局分 ${match.frameWins[0]} : ${match.frameWins[1]}`);
    const last = match.frames.at(-1);
    setText(this.detail, match.result ? `玩家 ${match.result.winner + 1} 赢得整场比赛` : between && last
      ? `玩家 ${last.winner + 1} 赢下本局 · 下一局玩家 ${2 - match.openingPlayer} 开球`
      : `本局比分 ${snapshot.context.scores.join(" : ")} · 玩家 ${match.openingPlayer + 1} 开球`);
    this.readyButton.hidden = !between;
    setText(this.readyButton, match.ready[seat] ? "已准备，等待对手" : "准备下一局");
    const unavailable = this.session.connectionState !== "ready" || this.pending !== null;
    this.readyButton.disabled = unavailable || match.ready[seat] || !this.session.seats.every(s => s.connected);
    this.concedeButton.hidden = match.phase !== "active";
    setText(this.concedeButton, this.confirming ? "确认认输本局" : "认输本局");
    this.concedeButton.disabled = unavailable || !stable;
    this.cancelButton.hidden = !this.confirming;
  }

  private command(type: MatchAction["type"]): void {
    const snapshot = this.session.latestSnapshot;
    if (!snapshot || this.pending) return;
    this.pending = { type: "command", commandId: commandId(), expectedVersion: snapshot.version,
      action: { type, attemptId: snapshot.match.attemptId } };
    this.retries = 0;
    this.retryAt = performance.now() + 1000;
    this.retryVersion = null;
    if (!this.send(this.pending)) this.pending = null;
    this.confirming = false;
    this.focus();
  }
}
