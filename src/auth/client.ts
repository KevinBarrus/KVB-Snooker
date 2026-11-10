export type IdentityRole = "player" | "admin";

export interface IdentityUser {
  readonly id: string;
  readonly email: string;
  readonly role: IdentityRole;
  readonly createdAt: string;
}

export interface IdentitySession {
  readonly user: IdentityUser;
  readonly expiresAt: string;
}

export type AuthErrorCode = "invalid_request" | "invalid_credentials" | "rate_limited" | "unavailable";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly retryAfterSeconds = 0) {
    super(code);
    this.name = "AuthError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): IdentityUser | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.email !== "string" ||
      (value.role !== "player" && value.role !== "admin") || typeof value.createdAt !== "string") return null;
  return { id: value.id, email: value.email, role: value.role, createdAt: value.createdAt };
}

function parseSession(value: unknown): IdentitySession | null {
  if (!isRecord(value)) return null;
  const user = parseUser(value.user);
  if (!user || typeof value.expiresAt !== "string") return null;
  return { user, expiresAt: value.expiresAt };
}

function retrySeconds(response: Response, payload: unknown): number {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return header;
  if (isRecord(payload) && typeof payload.retryAfterSeconds === "number" &&
      Number.isFinite(payload.retryAfterSeconds) && payload.retryAfterSeconds > 0) return payload.retryAfterSeconds;
  return 0;
}

async function errorFor(response: Response): Promise<AuthError> {
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 401) return new AuthError("invalid_credentials");
  if (response.status === 429) return new AuthError("rate_limited", retrySeconds(response, payload));
  if (response.status === 400) return new AuthError("invalid_request");
  return new AuthError("unavailable");
}

async function body(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export class AuthClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;
  constructor(base = "/api", fetcher?: typeof fetch) {
    this.base = base.replace(/\/+$/, "");
    // 浏览器原生 fetch 不能以 AuthClient 作为接收者调用，否则 Illegal invocation。
    this.fetcher = fetcher ?? fetch.bind(globalThis);
  }

  async me(): Promise<IdentitySession | null> {
    let response: Response;
    try { response = await this.fetcher(`${this.base}/auth/me`, { credentials: "same-origin" }); }
    catch { throw new AuthError("unavailable"); }
    if (response.status === 401) return null;
    if (!response.ok) throw await errorFor(response);
    const session = parseSession(await body(response));
    if (!session) throw new AuthError("unavailable");
    return session;
  }

  async login(email: string, password: string): Promise<IdentitySession> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}/auth/login`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
    } catch { throw new AuthError("unavailable"); }
    if (!response.ok) throw await errorFor(response);
    const session = parseSession(await body(response));
    if (!session) throw new AuthError("unavailable");
    return session;
  }

  async logout(): Promise<void> {
    let response: Response;
    try { response = await this.fetcher(`${this.base}/auth/logout`, { method: "POST", credentials: "same-origin" }); }
    catch { throw new AuthError("unavailable"); }
    if (response.ok || response.status === 401) return;
    throw await errorFor(response);
  }
}
