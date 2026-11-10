import type { Pool } from "pg";
import { withTransaction } from "./db.js";
import { normalizeEmail } from "./email.js";
import { hashPassword, verifyPasswordOrDummy } from "./password.js";
import type { LoginRateLimiter } from "./rate-limit.js";
import { createSession, findSessionWithUser, revokeSession } from "./sessions.js";
import { createSessionToken, hashSessionToken, isSessionToken } from "./session.js";
import type { IdentitySessionView, UserRole } from "./types.js";
import {
  findUserByEmail,
  insertUserIfAbsent,
  listUserAccounts as listStoredUsers,
  toIdentityUser,
  type StoredUser,
} from "./users.js";

const MAX_PASSWORD_LENGTH = 1024;
const MAX_RATE_LIMIT_EMAIL_LENGTH = 320;

export interface LoginDependencies {
  readonly pool: Pool;
  readonly limiter: LoginRateLimiter;
  readonly sessionTtlSeconds: number;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly clientIp: string;
  readonly now: Date;
}

export type LoginOutcome =
  | { readonly ok: true; readonly token: string; readonly view: IdentitySessionView }
  | { readonly ok: false; readonly error: "invalid_credentials" | "rate_limited"; readonly retryAfterSeconds: number };

function rateLimitKey(clientIp: string, email: string): string {
  return `${clientIp}|${email.slice(0, MAX_RATE_LIMIT_EMAIL_LENGTH)}`;
}

function buildSessionView(user: StoredUser, expiresAt: Date): IdentitySessionView {
  return { user: toIdentityUser(user), expiresAt: expiresAt.toISOString() };
}

/**
 * 统一登录：邮箱不存在、密码错误、账号停用都返回 invalid_credentials，
 * 且不存在用户时执行等价 scrypt 开销；限流检查在密码校验前。
 */
export async function login(dependencies: LoginDependencies, request: LoginRequest): Promise<LoginOutcome> {
  const normalizedEmail = normalizeEmail(request.email);
  const emailKey = normalizedEmail ?? request.email.trim().toLowerCase();
  const key = rateLimitKey(request.clientIp, emailKey);
  const nowMs = request.now.getTime();
  const blocked = dependencies.limiter.status(key, nowMs);
  if (blocked.limited) return { ok: false, error: "rate_limited", retryAfterSeconds: blocked.retryAfterSeconds };
  const user = normalizedEmail === null ? null : await findUserByEmail(dependencies.pool, normalizedEmail);
  const passwordMatches = await verifyPasswordOrDummy(request.password, user?.passwordHash ?? null);
  if (!passwordMatches || user === null || user.status !== "active") {
    dependencies.limiter.recordFailure(key, nowMs);
    return { ok: false, error: "invalid_credentials", retryAfterSeconds: 0 };
  }
  dependencies.limiter.reset(key);
  const token = createSessionToken();
  const expiresAt = new Date(nowMs + dependencies.sessionTtlSeconds * 1000);
  await createSession(dependencies.pool, { tokenHash: hashSessionToken(token), userId: user.id, expiresAt });
  return { ok: true, token, view: buildSessionView(user, expiresAt) };
}

/** 过期、已撤销、账号停用或 token 格式非法都视为未登录。 */
export async function authenticateSession(pool: Pool, token: string, now: Date): Promise<IdentitySessionView | null> {
  if (!isSessionToken(token)) return null;
  const found = await findSessionWithUser(pool, hashSessionToken(token), now);
  if (found === null) return null;
  return buildSessionView(found.user, found.session.expiresAt);
}

export async function logout(pool: Pool, token: string, now: Date): Promise<void> {
  if (!isSessionToken(token)) return;
  await revokeSession(pool, hashSessionToken(token), now);
}

export type CreateUserOutcome =
  | { readonly ok: true; readonly user: StoredUser; readonly created: boolean }
  | { readonly ok: false; readonly error: "invalid_email" | "invalid_password" };

/**
 * create-user 幂等语义：邮箱已存在时直接返回已有账号与 created=false，
 * 不重新哈希、不覆盖密码、不改变 ID。
 */
export async function createUserAccount(
  pool: Pool,
  input: { readonly email: string; readonly password: string; readonly role: UserRole },
): Promise<CreateUserOutcome> {
  const email = normalizeEmail(input.email);
  if (email === null) return { ok: false, error: "invalid_email" };
  if (input.password.length === 0 || input.password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: "invalid_password" };
  }
  const existing = await findUserByEmail(pool, email);
  if (existing !== null) return { ok: true, user: existing, created: false };
  const passwordHash = await hashPassword(input.password);
  const inserted = await insertUserIfAbsent(pool, { email, passwordHash, role: input.role });
  return { ok: true, user: inserted.user, created: inserted.created };
}

/** 改密同时撤销该用户全部旧会话。 */
export async function resetUserPassword(
  pool: Pool,
  email: string,
  newPassword: string,
  now: Date,
): Promise<StoredUser | null> {
  if (newPassword.length === 0 || newPassword.length > MAX_PASSWORD_LENGTH) throw new Error("invalid password");
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === null) return null;
  const user = await findUserByEmail(pool, normalizedEmail);
  if (user === null) return null;
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(pool, async (client) => {
    await client.query("UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1", [user.id, passwordHash, now]);
    await client.query("UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [user.id, now]);
  });
  return user;
}

/** 停用时撤销全部旧会话；重新启用不恢复旧会话。 */
export async function setUserEnabled(pool: Pool, email: string, enabled: boolean, now: Date): Promise<StoredUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail === null) return null;
  const user = await findUserByEmail(pool, normalizedEmail);
  if (user === null) return null;
  const status = enabled ? "active" : "disabled";
  await withTransaction(pool, async (client) => {
    await client.query("UPDATE users SET status = $2, updated_at = $3 WHERE id = $1", [user.id, status, now]);
    if (!enabled) {
      await client.query("UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL", [user.id, now]);
    }
  });
  return { ...user, status };
}

export async function listUserAccounts(pool: Pool): Promise<readonly StoredUser[]> {
  return listStoredUsers(pool);
}
