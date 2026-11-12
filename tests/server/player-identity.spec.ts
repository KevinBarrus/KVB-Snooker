import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { createPlayerAccess } from "../../src/server/player-identity.js";
import { startDevServer, type DevServer } from "../../src/server/transport.js";
import { runMigrations } from "../../src/identity/migrations.js";
import { makePocketTable } from "../fixtures/table.js";
import { createTestDatabase, databaseConfigured, createTestAccount, startTestServer, makeTestConfig,
  loginAndGetCookie, MIGRATIONS_DIRECTORY, type TestDatabase, type RunningTestServer } from "../identity/test-support.js";

const origin = "http://127.0.0.1:5173";
const password = "Player-Test-2026-Strong";
const internalToken = "integration-test-internal-token";

describe.skipIf(!databaseConfigured)("房间消费真实身份服务", () => {
  let db: TestDatabase, identity: RunningTestServer, server: DevServer;
  let cookieA: string, cookieB: string, base: string;
  beforeAll(async () => {
    db = await createTestDatabase(); await runMigrations(db.pool, MIGRATIONS_DIRECTORY);
    await createTestAccount(db.pool, "a@players.test", password); await createTestAccount(db.pool, "b@players.test", password);
    identity = await startTestServer({ pool: db.pool, config: makeTestConfig({ internalToken }) });
    cookieA = await loginAndGetCookie(identity.baseUrl, "a@players.test", password);
    cookieB = await loginAndGetCookie(identity.baseUrl, "b@players.test", password);
    server = await startDevServer({ host: "127.0.0.1", port: 0, devToken: "dev-local",
      access: createPlayerAccess({ origin, identityUrl: identity.baseUrl, internalToken }),
      latency: { inboundMs: 0, outboundMs: 0, jitterMs: 0, dropNextAck: false },
      room: { prepareLeadMs: 700, tickHz: 60, snapshotHz: 20, seed: 2026 }, meshFactory: makePocketTable });
    base = server.url.replace("ws:", "http:");
  }, 20000);
  afterAll(async () => { await server?.close(); await identity?.close(); await db?.dispose(); });
  const request = (path: string, cookie: string, body?: object, requestOrigin = origin) => fetch(`${base}/api/rooms${path}`, {
    method: body ? "POST" : "GET", headers: { cookie, origin: requestOrigin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  it("Cookie绑定稳定成员，忽略自报身份；跨源、伪造和已退出会话无法进入", async () => {
    expect((await request("", "", { ruleset: "classic", bestOf: 3 })).status).toBe(401);
    expect((await request("", cookieA, { ruleset: "classic", bestOf: 3 }, "https://evil.test")).status).toBe(403);
    const created = await request("", cookieA, { ruleset: "classic", bestOf: 3, userId: "other", seat: 1 });
    expect(created.status).toBe(201);
    const value = await created.json() as { room: { roomId: string; players: { seat: number; name: string }[] } };
    expect(value.room.players).toEqual([{ seat: 0, name: "a", connected: false, ready: false }]);
    expect(JSON.stringify(value)).not.toContain("@players.test");
    const code = value.room.roomId;
    expect((await request(`/${code}`, cookieB)).status).toBe(403);
    expect((await request(`/${code}/join`, cookieB, {})).status).toBe(200);
    const current = await (await request("/current", cookieA)).json();
    expect(current).toHaveProperty("room.roomId", code);
    await fetch(`${identity.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: cookieA, "content-type": "application/json" } });
    expect((await request("/current", cookieA)).status).toBe(401);
    expect((await request("/current", "snk_session=" + "x".repeat(43))).status).toBe(401);
  });
});

describe("身份适配边界", () => {
  it("缺少配置立即失败，非法/重复Cookie不调用后端", async () => {
    expect(() => createPlayerAccess({ origin, identityUrl: "http://127.0.0.1:1", internalToken: "" })).toThrow();
    const access = createPlayerAccess({ origin, identityUrl: "http://127.0.0.1:1", internalToken: "test" });
    for (const cookie of ["", "snk_session=bad", `snk_session=${"a".repeat(43)}; snk_session=${"b".repeat(43)}`]) {
      const request = new IncomingMessage(new Socket()); request.headers.cookie = cookie;
      expect(await access.authenticate(request)).toBeNull(); request.destroy();
    }
  });
});
