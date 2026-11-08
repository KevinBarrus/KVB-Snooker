import type { MeshBody } from "../core/physics/mesh-body.js";
import type { LatencyConfig, RejectReason, SeatIndex } from "../net/protocol.js";
import { RoomSession, type RoomJoinResult, type RoomTickResult } from "./room.js";

export interface RoomManagerOptions {
  readonly bestOf?: number;
  readonly firstOpeningPlayer?: SeatIndex;
  readonly prepareLeadMs: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
  readonly latency: LatencyConfig;
  /** 每个房间独立构造 MeshBody/Simulator；只共享已校验的只读台面 JSON。 */
  readonly meshFactory: () => MeshBody;
}

export interface RoomLease {
  readonly room: RoomSession;
  readonly result: RoomJoinResult;
}

export interface RoomTickEntry {
  readonly room: RoomSession;
  readonly result: RoomTickResult;
}

interface RoomEntry {
  readonly room: RoomSession;
  readonly connections: Set<string>;
}

/** 单进程房间表：按 roomId 创建/复用房间，单线程串行处理，一个房间只有一个有效写入者。 */
export class RoomManager {
  private readonly entries = new Map<string, RoomEntry>();
  private roomSequence = 0;

  constructor(private readonly options: RoomManagerOptions) {}

  get roomCount(): number { return this.entries.size; }

  roomIds(): readonly string[] { return [...this.entries.keys()]; }

  join(roomId: string, connectionId: string, requestedSeat: SeatIndex | undefined, nowMs: number): RoomLease | { readonly reason: RejectReason } {
    let entry = this.entries.get(roomId);
    const created = entry === undefined;
    if (!entry) {
      entry = { room: this.createRoom(roomId), connections: new Set() };
      this.entries.set(roomId, entry);
    }
    const outcome = entry.room.join(connectionId, requestedSeat, nowMs);
    if ("reason" in outcome) {
      if (created && entry.connections.size === 0) {
        entry.room.close();
        this.entries.delete(roomId);
      }
      return { reason: outcome.reason };
    }
    entry.connections.add(connectionId);
    return { room: entry.room, result: outcome };
  }

  release(roomId: string, connectionId: string): void {
    const entry = this.entries.get(roomId);
    if (!entry) return;
    entry.room.release(connectionId);
    entry.connections.delete(connectionId);
    if (entry.connections.size === 0) {
      entry.room.close();
      this.entries.delete(roomId);
    }
  }

  tick(nowMs: number): readonly RoomTickEntry[] {
    const results: RoomTickEntry[] = [];
    for (const entry of this.entries.values()) results.push({ room: entry.room, result: entry.room.tick(nowMs) });
    return results;
  }

  close(): void {
    for (const entry of this.entries.values()) entry.room.close();
    this.entries.clear();
  }

  private createRoom(roomId: string): RoomSession {
    this.roomSequence++;
    const seed = (this.options.seed + this.roomSequence) >>> 0;
    return new RoomSession(roomId, {
      bestOf: this.options.bestOf,
      firstOpeningPlayer: this.options.firstOpeningPlayer,
      prepareLeadMs: this.options.prepareLeadMs,
      tickHz: this.options.tickHz,
      snapshotHz: this.options.snapshotHz,
      seed,
      latency: this.options.latency
    }, this.options.meshFactory());
  }
}
