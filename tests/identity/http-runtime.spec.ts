import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/identity/migrations";
import {
  createTestAccount,
  createTestDatabase,
  databaseConfigured,
  loginAndGetCookie,
  makeTestConfig,
  MIGRATIONS_DIRECTORY,
  readJsonObject,
  startTestServer,
  truncateIdentityTables,
  TEST_DATABASE_URL,
  type RunningTestServer,
  type TestDatabase,
} from "./test-support";

const describeDatabase = databaseConfigured ? describe : describe.skip;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("期望 JSON 对象");
  return value as Record<string, unknown>;
}

function missingDatabaseUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/identity_missing_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  return url.toString();
}

async function createStaticFixture(): Promise<{ directory: string; dispose(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "snk-identity-static-"));
  await writeFile(join(directory, "index.html"), "<!doctype html><html><body>identity-static-fixture</body></html>", "utf8");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "assets", "app.js"), "console.log('identity static asset');", "utf8");
  await writeFile(join(directory, "assets", "table.babylon"), "{}", "utf8");
  return {
    directory,
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}

describeDatabase("身份 HTTP 运行时（真实 PostgreSQL）", () => {
  let database: TestDatabase;
  let pool: Pool;
  let mainServer: RunningTestServer;
  let baseUrl: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = database.pool;
    await runMigrations(pool, MIGRATIONS_DIRECTORY);
    mainServer = await startTestServer({ pool, config: makeTestConfig() });
    baseUrl = mainServer.baseUrl;
  });

  afterAll(async () => {
    await mainServer.close();
    await database.dispose();
  });

  beforeEach(async () => {
    await truncateIdentityTables(pool);
  });

  it("GET /api/health 无需 Cookie；数据库正常返回 200 up", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await readJsonObject(response)).toEqual({ ok: true, database: "up" });
  });

  it("数据库不可用时 health 返回 503 down，不抛未处理异常", async () => {
    const brokenPool = new Pool({ connectionString: missingDatabaseUrl(), connectionTimeoutMillis: 1000, max: 1 });
    const brokenServer = await startTestServer({ pool: brokenPool, config: makeTestConfig() });
    try {
      const response = await fetch(`${brokenServer.baseUrl}/api/health`);
      expect(response.status).toBe(503);
      expect(await readJsonObject(response)).toEqual({ ok: false, database: "down" });
    } finally {
      await brokenServer.close();
      await brokenPool.end().catch(() => undefined);
    }
  });

  it("未设置 INTERNAL_TOKEN 时内部校验端点不存在（404）", async () => {
    const response = await fetch(`${baseUrl}/api/internal/session/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anything" },
      body: JSON.stringify({ token: "x" }),
    });
    expect(response.status).toBe(404);
    expect(await readJsonObject(response)).toEqual({ error: "not_found" });
  });

  it("设置 INTERNAL_TOKEN 后校验 Bearer 与 body token，返回 IdentityUser", async () => {
    const internalToken = "test-internal-token-0123456789";
    const internalServer = await startTestServer({ pool, config: makeTestConfig({ internalToken }) });
    try {
      const account = await createTestAccount(pool, "internal@example.test", "InternalPass-1");
      const cookie = await loginAndGetCookie(internalServer.baseUrl, "internal@example.test", "InternalPass-1");
      const sessionToken = cookie.split("=").slice(1).join("=");

      const verify = await fetch(`${internalServer.baseUrl}/api/internal/session/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${internalToken}` },
        body: JSON.stringify({ token: sessionToken }),
      });
      expect(verify.status).toBe(200);
      const identity = await readJsonObject(verify);
      expect(identity.userId).toBe(account.id);
      expect(identity.displayName).toBe("internal");
      expect(identity.role).toBe("player");
      expect(identity.email).toBeUndefined();

      const wrongBearer = await fetch(`${internalServer.baseUrl}/api/internal/session/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
        body: JSON.stringify({ token: sessionToken }),
      });
      expect(wrongBearer.status).toBe(401);
      expect(await readJsonObject(wrongBearer)).toEqual({ error: "unauthorized" });

      const missingBearer = await fetch(`${internalServer.baseUrl}/api/internal/session/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: sessionToken }),
      });
      expect(missingBearer.status).toBe(401);

      const unknownSession = await fetch(`${internalServer.baseUrl}/api/internal/session/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${internalToken}` },
        body: JSON.stringify({ token: "not-a-session-token" }),
      });
      expect(unknownSession.status).toBe(401);
      expect(await readJsonObject(unknownSession)).toEqual({ error: "unauthenticated" });

      const wrongMethod = await fetch(`${internalServer.baseUrl}/api/internal/session/verify`, {
        headers: { authorization: `Bearer ${internalToken}` },
      });
      expect(wrongMethod.status).toBe(405);
    } finally {
      await internalServer.close();
    }
  });

  it("未配置 STATIC_DIR 时非 API 路径返回 404 JSON", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(404);
    expect(await readJsonObject(response)).toEqual({ error: "not_found" });
  });

  it("STATIC_DIR 服务 dist：GET / 回 index.html、资源类型正确、API 优先、缺失 404", async () => {
    const fixture = await createStaticFixture();
    const staticServer = await startTestServer({
      pool,
      config: makeTestConfig({ staticDir: fixture.directory }),
    });
    try {
      const index = await fetch(`${staticServer.baseUrl}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(await index.text()).toContain("identity-static-fixture");
      expect(index.headers.get("x-content-type-options")).toBe("nosniff");
      expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(index.headers.get("cache-control")).toBe("no-store");

      const script = await fetch(`${staticServer.baseUrl}/assets/app.js`);
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("text/javascript");
      expect(await script.text()).toContain("identity static asset");

      const babylon = await fetch(`${staticServer.baseUrl}/assets/table.babylon`);
      expect(babylon.status).toBe(200);
      expect(babylon.headers.get("content-type")).toBe("application/octet-stream");

      const missingAsset = await fetch(`${staticServer.baseUrl}/assets/missing.js`);
      expect(missingAsset.status).toBe(404);

      const apiWins = await fetch(`${staticServer.baseUrl}/api/health`);
      expect(apiWins.status).toBe(200);
      expect(apiWins.headers.get("content-type")).toContain("application/json");

      const headResponse = await fetch(`${staticServer.baseUrl}/`, { method: "HEAD" });
      expect(headResponse.status).toBe(200);
      expect(await headResponse.text()).toBe("");

      const traversal = await fetch(`${staticServer.baseUrl}/..%2f..%2fpackage.json`);
      expect(traversal.status).toBe(404);
    } finally {
      await staticServer.close();
      await fixture.dispose();
    }
  });
});
