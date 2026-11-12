import { PlayerRooms } from "./player-rooms.js";
import { playerRequest, sameOrigin, type PlayerAccess } from "./player-access.js";
import type { NetIdentity } from "../net/lobby.js";
import { isRuleAction } from "../net/rule-view.js";
import { isPauseAction } from "./room-command.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type { MeshBody } from "../core/physics/mesh-body.js";
import {
  NET_PROTOCOL_VERSION, REJECT, isSeatIndex, isStateVersion, parseClientMessage,
  type ClientMessage, type CommandMessage, type RejectReason, type SeatIndex, type ServerMessage
} from "../net/protocol.js";
import { DevLatency, type DevLatencyOptions } from "./latency.js";
import { RoomManager } from "./room-manager.js";
import { RoomSession } from "./room.js";
import { acceptUpgrade, WebSocketConnection } from "./websocket.js";
import { serverNowMs } from "./clock.js";

export interface DevServerRoomOptions {
  readonly bestOf?: number;
  readonly firstOpeningPlayer?: SeatIndex;
  readonly prepareLeadMs: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
}

export interface DevServerOptions {
  readonly access?: PlayerAccess;
  readonly host: string;
  readonly port: number;
  readonly devToken: string;
  readonly latency: DevLatencyOptions;
  readonly room: DevServerRoomOptions;
  readonly meshFactory: () => MeshBody;
}

export interface DevServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly protocolVersion: number;
  roomCount(): number;
  roomIds(): readonly string[];
  close(): Promise<void>;
}

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

class ClientConnection {
  readonly id = randomUUID();
  room: RoomSession | null = null;
  seat: SeatIndex | null = null;
  identity: NetIdentity | null = null;
  queue = Promise.resolve();
  queued = 0;
  private socket: WebSocketConnection | null = null;

  attach(socket: WebSocketConnection): void { this.socket = socket; }
  get isOpen(): boolean { return this.socket !== null && !this.socket.isClosed; }
  sendText(text: string): void { if (this.socket) this.socket.sendText(text); }
  close(code = 1000, reason = ""): void { if (this.socket) this.socket.close(code, reason); }
}

function rawRecord(value: unknown): { readonly [key: string]: unknown } | null {
  return value !== null && typeof value === "object" ? value as { readonly [key: string]: unknown } : null;
}

function isCommandMessage(message: ClientMessage): message is CommandMessage {
  if (message.type !== "command") return false;
  const record = rawRecord(message);
  if (!record) return false;
  if (typeof record.commandId !== "string" || record.commandId.length === 0 || record.commandId.length > 128) return false;
  if (!isStateVersion(record.expectedVersion)) return false;
  const action = rawRecord(record.action);
  return action !== null && (isRuleAction(action) || isPauseAction(action) ||
    ["prepare-shot", "decide-turn", "ready-next-frame", "concede-frame"].includes(String(action.type)));
}

function isPingMessage(message: ClientMessage): boolean {
  if (message.type !== "ping") return false;
  const record = rawRecord(message);
  return record !== null && typeof record.id === "number" && Number.isFinite(record.id) &&
    typeof record.clientTimeMs === "number" && Number.isFinite(record.clientTimeMs);
}

