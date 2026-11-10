import { resolve } from "node:path";

export interface PgConnectionSettings {
  readonly host: string | null;
  readonly port: number | null;
  readonly user: string | null;
  readonly password: string | null;
  readonly database: string | null;
}

export interface IdentityConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly pg: PgConnectionSettings;
  readonly cookieName: string;
  readonly sessionTtlSeconds: number;
  readonly cookieSecure: boolean;
  readonly publicOrigin: string | null;
  readonly trustProxy: boolean;
  readonly internalToken: string | null;
  readonly staticDir: string | null;
  readonly migrationsDir: string;
  readonly loginRateLimitMax: number;
  readonly loginRateLimitWindowSeconds: number;
  readonly databaseConnectTimeoutMs: number;
}

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8788;
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_COOKIE_NAME = "snk_session";
export const DEFAULT_LOGIN_RATE_LIMIT_MAX = 10;
export const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_DATABASE_CONNECT_TIMEOUT_MS = 5000;
export const DEFAULT_MIGRATIONS_DIRECTORY = "db/migrations";

const COOKIE_NAME_PATTERN = /^[A-Za-z0-9_\-]+$/;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function readText(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = readText(env, name);
  if (raw === null) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new ConfigError(`${name} 必须是整数`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigError(`${name} 必须在 ${minimum}..${maximum} 之间`);
  }
  return parsed;
}

function readFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = readText(env, name);
  if (raw === null) return false;
  const normalized = raw.toLowerCase();
  return normalized === "1" || normalized === "true";
}

function normalizePublicOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("PUBLIC_ORIGIN 必须是合法 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError("PUBLIC_ORIGIN 只支持 http/https");
  }
  return parsed.origin;
}

function readPgSettings(env: NodeJS.ProcessEnv): PgConnectionSettings {
  return {
    host: readText(env, "PGHOST"),
    port: env.PGPORT === undefined ? null : readInteger(env, "PGPORT", 5432, 1, 65535),
    user: readText(env, "PGUSER"),
    password: readText(env, "PGPASSWORD"),
    database: readText(env, "PGDATABASE"),
  };
}

/**
 * 从进程环境读取配置。缺少数据库连接来源时立即失败；
 * 错误信息只包含变量名，不包含 URL、口令等敏感值。
 */
export function loadConfig(env: NodeJS.ProcessEnv, cwd: string): IdentityConfig {
  const databaseUrl = readText(env, "DATABASE_URL");
  const pg = readPgSettings(env);
  if (databaseUrl === null && pg.database === null) {
    throw new ConfigError("必须设置 DATABASE_URL 或 PGDATABASE 作为数据库连接来源");
  }
  const cookieName = readText(env, "COOKIE_NAME") ?? DEFAULT_COOKIE_NAME;
  if (!COOKIE_NAME_PATTERN.test(cookieName)) throw new ConfigError("COOKIE_NAME 只能包含字母、数字、下划线和连字符");
  const publicOriginRaw = readText(env, "PUBLIC_ORIGIN");
  const staticDirRaw = readText(env, "STATIC_DIR");
  const migrationsDirRaw = readText(env, "MIGRATIONS_DIR");
  return {
    host: readText(env, "HOST") ?? DEFAULT_HOST,
    port: readInteger(env, "PORT", DEFAULT_PORT, 1, 65535),
    databaseUrl,
    pg,
    cookieName,
    sessionTtlSeconds: readInteger(env, "SESSION_TTL_SECONDS", DEFAULT_SESSION_TTL_SECONDS, 60, 365 * 24 * 60 * 60),
    cookieSecure: readFlag(env, "COOKIE_SECURE"),
    publicOrigin: publicOriginRaw === null ? null : normalizePublicOrigin(publicOriginRaw),
    trustProxy: readFlag(env, "TRUST_PROXY"),
    internalToken: readText(env, "INTERNAL_TOKEN"),
    staticDir: staticDirRaw === null ? null : resolve(cwd, staticDirRaw),
    migrationsDir: migrationsDirRaw === null ? resolve(cwd, DEFAULT_MIGRATIONS_DIRECTORY) : resolve(cwd, migrationsDirRaw),
    loginRateLimitMax: readInteger(env, "LOGIN_RATE_LIMIT_MAX", DEFAULT_LOGIN_RATE_LIMIT_MAX, 1, 100000),
    loginRateLimitWindowSeconds: readInteger(env, "LOGIN_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS, 1, 24 * 60 * 60),
    databaseConnectTimeoutMs: readInteger(env, "DATABASE_CONNECT_TIMEOUT_MS", DEFAULT_DATABASE_CONNECT_TIMEOUT_MS, 100, 120000),
  };
}
