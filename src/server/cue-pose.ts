import { isCuePose, isStateVersion, type CuePoseMessage, type CuePoseState, type SeatIndex } from "../net/protocol.js";

export class RoomCuePose {
  private sequence = 0;
  private readonly clients = new Map<string, { sequence: number; credit: number; atMs: number }>();
  private owner: string | null = null;
  latest: CuePoseState | null = null;

  forget(connectionId: string): void {
    this.clients.delete(connectionId);
    if (this.owner === connectionId) this.latest = null;
  }

  accept(connectionId: string, seat: SeatIndex, message: CuePoseMessage, nowMs: number): CuePoseState | null {
    if (!isStateVersion(message.expectedVersion) || !Number.isSafeInteger(message.sequence) ||
        message.sequence < 0 || !isCuePose(message.pose)) return null;
    const client = this.clients.get(connectionId) ?? { sequence: -1, credit: 4, atMs: nowMs };
    if (message.sequence <= client.sequence) return null;
    client.sequence = message.sequence;
    client.credit = Math.min(4, client.credit + Math.max(0, nowMs - client.atMs) / 50);
    client.atMs = nowMs;
    this.clients.set(connectionId, client);
    if (client.credit < 1) return null;
    client.credit--;
    this.owner = connectionId;
    this.latest = { type: "cue-pose", version: message.expectedVersion, sequence: ++this.sequence,
      seat, serverTimeMs: nowMs, pose: message.pose ? { ...message.pose } : null };
    return this.latest;
  }
}
