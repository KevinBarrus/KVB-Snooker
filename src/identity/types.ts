export type UserRole = "player" | "admin";
export type UserStatus = "active" | "disabled";

export function isUserRole(value: unknown): value is UserRole {
  return value === "player" || value === "admin";
}

export function isUserStatus(value: unknown): value is UserStatus {
  return value === "active" || value === "disabled";
}

/** 公开身份视图；字段集合由 docs/internal-beta-identity-design.md §3 固定。 */
export interface IdentityUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly createdAt: string;
}

/** 未来房间/语音/存档服务可见的身份快照；不含邮箱。 */
export interface VerifiedIdentity {
  readonly userId: string;
  readonly displayName: string;
  readonly role: UserRole;
}

export interface IdentitySessionView {
  readonly user: IdentityUser;
  readonly expiresAt: string;
}
