import { describe, expect, it, vi } from "vitest";
import { AuthClient, AuthError } from "../../src/auth/client.js";

function jsonResponse(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

describe("browser auth client", () => {
  it("treats an unauthenticated /me as no current session", async () => {
    const fetcher = vi.fn(async () => jsonResponse(401, { error: "unauthenticated" }));
    const client = new AuthClient("/api", fetcher as typeof fetch);
    expect(await client.me()).toBeNull();
  });

  it("parses the current identity and session expiry", async () => {
    const fetcher = vi.fn(async () => jsonResponse(200, {
      user: { id: "u-1", email: "a@example.com", role: "player", createdAt: "2026-01-01T00:00:00.000Z" },
      expiresAt: "2026-01-08T00:00:00.000Z"
    }));
    const client = new AuthClient("/api", fetcher as typeof fetch);
    expect(await client.me()).toEqual({
      user: { id: "u-1", email: "a@example.com", role: "player", createdAt: "2026-01-01T00:00:00.000Z" },
      expiresAt: "2026-01-08T00:00:00.000Z"
    });
  });

  it("maps login failures without leaking account details", async () => {
    const invalid = new AuthClient("/api", (async () => jsonResponse(401, { error: "invalid_credentials" })) as typeof fetch);
    await expect(invalid.login("a@example.com", "bad")).rejects.toMatchObject({ code: "invalid_credentials" });

    const limited = new AuthClient("/api", (async () => jsonResponse(429, {
      error: "rate_limited", retryAfterSeconds: 42
    }, { "Retry-After": "42" })) as typeof fetch);
    await expect(limited.login("a@example.com", "bad")).rejects.toMatchObject({
      code: "rate_limited", retryAfterSeconds: 42
    });
  });

  it("treats network and server failures as unavailable, not as login", async () => {
    const offline = new AuthClient("/api", (async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(offline.me()).rejects.toBeInstanceOf(AuthError);
    await expect(offline.me()).rejects.toMatchObject({ code: "unavailable" });

    const broken = new AuthClient("/api", (async () => jsonResponse(503, { error: "database_down" })) as typeof fetch);
    await expect(broken.login("a@example.com", "x")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("treats logout after an expired session as already logged out", async () => {
    const client = new AuthClient("/api", (async () => new Response(null, { status: 401 })) as typeof fetch);
    await expect(client.logout()).resolves.toBeUndefined();
  });
});
