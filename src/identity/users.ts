import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { IdentityUser, UserRole, UserStatus } from "./types.js";

export interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

const USER_COLUMNS = "id, email, password_hash, role, status, created_at, updated_at";

export function mapUserRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** 内测阶段显示名取邮箱本地部分；稳定用户身份仍只认 id。 */
export function displayNameForEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local.slice(0, 32) : "玩家";
}

export function toIdentityUser(user: StoredUser): IdentityUser {
  return {
    id: user.id,
    email: user.email,
    displayName: displayNameForEmail(user.email),
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function findUserByEmail(pool: Pool, email: string): Promise<StoredUser | null> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  const row = result.rows[0];
  return row === undefined ? null : mapUserRow(row);
}

export async function listUserAccounts(pool: Pool): Promise<readonly StoredUser[]> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC, email ASC`);
  return result.rows.map(mapUserRow);
}

/**
 * 幂等创建：邮箱已存在时返回已有用户且不修改密码。
 * 并发插入由邮箱唯一约束兜底，冲突后回读已有行。
 */
export async function insertUserIfAbsent(
  pool: Pool,
  input: { readonly email: string; readonly passwordHash: string; readonly role: UserRole },
): Promise<{ readonly user: StoredUser; readonly created: boolean }> {
  const id = randomUUID();
  const inserted = await pool.query<UserRow>(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${USER_COLUMNS}`,
    [id, input.email, input.passwordHash, input.role],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow !== undefined) return { user: mapUserRow(insertedRow), created: true };
  const existing = await findUserByEmail(pool, input.email);
  if (existing === null) throw new Error("用户创建冲突后未能回读到已有账号");
  return { user: existing, created: false };
}
