import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/identity/config";
import { normalizeEmail } from "../../src/identity/email";
import { readCredentials, readJsonBody, readSessionTokenBody } from "../../src/identity/http-request";
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from "../../src/identity/password";
import { createLoginRateLimiter } from "../../src/identity/rate-limit";
import { isJsonContentType, isOriginAllowed, normalizeOrigin, readBearerToken, resolveClientIp } from "../../src/identity/request-guard";
import { createSecretReader, SecretInputCancelledError, SecretInputError, type SecretInput } from "../../src/identity/secret";
import { isInternalTokenValid } from "../../src/identity/secret-token";
import {
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  parseCookieHeader,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "../../src/identity/session";
import { contentTypeForPath } from "../../src/identity/static";
import { isUserRole, isUserStatus } from "../../src/identity/types";

describe("密码哈希", () => {
  it("使用 scrypt$N$r$p$salt$hash 格式、随机盐且可校验", async () => {
    const encoded = await hashPassword("correct horse battery");
    expect(encoded.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(encoded.split("$")).toHaveLength(6);
    const parts = encoded.split("$");
    expect(parts[4]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[5]).toMatch(/^[0-9a-f]{128}$/);
    const again = await hashPassword("correct horse battery");
    expect(again).not.toBe(encoded);
    await expect(verifyPassword("correct horse battery", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("非法格式与越界参数返回 false，不存在用户走等价开销但恒为 false", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$999$8$1$00$00")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$16384$8$1$00$00")).resolves.toBe(false);
    await expect(verifyPasswordOrDummy("x", null)).resolves.toBe(false);
  });
});

describe("邮箱规范化", () => {
  it("trim + lowercase 并拒绝空值与明显非法格式", () => {
    expect(normalizeEmail("  Beta.Player@Example.COM ")).toBe("beta.player@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("no-at-sign")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(320)}@example.com`)).toBeNull();
  });
});

describe("会话 token 与 Cookie", () => {
  it("32 字节随机 token 与 sha256 存储形式", () => {
    const token = createSessionToken();
    expect(token).toHaveLength(43);
    expect(isSessionToken(token)).toBe(true);
    expect(isSessionToken("short")).toBe(false);
    expect(isSessionToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(createSessionToken()).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("Cookie 属性包含 HttpOnly/Path/SameSite/Max-Age，Secure 按配置追加", () => {
    const cookie = serializeSessionCookie({ name: "snk_session", token: "abc", maxAgeSeconds: 3600, secure: false });
    expect(cookie).toBe("snk_session=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600");
    expect(cookie).not.toContain("Secure");
    expect(serializeSessionCookie({ name: "snk_session", token: "abc", maxAgeSeconds: 60, secure: true })).toContain("; Secure");
    expect(serializeClearedSessionCookie({ name: "snk_session", secure: false })).toBe(
      "snk_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
    );
    expect(serializeClearedSessionCookie({ name: "snk_session", secure: true })).toContain("; Secure");
  });

  it("解析 Cookie 头，重复键取第一个，坏值不抛出", () => {
    const cookies = parseCookieHeader('a=1; snk_session="token"; broken; a=2');
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("snk_session")).toBe("token");
    expect(cookies.get("missing")).toBeUndefined();
    expect(parseCookieHeader(undefined).size).toBe(0);
    expect(parseCookieHeader("x=%E0%A4%A").get("x")).toBe("%E0%A4%A");
  });
});

describe("登录限流", () => {
  it("固定窗口按失败次数阻断，窗口过期后恢复，成功可清空", () => {
    const limiter = createLoginRateLimiter({ maxAttempts: 3, windowMs: 1000 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.status("ip|mail", 0).limited).toBe(false);
      limiter.recordFailure("ip|mail", 0);
    }
    const blocked = limiter.status("ip|mail", 500);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(1);
    expect(limiter.status("another", 500).limited).toBe(false);
    expect(limiter.status("ip|mail", 1000).limited).toBe(false);
    for (let attempt = 0; attempt < 3; attempt += 1) limiter.recordFailure("ip|mail", 1000);
    expect(limiter.status("ip|mail", 1500).limited).toBe(true);
    limiter.reset("ip|mail");
    expect(limiter.status("ip|mail", 1500).limited).toBe(false);
  });
});

describe("请求保护", () => {
  it("Origin 校验：无 Origin 放行，配置 PUBLIC_ORIGIN 精确匹配，否则按 Host 比较", () => {
    expect(isOriginAllowed(undefined, "example.test", null)).toBe(true);
    expect(normalizeOrigin("https://Example.test/path?q=1")).toBe("https://example.test");
    expect(normalizeOrigin("file:///tmp/x")).toBeNull();
    expect(isOriginAllowed("https://snk.example", "snk.example", "https://snk.example/")).toBe(true);
    expect(isOriginAllowed("https://evil.example", "snk.example", "https://snk.example")).toBe(false);
    expect(isOriginAllowed("http://localhost:8788", "localhost:8788", null)).toBe(true);
    expect(isOriginAllowed("http://localhost:8788", "localhost:9999", null)).toBe(false);
    expect(isOriginAllowed("not a url", "localhost:8788", null)).toBe(false);
    expect(isOriginAllowed("http://localhost:8788", undefined, null)).toBe(false);
  });

  it("Content-Type 只接受 application/json（允许参数）", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("Application/JSON")).toBe(true);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it("来源 IP 默认 socket，TRUST_PROXY=1 才取 X-Forwarded-For 最左合法值", () => {
    const request = {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    };
    expect(resolveClientIp(request, false)).toBe("127.0.0.1");
    expect(resolveClientIp(request, true)).toBe("203.0.113.7");
    expect(resolveClientIp({ headers: { "x-forwarded-for": "not-an-ip" }, socket: { remoteAddress: "127.0.0.1" } }, true)).toBe("127.0.0.1");
    expect(resolveClientIp({ headers: {}, socket: { remoteAddress: undefined } }, false)).toBe("unknown");
    expect(readBearerToken("Bearer secret-token")).toBe("secret-token");
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
  });
});

describe("请求体解析", () => {
  it("读取 JSON 对象并区分空体、坏 JSON、超限", async () => {
    await expect(readJsonBody(Readable.from(['{"email":"a@b.test"}']))).resolves.toEqual({
      ok: true,
      value: { email: "a@b.test" },
    });
    await expect(readJsonBody(Readable.from(["{"])).then((result) => result.ok)).resolves.toBe(false);
    await expect(readJsonBody(Readable.from([""]))).resolves.toEqual({ ok: false, failure: "invalid_json" });
    await expect(readJsonBody(Readable.from([Buffer.alloc(17 * 1024)]))).resolves.toEqual({ ok: false, failure: "too_large" });
  });

  it("凭证与内部 token 请求体只接受字符串字段", () => {
    expect(readCredentials({ email: "a@b.test", password: "p" })).toEqual({ email: "a@b.test", password: "p" });
    expect(readCredentials({ email: 1, password: "p" })).toBeNull();
    expect(readCredentials(null)).toBeNull();
    expect(readSessionTokenBody({ token: "t" })).toBe("t");
    expect(readSessionTokenBody({ token: 2 })).toBeNull();
  });
});

describe("静态内容类型", () => {
  it("覆盖 html/js/css/json/图片/音频/babylon/map 等", () => {
    expect(contentTypeForPath("/a/index.html")).toContain("text/html");
    expect(contentTypeForPath("/a/app.js")).toContain("text/javascript");
    expect(contentTypeForPath("/a/app.css")).toContain("text/css");
    expect(contentTypeForPath("/a/data.json")).toContain("application/json");
    expect(contentTypeForPath("/a/data.json.map")).toContain("application/json");
    expect(contentTypeForPath("/a/table.babylon")).toBe("application/octet-stream");
    expect(contentTypeForPath("/a/ball.png")).toBe("image/png");
    expect(contentTypeForPath("/a/ball.jpg")).toBe("image/jpeg");
    expect(contentTypeForPath("/a/icon.svg")).toBe("image/svg+xml");
    expect(contentTypeForPath("/a/hit.wav")).toBe("audio/wav");
    expect(contentTypeForPath("/a/unknown.xyz")).toBe("application/octet-stream");
  });
});

describe("配置读取", () => {
  const cwd = "/srv/kvb-snooker";

  it("默认值与相对路径解析，不使用未配置的可选项", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://user:secret@db:5432/kvb" }, cwd);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8788);
    expect(config.cookieName).toBe("snk_session");
    expect(config.sessionTtlSeconds).toBe(604800);
    expect(config.cookieSecure).toBe(false);
    expect(config.publicOrigin).toBeNull();
    expect(config.trustProxy).toBe(false);
    expect(config.internalToken).toBeNull();
    expect(config.staticDir).toBeNull();
    expect(config.migrationsDir).toBe(resolve(cwd, "db/migrations"));
    expect(config.loginRateLimitMax).toBe(10);
    expect(config.loginRateLimitWindowSeconds).toBe(900);
  });

  it("环境变量覆盖，PUBLIC_ORIGIN 归一化，STATIC_DIR 解析为绝对路径", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://user:secret@db:5432/kvb",
      HOST: "0.0.0.0",
      PORT: "9000",
      COOKIE_SECURE: "1",
      PUBLIC_ORIGIN: "https://beta.example/path",
      TRUST_PROXY: "true",
      INTERNAL_TOKEN: "internal-token-value",
      STATIC_DIR: "dist",
      MIGRATIONS_DIR: "db/migrations",
      SESSION_TTL_SECONDS: "120",
      LOGIN_RATE_LIMIT_MAX: "3",
      LOGIN_RATE_LIMIT_WINDOW_SECONDS: "60",
    }, cwd);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9000);
    expect(config.cookieSecure).toBe(true);
    expect(config.publicOrigin).toBe("https://beta.example");
    expect(config.trustProxy).toBe(true);
    expect(config.internalToken).toBe("internal-token-value");
    expect(config.staticDir).toBe(resolve(cwd, "dist"));
    expect(config.sessionTtlSeconds).toBe(120);
    expect(config.loginRateLimitMax).toBe(3);
  });

  it("支持 PG* 回退，缺连接来源或非法值明确失败且不泄露连接串", () => {
    const fallback = loadConfig({ PGDATABASE: "kvb", PGHOST: "127.0.0.1", PGPORT: "55432" }, cwd);
    expect(fallback.databaseUrl).toBeNull();
    expect(fallback.pg.database).toBe("kvb");
    expect(fallback.pg.port).toBe(55432);
    expect(() => loadConfig({}, cwd)).toThrow(ConfigError);
    expect(() => loadConfig({ PGDATABASE: "kvb", PORT: "abc" }, cwd)).toThrow(ConfigError);
    expect(() => loadConfig({ PGDATABASE: "kvb", PUBLIC_ORIGIN: "javascript:alert(1)" }, cwd)).toThrow(ConfigError);
    expect(() => loadConfig({ PGDATABASE: "kvb", COOKIE_NAME: "bad name" }, cwd)).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: "postgres://user:secret@db/kvb", PORT: "0" }, cwd)).toThrow(ConfigError);
  });
});

