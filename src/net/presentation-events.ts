import type { ServerEventMessage } from "./protocol.js";

export class PresentationEvents {
  private highest = -1;
  private events: ServerEventMessage[] = [];
  receive(message: ServerEventMessage): void {
    if (message.seq <= this.highest) return;
    this.highest = message.seq;
    if (message.event.type === "frame-started") { this.events = []; return; }
    if (message.event.type !== "shot-impact" && message.event.type !== "shot-settled") return;
    this.events.push(message);
    if (this.events.length > 1024) this.events.shift();
  }
  consume(displayMs: number, play: (event: ServerEventMessage) => void): void {
    const due = this.events.filter(e => e.serverTimeMs <= displayMs);
    this.events = this.events.filter(e => e.serverTimeMs > displayMs);
    for (const event of due) {
      if (event.event.type === "shot-impact" && displayMs - event.serverTimeMs > 500) continue;
      play(event);
    }
  }
}
