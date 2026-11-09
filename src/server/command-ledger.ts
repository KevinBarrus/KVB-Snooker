import type { AckMessage } from "../net/protocol.js";

export interface CommandReceipt {
  readonly key: string;
  readonly signature: string;
  readonly ack: AckMessage;
}

export class CommandLedger {
  private readonly entries = new Map<string, CommandReceipt>();

  get(key: string): CommandReceipt | undefined { return this.entries.get(key); }
  clear(): void { this.entries.clear(); }

  remember(key: string, signature: string, ack: AckMessage): void {
    if (this.entries.size >= 256) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { key, signature, ack: { ...ack } });
  }

  snapshot(): CommandReceipt[] {
    return [...this.entries.values()].map(entry => ({ ...entry, ack: { ...entry.ack } }));
  }
}