describe("隐藏密码输入", () => {
  function interactiveInput(): { input: SecretInput; rawModes: boolean[] } {
    const rawModes: boolean[] = [];
    const input: SecretInput = Object.assign(new EventEmitter(), {
      isTTY: true,
      setEncoding: (): void => undefined,
      resume: (): void => undefined,
      pause: (): void => undefined,
      setRawMode: (mode: boolean): void => {
        rawModes.push(mode);
      },
    });
    return { input, rawModes };
  }

  it("非 TTY（管道）按行读取，不向非 TTY 输出提示", async () => {
    const output = { isTTY: false, write: (): boolean => true };
    const reader = createSecretReader({ input: Readable.from(["first-secret\nsecond-secret\n"]), output });
    await expect(reader.read("Password: ")).resolves.toBe("first-secret");
    await expect(reader.read("Repeat: ")).resolves.toBe("second-secret");
    reader.close();
  });

  it("非 TTY 提前 EOF 报错", async () => {
    const reader = createSecretReader({ input: Readable.from([]), output: { isTTY: false, write: () => true } });
    await expect(reader.read("Password: ")).rejects.toBeInstanceOf(SecretInputError);
    reader.close();
  });

  it("TTY raw mode 支持逐字符、退格与回车，且不打印密码", async () => {
    const { input, rawModes } = interactiveInput();
    const written: string[] = [];
    const output = { isTTY: true, write: (chunk: string): boolean => { written.push(chunk); return true; } };
    const reader = createSecretReader({ input, output });
    const pending = reader.read("Password: ");
    input.emit("data", "ab\u007fc\r");
    await expect(pending).resolves.toBe("ac");
    expect(rawModes).toEqual([true, false]);
    expect(written.join("")).toBe("Password: ");
    reader.close();
  });

  it("TTY 下 Ctrl+C 取消输入并恢复终端", async () => {
    const { input, rawModes } = interactiveInput();
    const reader = createSecretReader({ input, output: { isTTY: false, write: () => true } });
    const pending = reader.read("Password: ");
    input.emit("data", "\u0003");
    await expect(pending).rejects.toBeInstanceOf(SecretInputCancelledError);
    expect(rawModes).toEqual([true, false]);
    reader.close();
  });
});

describe("类型守卫与内部令牌", () => {
  it("角色/状态取值受限，内部令牌等长比较", () => {
    expect(isUserRole("player")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("guest")).toBe(false);
    expect(isUserStatus("active")).toBe(true);
    expect(isUserStatus("disabled")).toBe(true);
    expect(isUserStatus("banned")).toBe(false);
    expect(isInternalTokenValid("same-token", "same-token")).toBe(true);
    expect(isInternalTokenValid("same-token", "other-token")).toBe(false);
    expect(isInternalTokenValid("short", "a-much-longer-token")).toBe(false);
  });
});
