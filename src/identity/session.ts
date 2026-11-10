import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionCookieOptions {
  readonly name: string;
  readonly token: string;
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name.length === 0 || cookies.has(name)) continue;
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function withCookieAttributes(cookie: string, secure: boolean): string {
  return secure ? `${cookie}; Secure` : cookie;
}

/** `HttpOnly; Path=/; SameSite=Lax; Max-Age`；COOKIE_SECURE=1 时追加 Secure。 */
export function serializeSessionCookie(options: SessionCookieOptions): string {
  return withCookieAttributes(
    `${options.name}=${options.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${options.maxAgeSeconds}`,
    options.secure,
  );
}

export function serializeClearedSessionCookie(options: { readonly name: string; readonly secure: boolean }): string {
  return withCookieAttributes(`${options.name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`, options.secure);
}
