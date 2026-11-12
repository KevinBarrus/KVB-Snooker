import type { IncomingMessage, ServerResponse } from "node:http";
import type { NetIdentity } from "../net/lobby.js";
import { PlayerRooms, LobbyError } from "./player-rooms.js";

export interface PlayerAccess {
  readonly origin: string;
  authenticate(request: IncomingMessage): Promise<NetIdentity | null>;
}

export function sameOrigin(request: IncomingMessage, access: PlayerAccess): boolean {
  return request.headers.origin === access.origin ||
    (request.method === "GET" && request.headers.origin === undefined && request.headers["sec-fetch-site"] === "same-origin");
}

export function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new LobbyError(400, "invalid-content-type");
  let bytes = 0, text = "";
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= 4096) text += String(chunk);
  }
  if (bytes > 4096) throw new LobbyError(413, "request-too-large");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new LobbyError(400, "invalid-json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LobbyError(400, "invalid-request");
  return value as Record<string, unknown>;
}

export async function playerRequest(request: IncomingMessage, response: ServerResponse, access: PlayerAccess,
  rooms: PlayerRooms, now: () => number, changed: () => void): Promise<void> {
  try {
    if (!sameOrigin(request, access)) throw new LobbyError(403, "origin-denied");
    const user = await access.authenticate(request);
    if (!user) throw new LobbyError(401, "unauthenticated");
    const path = new URL(request.url ?? "/", access.origin).pathname;
    if (request.method === "GET" && path === "/api/rooms/current") { respond(response, 200, { room: rooms.current(user.userId, now()) }); return; }
    const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|leave))?$/.exec(path);
    if (request.method === "GET" && match && !match[2]) { respond(response, 200, { room: rooms.view(match[1], user.userId, now()) }); return; }
    if (request.method !== "POST") throw new LobbyError(404, "not-found");
    const data = await body(request);
    if (path === "/api/rooms") {
      if (typeof data.bestOf !== "number" || data.ruleset !== "classic") throw new LobbyError(400, "invalid-settings");
      respond(response, 201, { room: rooms.create(user, data.bestOf, now()) });
    } else if (match?.[2] === "join") respond(response, 200, { room: rooms.join(match[1], user, now()) });
    else if (match?.[2] === "leave") { rooms.leave(match[1], user.userId, now()); respond(response, 200, { ok: true }); }
    else throw new LobbyError(404, "not-found");
    changed();
  } catch (error) {
    respond(response, error instanceof LobbyError ? error.status : 503,
      { error: error instanceof LobbyError ? error.code : "service-unavailable" });
  }
}
