import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { runMigrations } from "../../src/identity/migrations";
import { resetUserPassword, setUserEnabled } from "../../src/identity/identity-service";
import {
  createTestAccount,
  createTestDatabase,
  databaseConfigured,
  loginAndGetCookie,
  makeTestConfig,
  MIGRATIONS_DIRECTORY,
  postJson,
  readJsonObject,
  sessionCookie,
  startTestServer,
  truncateIdentityTables,
  type RunningTestServer,
  type TestDatabase,
} from "./test-support";

const describeDatabase = databaseConfigured ? describe : describe.skip;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("期望 JSON 对象");
  return value as Record<string, unknown>;
}

describeDatabase("身份 HTTP 认证（真实 PostgreSQL + Node HTTP）", () => {
  let database: TestDatabase;
  let pool: Pool;
  let server: RunningTestServer;
  let baseUrl: string;
  let origin: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = database.pool;
    await runMigrations(pool, MIGRATIONS_DIRECTORY);
    server = await startTestServer({ pool, config: makeTestConfig() });
    baseUrl = server.baseUrl;
    origin = new URL(baseUrl).origin;
  });

  afterAll(async () => {
    await server.close();
    await database.dispose();
  });

  beforeEach(async () => {
    await truncateIdentityTables(pool);
  });

  it("正确凭证登录返回 IdentityUser 与 Cookie 属性，/me 可刷新会话", async () => {
    const account = await createTestAccount(pool, "login@example.test", "CorrectPass-1");
    const issuedBefore = Date.now();
    const response = await postJson(baseUrl, "/api/auth/login", {
      email: "  Login@Example.Test ",
      password: "CorrectPass-1",
    });
    expect(response.status).toBe(200);
    const body = await readJsonObject(response);
    const user = asRecord(body.user);
    expect(user.id).toBe(account.id);
    expect(user.email).toBe("login@example.test");
    expect(user.role).toBe("player");
    expect(typeof user.createdAt).toBe("string");
    const expiresAt = new Date(String(body.expiresAt)).getTime();
    expect(expiresAt).toBeGreaterThan(issuedBefore);
    expect(expiresAt).toBeLessThanOrEqual(issuedBefore + 3600_000 + 10_000);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).not.toContain("Secure");
    const cookie = sessionCookie(response);

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = await readJsonObject(me);
    expect(asRecord(meBody.user).id).toBe(account.id);
    expect(meBody.expiresAt).toBe(body.expiresAt);
    expect(me.headers.get("cache-control")).toBe("no-store");
  });

  it("错误密码、未知邮箱统一 invalid_credentials；缺失字段 invalid_request；空字符串仍是凭证错误", async () => {
    await createTestAccount(pool, "wrong@example.test", "RightPass-1");
    const wrongPassword = await postJson(baseUrl, "/api/auth/login", {
      email: "wrong@example.test",
      password: "WrongPass-2",
    });
    expect(wrongPassword.status).toBe(401);
    expect(await readJsonObject(wrongPassword)).toEqual({ error: "invalid_credentials" });

    const unknownEmail = await postJson(baseUrl, "/api/auth/login", {
      email: "nobody@example.test",
      password: "RightPass-1",
    });
    expect(unknownEmail.status).toBe(401);
    expect(await readJsonObject(unknownEmail)).toEqual({ error: "invalid_credentials" });

    const missingFields = await postJson(baseUrl, "/api/auth/login", {});
    expect(missingFields.status).toBe(400);
    expect(await readJsonObject(missingFields)).toEqual({ error: "invalid_request" });

    const emptyCredentials = await postJson(baseUrl, "/api/auth/login", { email: "", password: "" });
    expect(emptyCredentials.status).toBe(401);
    expect(await readJsonObject(emptyCredentials)).toEqual({ error: "invalid_credentials" });
  });

  it("未登录或伪造 Cookie 访问 /me 返回 unauthenticated", async () => {
    const anonymous = await fetch(`${baseUrl}/api/auth/me`);
    expect(anonymous.status).toBe(401);
    expect(await readJsonObject(anonymous)).toEqual({ error: "unauthenticated" });

    const forged = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: "snk_session=not-a-real-token" } });
    expect(forged.status).toBe(401);
    expect(await readJsonObject(forged)).toEqual({ error: "unauthenticated" });
  });

  it("退出登录幂等、清除 Cookie，旧 Cookie 立即失效", async () => {
    await createTestAccount(pool, "logout@example.test", "LogoutPass-1");
    const cookie = await loginAndGetCookie(baseUrl, "logout@example.test", "LogoutPass-1");

    const anonymousLogout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
    expect(anonymousLogout.status).toBe(204);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(204);
    const cleared = logout.headers.get("set-cookie") ?? "";
    expect(cleared).toContain("snk_session=;");
    expect(cleared).toContain("Max-Age=0");

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
    expect(await readJsonObject(me)).toEqual({ error: "unauthenticated" });
  });

  it("两个账号会话互相隔离且用户 ID 稳定", async () => {
    const first = await createTestAccount(pool, "one@example.test", "OnePass-123");
    const second = await createTestAccount(pool, "two@example.test", "TwoPass-456");
    const firstCookie = await loginAndGetCookie(baseUrl, "one@example.test", "OnePass-123");
    const secondCookie = await loginAndGetCookie(baseUrl, "two@example.test", "TwoPass-456");

    const firstMe = await readJsonObject(await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: firstCookie } }));
    const secondMe = await readJsonObject(await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: secondCookie } }));
    expect(asRecord(firstMe.user).id).toBe(first.id);
    expect(asRecord(secondMe.user).id).toBe(second.id);
    expect(first.id).not.toBe(second.id);

    const reLogin = await postJson(baseUrl, "/api/auth/login", { email: "one@example.test", password: "OnePass-123" });
    expect(asRecord((await readJsonObject(reLogin)).user).id).toBe(first.id);
  });

  it("重置密码撤销旧 Cookie，旧密码失效、新密码可登录", async () => {
    await createTestAccount(pool, "reset-http@example.test", "OldPass-123");
    const cookie = await loginAndGetCookie(baseUrl, "reset-http@example.test", "OldPass-123");
    await resetUserPassword(pool, "reset-http@example.test", "NewPass-456", new Date());

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(401);

    const oldLogin = await postJson(baseUrl, "/api/auth/login", {
      email: "reset-http@example.test",
      password: "OldPass-123",
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await postJson(baseUrl, "/api/auth/login", {
      email: "reset-http@example.test",
      password: "NewPass-456",
    });
    expect(newLogin.status).toBe(200);
  });

  it("停用账号撤销旧 Cookie 并拒绝登录", async () => {
    await createTestAccount(pool, "disable-http@example.test", "DisablePass-1");
    const cookie = await loginAndGetCookie(baseUrl, "disable-http@example.test", "DisablePass-1");
    await setUserEnabled(pool, "disable-http@example.test", false, new Date());

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
    const login = await postJson(baseUrl, "/api/auth/login", {
      email: "disable-http@example.test",
      password: "DisablePass-1",
    });
    expect(login.status).toBe(401);
    expect(await readJsonObject(login)).toEqual({ error: "invalid_credentials" });
  });

  it("POST 要求 application/json 且允许 charset；错误类型 415", async () => {
    await createTestAccount(pool, "content-type@example.test", "ContentPass-1");
    const wrongType = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ email: "content-type@example.test", password: "ContentPass-1" }),
    });
    expect(wrongType.status).toBe(415);
    expect(await readJsonObject(wrongType)).toEqual({ error: "unsupported_media_type" });

    const missingType = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "content-type@example.test", password: "ContentPass-1" }),
    });
    expect(missingType.status).toBe(415);

    const withCharset = await postJson(
      baseUrl,
      "/api/auth/login",
      { email: "content-type@example.test", password: "ContentPass-1" },
      { "content-type": "application/json; charset=utf-8" },
    );
    expect(withCharset.status).toBe(200);
  });

  it("请求体超过 16 KiB 返回 413，坏 JSON 返回 400", async () => {
    const oversized = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${"a".repeat(17 * 1024)}@example.test`, password: "x" }),
    });
    expect(oversized.status).toBe(413);
    expect(await readJsonObject(oversized)).toEqual({ error: "payload_too_large" });

    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await readJsonObject(malformed)).toEqual({ error: "invalid_request" });
  });

  it("跨源 Origin 拒绝，同源 Origin 放行；未带 Origin 的请求放行", async () => {
    await createTestAccount(pool, "origin@example.test", "OriginPass-1");
    const crossOrigin = await postJson(
      baseUrl,
      "/api/auth/login",
      { email: "origin@example.test", password: "OriginPass-1" },
      { origin: "https://evil.example" },
    );
    expect(crossOrigin.status).toBe(403);
    expect(await readJsonObject(crossOrigin)).toEqual({ error: "cross_origin" });

    const sameOrigin = await postJson(
      baseUrl,
      "/api/auth/login",
      { email: "origin@example.test", password: "OriginPass-1" },
      { origin },
    );
    expect(sameOrigin.status).toBe(200);

    const noOrigin = await fetch(`${baseUrl}/api/health`);
    expect(noOrigin.status).toBe(200);
  });

  it("登录限流默认 10 次/15 分钟：第 11 次 429 并带 Retry-After，正确密码同样被阻断", async () => {
    await createTestAccount(pool, "ratelimit@example.test", "RightPass-1");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postJson(baseUrl, "/api/auth/login", {
        email: "ratelimit@example.test",
        password: "WrongPass-2",
      });
      expect(response.status).toBe(401);
    }
    const limited = await postJson(baseUrl, "/api/auth/login", {
      email: "ratelimit@example.test",
      password: "RightPass-1",
    });
    expect(limited.status).toBe(429);
    expect(await readJsonObject(limited)).toEqual({ error: "rate_limited" });
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });
});