/** 最小 WebSocket 开发服务器：握手、开发令牌、两固定席位、房间广播与仅开发延迟注入。 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  const latency = new DevLatency(options.latency);
  const managerOptions = {
    bestOf: options.room.bestOf,
    firstOpeningPlayer: options.room.firstOpeningPlayer,
    prepareLeadMs: options.room.prepareLeadMs,
    tickHz: options.room.tickHz,
    snapshotHz: options.room.snapshotHz,
    seed: options.room.seed,
    latency: latency.config,
    meshFactory: options.meshFactory
  };
  const roomManager = new RoomManager(managerOptions);
  const playerRooms = options.access ? new PlayerRooms(managerOptions) : null;
  const connections = new Map<string, ClientConnection>();

  function send(connection: ClientConnection, message: ServerMessage): void {
    if (message.type === "ack" && latency.consumeDropNextAck()) {
      console.warn(`[net] drop-next-ack：已丢弃 commandId=${message.commandId} 的 Ack（仅开发故障注入，一次）`);
      return;
    }
    const text = JSON.stringify(message);
    latency.scheduleOutbound(() => { if (connection.isOpen) connection.sendText(text); });
  }

  function sendError(connection: ClientConnection, code: RejectReason, message: string): void {
    send(connection, { type: "error", code, message });
  }

  /** 先按出站延迟投递错误报文，再关闭连接，避免错误消息被立即关闭吞掉。 */
  function rejectAndClose(connection: ClientConnection, code: RejectReason, message: string): void {
    sendError(connection, code, message);
    latency.scheduleOutbound(() => connection.close(1008, "rejected"));
  }

  function broadcast(room: RoomSession, message: ServerMessage): void {
    for (const connection of connections.values()) if (connection.room === room) send(connection, message);
  }

  function handleHello(connection: ClientConnection, message: ClientMessage, nowMs: number): void {
    const record = rawRecord(message);
    if (!record) { rejectAndClose(connection, REJECT.BAD_PROTOCOL, "hello 报文结构非法"); return; }
    if (!options.access && (typeof record.devToken !== "string" || record.devToken !== options.devToken)) {
      rejectAndClose(connection, REJECT.BAD_TOKEN, "开发令牌不匹配"); return;
    }
    if (record.protocolVersion !== NET_PROTOCOL_VERSION) {
      rejectAndClose(connection, REJECT.BAD_PROTOCOL, `协议版本不符：期望 ${NET_PROTOCOL_VERSION}`); return;
    }
    if (typeof record.roomId !== "string" || !ROOM_ID_PATTERN.test(record.roomId)) {
      rejectAndClose(connection, REJECT.BAD_PROTOCOL, "roomId 非法"); return;
    }
    const requestedSeat = record.requestedSeat;
    if (requestedSeat !== undefined && !isSeatIndex(requestedSeat)) {
      rejectAndClose(connection, REJECT.BAD_PROTOCOL, "requestedSeat 非法"); return;
    }
    if (connection.room) { sendError(connection, REJECT.BAD_PROTOCOL, "连接已加入房间"); return; }
    const lease = playerRooms && connection.identity
      ? playerRooms.connect(record.roomId, connection.identity, connection.id, nowMs)
      : roomManager.join(record.roomId, connection.id, requestedSeat, nowMs);
    if ("reason" in lease) {
      rejectAndClose(connection, lease.reason, `加入房间失败：${lease.reason}`);
      return;
    }
    connection.room = lease.room;
    connection.seat = lease.result.seat;
    send(connection, lease.result.welcome);
    send(connection, lease.room.snapshot(nowMs));
    if (lease.room.cuePose) send(connection, lease.room.cuePose);
    broadcastLobbies();
  }

  function handlePing(connection: ClientConnection, message: ClientMessage): void {
    const record = rawRecord(message);
    if (!record || typeof record.id !== "number" || typeof record.clientTimeMs !== "number") {
      sendError(connection, REJECT.BAD_PROTOCOL, "ping 报文结构非法");
      return;
    }
    send(connection, { type: "pong", id: record.id, clientTimeMs: record.clientTimeMs, serverTimeMs: serverNowMs() });
  }

  function handleCommand(connection: ClientConnection, message: ClientMessage, nowMs: number): void {
    if (!isCommandMessage(message)) { sendError(connection, REJECT.BAD_PROTOCOL, "command 报文结构非法"); return; }
    const room = connection.room;
    if (!room || connection.seat === null) { sendError(connection, REJECT.NOT_YOUR_TURN, "尚未加入房间"); return; }
    if (playerRooms && !playerRooms.canPlay(room.roomId, connection.id)) { sendError(connection, REJECT.WRONG_PHASE, "等待双方准备"); return; }
    const result = room.command(connection.id, message, nowMs);
    if (result.ack) send(connection, result.ack);
    for (const event of result.events) broadcast(room, event);
    if (result.snapshot) broadcast(room, result.snapshot);
  }

  function processText(connection: ClientConnection, text: string, nowMs: number): void {
    const parsed = parseClientMessage(text);
    if ("reason" in parsed) { sendError(connection, parsed.reason, "报文无法解析"); return; }
    const message = parsed.message;
    if (message.type === "hello") { handleHello(connection, message, nowMs); return; }
    if (!connection.room || connection.seat === null) {
      sendError(connection, REJECT.NOT_YOUR_TURN, "尚未加入房间，禁止游戏动作");
      return;
    }
    if (message.type === "lobby-ready" && playerRooms && typeof message.ready === "boolean") {
      const lobby = playerRooms.ready(connection.room.roomId, connection.id, message.ready, nowMs);
      broadcast(connection.room, { type: "lobby", lobby }); return;
    }
    if (message.type === "ping" && isPingMessage(message)) { handlePing(connection, message); return; }
    if (message.type === "command") { handleCommand(connection, message, nowMs); return; }
    if (message.type === "cue-pose") {
      if (playerRooms && !playerRooms.canPlay(connection.room.roomId, connection.id)) return;
      const pose = connection.room.receiveCuePose(connection.id, message, nowMs);
      if (pose) broadcast(connection.room, pose);
      return;
    }
    sendError(connection, REJECT.BAD_PROTOCOL, "报文结构非法");
  }

  function handleDisconnect(connection: ClientConnection): void {
    connections.delete(connection.id);
    const room = connection.room;
    connection.room = null;
    connection.seat = null;
    if (room) {
      if (playerRooms) playerRooms.release(room.roomId, connection.id);
      else roomManager.release(room.roomId, connection.id);
    }
    broadcastLobbies();
  }

  function broadcastLobbies(): void {
    if (!playerRooms) return;
    for (const connection of connections.values()) {
      if (!connection.room) continue;
      const lobby = playerRooms.connectedView(connection.room.roomId, serverNowMs());
      if (!lobby || !playerRooms.hasConnection(connection.room.roomId, connection.id)) connection.close(1008, "room-left");
      else send(connection, { type: "lobby", lobby });
    }
  }
  const httpServer: Server = createServer((request, response) => {
    if (options.access && playerRooms && request.url?.startsWith("/api/rooms")) {
      void playerRequest(request, response, options.access, playerRooms, serverNowMs, broadcastLobbies); return;
    }
    if (request.method === "GET" && (request.url === "/health" || request.url === "/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, protocolVersion: NET_PROTOCOL_VERSION, rooms: options.access ? undefined : roomManager.roomIds() }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("KVB-Snooker dev net server: WebSocket only\n");
  });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (options.access && request.url !== "/net") { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    const connection = new ClientConnection();
    const authorize = async (): Promise<boolean> => {
      if (!options.access) return true;
      if (!sameOrigin(request, options.access)) return false;
      const identity = await options.access.authenticate(request);
      if (!identity || (connection.identity && connection.identity.userId !== identity.userId)) return false;
      connection.identity = identity; return true;
    };
    void (async () => {
      if (!await authorize()) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
      const ws = acceptUpgrade(request, socket, {
        onText: text => {
          if (!options.access) {
            latency.scheduleInbound((_receivedAtMs, deliveredAtMs) => processText(connection, text, deliveredAtMs)); return;
          }
          if (++connection.queued > 128) { connection.close(1008, "too-many-messages"); return; }
          connection.queue = connection.queue.then(async () => {
            if (!connection.isOpen) return;
            const parsed = parseClientMessage(text);
            if (!("reason" in parsed) && (parsed.message.type === "command" || parsed.message.type === "hello" || parsed.message.type === "ping" || parsed.message.type === "lobby-ready")) {
              if (!await authorize()) { connection.close(1008, "session-expired"); return; }
            }
            processText(connection, text, serverNowMs());
          }).catch(() => connection.close(1011, "service-unavailable")).finally(() => { connection.queued--; });
        },
        onClose: () => handleDisconnect(connection)
      });
      if (!ws) return;
      connection.attach(ws); connections.set(connection.id, connection);
      if (head.length > 0) ws.push(head);
    })().catch(() => socket.destroy());
  });

  const tickMs = Math.max(1, Math.floor(1000 / options.room.tickHz));
  const tickTimer = setInterval(() => {
    const nowMs = serverNowMs();
    for (const entry of (playerRooms ?? roomManager).tick(nowMs)) {
      for (const event of entry.result.events) broadcast(entry.room, event);
      if (entry.result.snapshot) broadcast(entry.room, entry.result.snapshot);
    }
  }, tickMs);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });
  const address = httpServer.address();
  const port = address !== null && typeof address === "object" ? address.port : options.port;
  const urlHost = options.host === "0.0.0.0" || options.host === "::" ? "127.0.0.1" : options.host;

  async function close(): Promise<void> {
    clearInterval(tickTimer);
    for (const connection of [...connections.values()]) connection.close(1001, "server shutdown");
    connections.clear();
    roomManager.close(); playerRooms?.close();
    latency.close();
    await new Promise<void>(resolve => {
      httpServer.close(() => resolve());
      httpServer.closeAllConnections();
    });
  }

  return {
    host: options.host,
    port,
    url: `ws://${urlHost}:${port}`,
    protocolVersion: NET_PROTOCOL_VERSION,
    roomCount: () => (playerRooms ?? roomManager).roomCount,
    roomIds: () => (playerRooms ?? roomManager).roomIds(),
    close
  };
}
