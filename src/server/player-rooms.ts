import { randomInt } from "node:crypto";
import { MATCH_LENGTHS } from "../core/match-progress.js";
import type { NetIdentity, LobbyView } from "../net/lobby.js";
import { RoomSession } from "./room.js";
import type { RoomManagerOptions, RoomTickEntry, RoomLease } from "./room-manager.js";
import { REJECT, type SeatIndex } from "../net/protocol.js";

interface Member { readonly userId: string; readonly name: string; connection: string | null; ready: boolean }
interface Entry { readonly room: RoomSession; readonly bestOf: number; readonly members: [Member, Member | null]; started: boolean }
export class LobbyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export class PlayerRooms {
  private readonly rooms = new Map<string, Entry>();
  constructor(private readonly options: RoomManagerOptions) {}
  get roomCount(): number { return this.rooms.size; }
  roomIds(): readonly string[] { return [...this.rooms.keys()]; }

  create(user: NetIdentity, bestOf: number, now: number): LobbyView {
    if (!MATCH_LENGTHS.includes(bestOf)) throw new LobbyError(400, "invalid-best-of");
    if (this.findUser(user.userId)) throw new LobbyError(409, "already-in-room");
    if (this.rooms.size >= 100) throw new LobbyError(503, "room-capacity");
    let code: string;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(""); } while (this.rooms.has(code));
    const room = new RoomSession(code, { ...this.options, bestOf }, this.options.meshFactory());
    this.rooms.set(code, { room, bestOf, members: [this.member(user), null], started: false });
    return this.view(code, user.userId, now);
  }

  join(code: string, user: NetIdentity, now: number): LobbyView {
    const entry = this.get(code);
    if (entry.members.some(m => m?.userId === user.userId)) return this.view(code, user.userId, now);
    if (entry.started) throw new LobbyError(409, "match-started");
    if (entry.members[1]) throw new LobbyError(409, "room-full");
    if (this.findUser(user.userId)) throw new LobbyError(409, "already-in-room");
    entry.members[1] = this.member(user);
    return this.view(code, user.userId, now);
  }

  current(userId: string, now: number): LobbyView | null {
    const code = this.findUser(userId);
    return code ? this.view(code, userId, now) : null;
  }

  view(code: string, userId: string, now: number): LobbyView {
    const entry = this.get(code);
    if (!entry.members.some(m => m?.userId === userId)) throw new LobbyError(403, "not-a-member");
    return this.publicView(entry, now);
  }

  leave(code: string, userId: string, now: number): void {
    const entry = this.get(code), seat = entry.members.findIndex(m => m?.userId === userId);
    if (seat < 0) throw new LobbyError(403, "not-a-member");
    if (entry.started && entry.room.snapshot(now).match.phase !== "finished") throw new LobbyError(409, "match-in-progress");
    if (seat === 0 || entry.started) { entry.room.close(); this.rooms.delete(code); }
    else {
      const member = entry.members[1];
      if (member?.connection) entry.room.release(member.connection);
      entry.members[1] = null; entry.members[0].ready = false;
    }
  }

  connect(code: string, user: NetIdentity, connection: string, now: number): RoomLease | { reason: typeof REJECT[keyof typeof REJECT] } {
    const entry = this.rooms.get(code);
    const seat = entry?.members.findIndex(m => m?.userId === user.userId) ?? -1;
    if (!entry || (seat !== 0 && seat !== 1)) return { reason: REJECT.NOT_YOUR_TURN };
    const member = entry.members[seat]!;
    if (member.connection && member.connection !== connection) return { reason: REJECT.SEAT_CONFLICT };
    const result = entry.room.join(connection, seat, now);
    if ("reason" in result) return result;
    member.connection = connection; member.ready = false;
    return { room: entry.room, result };
  }

  ready(code: string, connection: string, ready: boolean, now: number): LobbyView {
    const entry = this.get(code), member = entry.members.find(m => m?.connection === connection);
    if (!member) throw new LobbyError(403, "not-a-member");
    if (!entry.started) {
      member.ready = ready;
      if (entry.members.every(m => m?.connection && m.ready)) entry.started = true;
    }
    return this.publicView(entry, now);
  }

  hasConnection(code: string, connection: string): boolean {
    return Boolean(this.rooms.get(code)?.members.some(m => m?.connection === connection));
  }
  canPlay(code: string, connection: string): boolean {
    const entry = this.rooms.get(code);
    return Boolean(entry?.started && entry.members.some(m => m?.connection === connection));
  }
  release(code: string, connection: string): void {
    const entry = this.rooms.get(code);
    if (!entry) return;
    const member = entry.members.find(m => m?.connection === connection);
    if (!member) return;
    member.connection = null; member.ready = false; entry.room.release(connection);
    if (!entry.started) entry.members.forEach(m => { if (m) m.ready = false; });
  }
  connectedView(code: string, now: number): LobbyView | null {
    const entry = this.rooms.get(code);
    return entry ? this.publicView(entry, now) : null;
  }
  tick(now: number): readonly RoomTickEntry[] {
    return [...this.rooms.values()].filter(e => e.started).map(e => ({ room: e.room, result: e.room.tick(now) }));
  }
  close(): void { this.rooms.forEach(e => e.room.close()); this.rooms.clear(); }
  private get(code: string): Entry {
    const entry = this.rooms.get(code);
    if (!entry) throw new LobbyError(404, "room-not-found");
    return entry;
  }
  private member(user: NetIdentity): Member {
    if (!user.userId || !user.name || user.name.length > 80) throw new LobbyError(401, "invalid-identity");
    return { userId: user.userId, name: user.name, connection: null, ready: false };
  }
  private findUser(id: string): string | null {
    for (const [code,e] of this.rooms) if (e.members.some(m => m?.userId === id)) return code;
    return null;
  }
  private publicView(entry: Entry, now: number): LobbyView {
    return { roomId: entry.room.roomId, bestOf: entry.bestOf, ruleset: "classic",
      phase: entry.started ? entry.room.snapshot(now).match.phase === "finished" ? "finished" : "playing" : "waiting",
      players: entry.members.flatMap((m, seat) => m ? [{ seat: seat as SeatIndex, name: m.name, connected: m.connection !== null, ready: m.ready }] : []) };
  }
}
