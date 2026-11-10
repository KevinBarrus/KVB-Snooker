import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { IdentityConfig } from "../../src/identity/config";
import { createUserAccount } from "../../src/identity/identity-service";
import { createIdentityHttpServer } from "../../src/identity/http";
import type { UserRole } from "../../src/identity/types";
import type { StoredUser } from "../../src/identity/users";

/** 真实数据库测试必需；未设置时数据库相关测试整体跳过。 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const databaseConfigured = TEST_DATABASE_URL.length > 0;
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../db/migrations", import.meta.url));

export interface TestDatabase {
  readonly pool: Pool;
  readonly schema: string;
  dispose(): Promise<void>;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * 每个测试文件使用独立 schema，避免 vitest 并行文件互相清表。
 * 连接通过启动参数固定 search_path，迁移与业务表都落在该 schema。
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!databaseConfigured) throw new Error("TEST_DATABASE_URL 未设置");
  const schema = `identity_test_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  await admin.end();
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10_000,
    options: `-c search_path=${schema}`,
  });
  return {
    pool,
    schema,
    async dispose(): Promise<void> {
      await pool.end().catch(() => undefined);
      const cleanup = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

export function makeTestConfig(overrides: Partial<IdentityConfig> = {}): IdentityConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databaseUrl: TEST_DATABASE_URL,
    pg: { host: null, port: null, user: null, password: null, database: null },
    cookieName: "snk_session",
    sessionTtlSeconds: 3600,
    cookieSecure: false,
    publicOrigin: null,
    trustProxy: false,
    internalToken: null,
    staticDir: null,
    migrationsDir: MIGRATIONS_DIRECTORY,
    loginRateLimitMax: 10,
    loginRateLimitWindowSeconds: 900,
    databaseConnectTimeoutMs: 2000,
    ...overrides,
  };
}

export interface RunningTestServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startTestServer(options: {
  readonly pool: Pool;
  readonly config: IdentityConfig;
  readonly now?: () => Date;
}): Promise<RunningTestServer> {
  const server = createIdentityHttpServer({
    pool: options.pool,
    config: options.config,
    logger: () => undefined,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("测试服务器未返回监听端口");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function createTestAccount(
  pool: Pool,
  email: string,
  password: string,
  role: UserRole = "player",
): Promise<StoredUser> {
  const outcome = await createUserAccount(pool, { email, password, role });
  if (!outcome.ok) throw new Error(`测试账号创建失败：${outcome.error}`);
  return outcome.user;
}

export async function truncateIdentityTables(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE");
}

export function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("响应缺少 set-cookie");
  const pair = header.split(";")[0]?.trim();
  if (pair === undefined || pair.length === 0) throw new Error("set-cookie 格式异常");
  return pair;
}

export async function loginAndGetCookie(baseUrl: string, email: string, password: string): Promise<string> {
  const response = await postJson(baseUrl, "/api/auth/login", { email, password });
  if (response.status !== 200) throw new Error(`测试登录失败：${response.status}`);
  return sessionCookie(response);
}

export async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("响应不是 JSON 对象");
  return value as Record<string, unknown>;
}
