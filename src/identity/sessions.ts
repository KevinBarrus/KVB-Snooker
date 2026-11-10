import type { Pool, QueryResultRow } from "pg";
import type { UserRole, UserStatus } from "./types.js";
import { mapUserRow, type StoredUser, type UserRow } from "./users.js";

export interface SessionRow extends QueryResultRow {
  token_hash: string;
  user_id: string;
  session_created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface StoredSession {
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionWithUserRow extends UserRow {
  token_hash: string;
  user_id: string;
  session_created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface SessionWithUser {
  readonly session: StoredSession;
  readonly user: StoredUser;
}

const SESSION_RETURNING_COLUMNS = "token_hash, user_id, created_at AS session_created_at, expires_at, revoked_at";
const SESSION_SELECT_COLUMNS = "s.token_hash, s.user_id, s.created_at AS session_created_at, s.expires_at, s.revoked_at";

function mapSessionRow(row: SessionRow): StoredSession {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.session_created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function createSession(
  pool: Pool,
  input: { readonly tokenHash: string; readonly userId: string; readonly expiresAt: Date },
): Promise<StoredSession> {
  const result = await pool.query<SessionRow>(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3) RETURNING ${SESSION_RETURNING_COLUMNS}`,
    [input.tokenHash, input.userId, input.expiresAt],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("会话创建未返回记录");
  return mapSessionRow(row);
}

/** 只返回未撤销、未过期且账号为 active 的会话。 */
export async function findSessionWithUser(pool: Pool, tokenHash: string, now: Date): Promise<SessionWithUser | null> {
  const result = await pool.query<SessionWithUserRow>(
    `SELECT ${SESSION_SELECT_COLUMNS},
            u.id, u.email, u.password_hash, u.role, u.status, u.created_at, u.updated_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > $2
       AND u.status = 'active'`,
    [tokenHash, now],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { session: mapSessionRow(row), user: mapUserRow(row) };
}

export async function revokeSession(pool: Pool, tokenHash: string, now: Date): Promise<void> {
  await pool.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL", [tokenHash, now]);
}

export async function revokeUserSessions(pool: Pool, userId: string, now: Date): Promise<number> {
  const result = await pool.query(
    "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
    [userId, now],
  );
  return result.rowCount ?? 0;
}
