import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { IdentityConfig } from "./config.js";
import { isDatabaseAvailable } from "./db.js";
import { authenticateSession, login, logout } from "./identity-service.js";
import { handleInternalVerify } from "./internal.js";
import { MAX_JSON_BODY_BYTES, readCredentials, readJsonBody } from "./http-request.js";
import { writeError, writeJson, writeNoContent } from "./http-response.js";
import { createLoginRateLimiter, type LoginRateLimiter } from "./rate-limit.js";
import { isJsonContentType, isOriginAllowed, resolveClientIp } from "./request-guard.js";
import {
  isSessionToken,
  parseCookieHeader,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./session.js";
import { serveStaticFile } from "./static.js";

const RETRY_AFTER_HEADER = "retry-after";
const SET_COOKIE_HEADER = "set-cookie";

export type IdentityLogger = (message: string) => void;

export interface IdentityServerOptions {
  readonly pool: Pool;
  readonly config: IdentityConfig;
  readonly now?: () => Date;
  readonly logger?: IdentityLogger;
}

interface RequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly pool: Pool;
  readonly config: IdentityConfig;
  readonly limiter: LoginRateLimiter;
  readonly clock: () => Date;
  readonly pathname: string;
  readonly method: string;
  readonly clientIp: string;
}

function defaultLogger(message: string): void {
  process.stdout.write(`${message}\n`);
}

function readCookieToken(request: IncomingMessage, cookieName: string): string | null {
  const token = parseCookieHeader(request.headers.cookie).get(cookieName);
  return token === undefined || !isSessionToken(token) ? null : token;
}

function methodNotAllowed(response: ServerResponse, allowed: readonly string[]): number {
  return writeError(response, 405, "method_not_allowed", { allow: allowed.join(", ") });
}

async function handleHealth(context: RequestContext): Promise<number> {
  const databaseUp = await isDatabaseAvailable(context.pool);
  return databaseUp
    ? writeJson(context.response, 200, { ok: true, database: "up" })
    : writeJson(context.response, 503, { ok: false, database: "down" });
}

async function handleLogin(context: RequestContext): Promise<number> {
  const { request, response, config, pool, limiter, clock, clientIp } = context;
  if (!isJsonContentType(request.headers["content-type"])) {
    return writeError(response, 415, "unsupported_media_type");
  }
  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (!body.ok) {
    return body.failure === "too_large"
      ? writeError(response, 413, "payload_too_large")
      : writeError(response, 400, "invalid_request");
  }
  const credentials = readCredentials(body.value);
  if (credentials === null) return writeError(response, 400, "invalid_request");
  const outcome = await login(
    { pool, limiter, sessionTtlSeconds: config.sessionTtlSeconds },
    { email: credentials.email, password: credentials.password, clientIp, now: clock() },
  );
  if (!outcome.ok) {
    return outcome.error === "rate_limited"
      ? writeError(response, 429, "rate_limited", { [RETRY_AFTER_HEADER]: String(outcome.retryAfterSeconds) })
      : writeError(response, 401, "invalid_credentials");
  }
  const setCookie = serializeSessionCookie({
    name: config.cookieName,
    token: outcome.token,
    maxAgeSeconds: config.sessionTtlSeconds,
    secure: config.cookieSecure,
  });
  return writeJson(response, 200, outcome.view, { [SET_COOKIE_HEADER]: setCookie });
}

async function handleMe(context: RequestContext): Promise<number> {
  const token = readCookieToken(context.request, context.config.cookieName);
  if (token === null) return writeError(context.response, 401, "unauthenticated");
  const view = await authenticateSession(context.pool, token, context.clock());
  return view === null ? writeError(context.response, 401, "unauthenticated") : writeJson(context.response, 200, view);
}

async function handleLogout(context: RequestContext): Promise<number> {
  const token = readCookieToken(context.request, context.config.cookieName);
  if (token !== null) await logout(context.pool, token, context.clock());
  const setCookie = serializeClearedSessionCookie({ name: context.config.cookieName, secure: context.config.cookieSecure });
  return writeNoContent(context.response, { [SET_COOKIE_HEADER]: setCookie });
}

async function handleApiRequest(context: RequestContext): Promise<number> {
  const { request, response, config, pathname, method } = context;
  if (!isOriginAllowed(request.headers.origin, request.headers.host, config.publicOrigin)) {
    return writeError(response, 403, "cross_origin");
  }
  if (pathname === "/api/health") {
    return method === "GET" ? handleHealth(context) : methodNotAllowed(response, ["GET"]);
  }
  if (pathname === "/api/auth/login") {
    return method === "POST" ? handleLogin(context) : methodNotAllowed(response, ["POST"]);
  }
  if (pathname === "/api/auth/me") {
    return method === "GET" ? handleMe(context) : methodNotAllowed(response, ["GET"]);
  }
  if (pathname === "/api/auth/logout") {
    return method === "POST" ? handleLogout(context) : methodNotAllowed(response, ["POST"]);
  }
  if (pathname === "/api/internal/session/verify") {
    if (config.internalToken === null) return writeError(response, 404, "not_found");
    if (method !== "POST") return methodNotAllowed(response, ["POST"]);
    return handleInternalVerify(request, response, {
      pool: context.pool,
      internalToken: config.internalToken,
      now: context.clock(),
    });
  }
  return writeError(response, 404, "not_found");
}

function createRequestHandler(options: IdentityServerOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { pool, config } = options;
  const clock = options.now ?? (() => new Date());
  const logger = options.logger ?? defaultLogger;
  const limiter = createLoginRateLimiter({
    maxAttempts: config.loginRateLimitMax,
    windowMs: config.loginRateLimitWindowSeconds * 1000,
  });

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const startedAt = process.hrtime.bigint();
    let pathname = "/";
    let method = request.method ?? "GET";
    let clientIp = "unknown";
    let status = 500;
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      pathname = url.pathname;
      clientIp = resolveClientIp(request, config.trustProxy);
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        status = await handleApiRequest({
          request,
          response,
          pool,
          config,
          limiter,
          clock,
          pathname,
          method,
          clientIp,
        });
      } else if (config.staticDir !== null) {
        const result = await serveStaticFile(config.staticDir, pathname, method, response);
        status = result === null ? methodNotAllowed(response, ["GET", "HEAD"]) : result.status;
      } else {
        status = writeError(response, 404, "not_found");
      }
    } catch {
      status = response.headersSent ? 500 : writeError(response, 500, "internal_error");
      if (response.headersSent) response.destroy();
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger(`${method} ${pathname} ${status} ${durationMs.toFixed(1)}ms ${clientIp}`);
    }
  };
}

/** 日志只含方法、路径（不含 query）、状态、耗时与来源地址；不记录 Cookie/请求体/邮箱/数据库 URL。 */
export function createIdentityHttpServer(options: IdentityServerOptions): Server {
  const handler = createRequestHandler(options);
  return createServer((request, response) => {
    void handler(request, response);
  });
}
