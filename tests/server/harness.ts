import type {
  AckMessage, ServerErrorMessage, ServerEvent, ServerEventMessage, SnapshotMessage, WelcomeMessage
} from "../../src/net/protocol.js";
import { NET_PROTOCOL_VERSION } from "../../src/net/protocol.js";
import { startDevServer, type DevServer, type DevServerOptions } from "../../src/server/transport.js";
import { makePocketTable } from "../fixtures/table.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makeSimulator, makeStrokeVarsFor } from "./helpers.js";
import { TestClient } from "./ws-client.js";

export const DEV_TOKEN = "test-dev-token";

export type EventMessageOf<T extends ServerEvent["type"]> = ServerEventMessage & {
  readonly event: Extract<ServerEvent, { readonly type: T }>;
};

const referenceSimulator = makeSimulator(DEFAULT_SCENE.ballSet);

/** 与服务端房间相同的 DEFAULT_SCENE：由真实 Simulator 计算合法触点世界坐标。 */
export function varsFor(dx: number, dz: number, speed = 8): number[] {
  return Array.from(makeStrokeVarsFor(referenceSimulator, { dx, dz, speed }));
}

export interface Harness {
  readonly server: DevServer;
  readonly url: string;
  connect(): Promise<TestClient>;
  join(roomId: string, requestedSeat?: 0 | 1): Promise<{ readonly client: TestClient; readonly welcome: WelcomeMessage }>;
  close(): Promise<void>;
}

export async function startHarness(
  overrides: Partial<Pick<DevServerOptions, "latency" | "room" | "devToken">> = {}
): Promise<Harness> {
  const server = await startDevServer({
    host: "127.0.0.1",
    port: 0,
    devToken: DEV_TOKEN,
    latency: { inboundMs: 0, outboundMs: 0, jitterMs: 0, dropNextAck: false },
    room: { prepareLeadMs: 700, tickHz: 60, snapshotHz: 20, seed: 2026, bestOf: 1, firstOpeningPlayer: 0 },
    meshFactory: () => makePocketTable(),
    ...overrides,
    ...(overrides.room ? { room: { bestOf: 1, firstOpeningPlayer: 0, ...overrides.room } } : {})
  });
  const clients: TestClient[] = [];
  const harness: Harness = {
    server,
    url: server.url,
    async connect() {
      const client = await TestClient.connect(server.url);
      clients.push(client);
      return client;
    },
    async join(roomId, requestedSeat) {
      const client = await harness.connect();
      client.send({
        type: "hello", protocolVersion: NET_PROTOCOL_VERSION, devToken: DEV_TOKEN, roomId,
        ...(requestedSeat === undefined ? {} : { requestedSeat })
      });
      const welcome = await waitWelcome(client);
      return { client, welcome };
    },
    async close() {
      for (const client of clients) client.close();
      await server.close();
    }
  };
  return harness;
}

export async function joinRaw(
  client: TestClient, roomId: string,
  options: { readonly protocolVersion?: number; readonly devToken?: string; readonly requestedSeat?: 0 | 1 } = {}
): Promise<WelcomeMessage> {
  client.send({
    type: "hello",
    protocolVersion: options.protocolVersion ?? NET_PROTOCOL_VERSION,
    devToken: options.devToken ?? DEV_TOKEN,
    roomId,
    ...(options.requestedSeat === undefined ? {} : { requestedSeat: options.requestedSeat })
  });
  return waitWelcome(client);
}

export async function waitWelcome(client: TestClient): Promise<WelcomeMessage> {
  const message = await client.waitFor(item => item.type === "welcome", 4000);
  if (message.type !== "welcome") throw new Error("expected welcome");
  return message;
}

export async function waitAck(client: TestClient, timeoutMs = 8000): Promise<AckMessage> {
  const message = await client.waitFor(item => item.type === "ack", timeoutMs);
  if (message.type !== "ack") throw new Error("expected ack");
  return message;
}

export async function waitError(client: TestClient, timeoutMs = 4000): Promise<ServerErrorMessage> {
  const message = await client.waitFor(item => item.type === "error", timeoutMs);
  if (message.type !== "error") throw new Error("expected error");
  return message;
}

export async function waitEvent<T extends ServerEvent["type"]>(
  client: TestClient, type: T, timeoutMs = 8000
): Promise<EventMessageOf<T>> {
  const message = await client.waitFor(item => item.type === "event" && item.event.type === type, timeoutMs);
  if (message.type !== "event" || message.event.type !== type) throw new Error(`expected event ${type}`);
  return message as EventMessageOf<T>;
}

export async function waitSnapshot(
  client: TestClient, predicate: (snapshot: SnapshotMessage) => boolean, timeoutMs = 8000
): Promise<SnapshotMessage> {
  const message = await client.waitFor(item => item.type === "snapshot" && predicate(item), timeoutMs);
  if (message.type !== "snapshot") throw new Error("expected snapshot");
  return message;
}

/** 结算后携带 SerialData 检查点的稳定快照（ready/deciding/finished）。 */
export function waitStableSnapshot(client: TestClient, minVersion = 0, timeoutMs = 8000): Promise<SnapshotMessage> {
  return waitSnapshot(
    client,
    snapshot => snapshot.version >= minVersion && snapshot.phase !== "simulating" && snapshot.checkpoint !== null,
    timeoutMs
  );
}
