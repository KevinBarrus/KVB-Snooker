import type { CommandMessage, ClientCommandAction, ServerMessage } from "./protocol.js";

export class TurnCommands {
  private pending: CommandMessage | null = null;
  private acceptedVersion: number | null = null;
  private retryAt = 0;
  private retries = 0;
  error = "";
  constructor(private readonly send: (command: CommandMessage) => boolean, private readonly id: () => string) {}
  get busy(): boolean { return this.pending !== null; }
  submit(action: ClientCommandAction, version: number, now: number): boolean {
    if (this.pending) return false;
    this.pending = { type: "command", commandId: this.id(), expectedVersion: version, action };
    this.acceptedVersion = null; this.retries = 0; this.retryAt = now + 1000; this.error = "";
    if (!this.send(this.pending)) { this.pending = null; this.error = "连接不可用，请重试"; return false; }
    return true;
  }
  receive(message: ServerMessage): void {
    if (message.type !== "ack" || message.commandId !== this.pending?.commandId) return;
    if (message.accepted) this.acceptedVersion = message.stateVersion;
    else { this.pending = null; this.error = message.reason === "stale-version" ? "局面已更新，请重试" : "当前操作不允许，请检查球权与落点"; }
  }
  update(now: number, version: number): void {
    if (!this.pending) return;
    if (this.acceptedVersion !== null && version >= this.acceptedVersion) { this.pending = null; return; }
    if (now < this.retryAt) return;
    if (++this.retries > 4) { this.pending = null; this.error = "请求未确认，请重试"; return; }
    this.send(this.pending); this.retryAt = now + 1000;
  }
}
