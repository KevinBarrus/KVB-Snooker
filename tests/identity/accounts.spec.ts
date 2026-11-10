import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../src/identity/migrations";
import {
  authenticateSession,
  createUserAccount,
  listUserAccounts,
  login,
  logout,
  resetUserPassword,
  setUserEnabled,
} from "../../src/identity/identity-service";
import { verifyPassword } from "../../src/identity/password";
import { createLoginRateLimiter } from "../../src/identity/rate-limit";
import { findUserByEmail } from "../../src/identity/users";
import {
  createTestAccount,
  createTestDatabase,
  databaseConfigured,
  MIGRATIONS_DIRECTORY,
  TEST_DATABASE_URL,
  truncateIdentityTables,
  type TestDatabase,
} from "./test-support";

const describeDatabase = databaseConfigured ? describe : describe.skip;

function loginDependencies(pool: Pool, sessionTtlSeconds = 3600) {
  return {
    pool,
    limiter: createLoginRateLimiter({ maxAttempts: 10, windowMs: 900_000 }),
    sessionTtlSeconds,
  };
}

describeDatabase("身份数据库与账号（真实 PostgreSQL）", () => {
  let database: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = database.pool;
    await runMigrations(pool, MIGRATIONS_DIRECTORY);
  });

  afterAll(async () => {
    await database.dispose();
  });

  beforeEach(async () => {
    await truncateIdentityTables(pool);
  });

  it("迁移可重复执行且不重复记录版本", async () => {
    const first = await runMigrations(pool, MIGRATIONS_DIRECTORY);
    const second = await runMigrations(pool, MIGRATIONS_DIRECTORY);
    expect(first.applied).toEqual([]);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("001_identity.sql");
    const versions = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
    const names = versions.rows.map((row) => row.version);
    expect(names).toContain("001_identity.sql");
    expect(new Set(names).size).toBe(names.length);
  });

  it("两个账号得到不同稳定 UUID，重复 create 不改 ID 也不覆盖密码", async () => {
    const player = await createTestAccount(pool, "player@example.test", "PlayerPass-1");
    const admin = await createTestAccount(pool, "admin@example.test", "AdminPass-2", "admin");
    expect(player.id).not.toBe(admin.id);
    expect(admin.role).toBe("admin");
    const storedBefore = await findUserByEmail(pool, "player@example.test");
    expect(storedBefore).not.toBeNull();
    const hashBefore = storedBefore?.passwordHash ?? "";

    const duplicate = await createUserAccount(pool, {
      email: "PLAYER@example.test",
      password: "DifferentPass-3",
      role: "admin",
    });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.created).toBe(false);
    expect(duplicate.user.id).toBe(player.id);
    expect(duplicate.user.role).toBe("player");

    const storedAfter = await findUserByEmail(pool, "player@example.test");
    expect(storedAfter?.id).toBe(player.id);
    expect(storedAfter?.passwordHash).toBe(hashBefore);
    await expect(verifyPassword("PlayerPass-1", storedAfter?.passwordHash ?? "")).resolves.toBe(true);
    await expect(verifyPassword("DifferentPass-3", storedAfter?.passwordHash ?? "")).resolves.toBe(false);

    const listed = await listUserAccounts(pool);
    expect(listed.map((user) => user.id).sort()).toEqual([player.id, admin.id].sort());
  });

  it("重建连接池（模拟服务重启）后账号仍在且 ID 不变", async () => {
    const created = await createTestAccount(pool, "restart@example.test", "RestartPass-1");
    const restarted = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 1,
      options: `-c search_path=${database.schema}`,
    });
    try {
      const found = await findUserByEmail(restarted, "restart@example.test");
      expect(found?.id).toBe(created.id);
      expect(found?.passwordHash).toBe(created.passwordHash);
    } finally {
      await restarted.end();
    }
  });

  it("正确密码登录创建会话；错误密码与不存在邮箱都返回 invalid_credentials", async () => {
    await createTestAccount(pool, "auth@example.test", "AuthPass-1");
    const dependencies = loginDependencies(pool);
    const now = new Date();
    const ok = await login(dependencies, {
      email: "auth@example.test",
      password: "AuthPass-1",
      clientIp: "127.0.0.1",
      now,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.view.user.email).toBe("auth@example.test");
    expect(new Date(ok.view.expiresAt).getTime()).toBeGreaterThan(now.getTime());
    await expect(authenticateSession(pool, ok.token, now)).resolves.not.toBeNull();

    const wrongPassword = await login(dependencies, {
      email: "auth@example.test",
      password: "WrongPass-2",
      clientIp: "127.0.0.1",
      now,
    });
    expect(wrongPassword).toMatchObject({ ok: false, error: "invalid_credentials" });
    const unknownEmail = await login(dependencies, {
      email: "missing@example.test",
      password: "AuthPass-1",
      clientIp: "127.0.0.1",
      now,
    });
    expect(unknownEmail).toMatchObject({ ok: false, error: "invalid_credentials" });
  });

  it("退出登录撤销当前会话，旧 token 立即无效", async () => {
    await createTestAccount(pool, "logout@example.test", "LogoutPass-1");
    const dependencies = loginDependencies(pool);
    const now = new Date();
    const session = await login(dependencies, {
      email: "logout@example.test",
      password: "LogoutPass-1",
      clientIp: "127.0.0.1",
      now,
    });
    if (!session.ok) throw new Error("测试登录失败");
    await logout(pool, session.token, now);
    await expect(authenticateSession(pool, session.token, now)).resolves.toBeNull();
  });

  it("重置密码撤销全部旧会话、旧密码失效、新密码可用", async () => {
    await createTestAccount(pool, "reset@example.test", "OldPass-123");
    const dependencies = loginDependencies(pool);
    const now = new Date();
    const first = await login(dependencies, {
      email: "reset@example.test",
      password: "OldPass-123",
      clientIp: "127.0.0.1",
      now,
    });
    if (!first.ok) throw new Error("测试登录失败");
    await expect(authenticateSession(pool, first.token, now)).resolves.not.toBeNull();
    const reset = await resetUserPassword(pool, "reset@example.test", "NewPass-456", now);
    expect(reset).not.toBeNull();
    await expect(authenticateSession(pool, first.token, now)).resolves.toBeNull();
    const oldPassword = await login(dependencies, {
      email: "reset@example.test",
      password: "OldPass-123",
      clientIp: "127.0.0.1",
      now,
    });
    expect(oldPassword.ok).toBe(false);
    const newPassword = await login(dependencies, {
      email: "reset@example.test",
      password: "NewPass-456",
      clientIp: "127.0.0.1",
      now,
    });
    expect(newPassword.ok).toBe(true);
  });

  it("停用撤销旧会话且不能登录，重新启用可以登录但不恢复旧会话", async () => {
    const created = await createTestAccount(pool, "toggle@example.test", "TogglePass-1");
    const dependencies = loginDependencies(pool);
    const now = new Date();
    const first = await login(dependencies, {
      email: "toggle@example.test",
      password: "TogglePass-1",
      clientIp: "127.0.0.1",
      now,
    });
    if (!first.ok) throw new Error("测试登录失败");
    const disabled = await setUserEnabled(pool, "toggle@example.test", false, now);
    expect(disabled?.status).toBe("disabled");
    expect(disabled?.id).toBe(created.id);
    await expect(authenticateSession(pool, first.token, now)).resolves.toBeNull();
    const blockedLogin = await login(dependencies, {
      email: "toggle@example.test",
      password: "TogglePass-1",
      clientIp: "127.0.0.1",
      now,
    });
    expect(blockedLogin).toMatchObject({ ok: false, error: "invalid_credentials" });

    const enabled = await setUserEnabled(pool, "toggle@example.test", true, now);
    expect(enabled?.status).toBe("active");
    await expect(authenticateSession(pool, first.token, now)).resolves.toBeNull();
    const recovered = await login(dependencies, {
      email: "toggle@example.test",
      password: "TogglePass-1",
      clientIp: "127.0.0.1",
      now,
    });
    expect(recovered.ok).toBe(true);
  });

  it("过期会话视为未登录", async () => {
    await createTestAccount(pool, "expiry@example.test", "ExpiryPass-1");
    const dependencies = loginDependencies(pool, 60);
    const issuedAt = new Date();
    const session = await login(dependencies, {
      email: "expiry@example.test",
      password: "ExpiryPass-1",
      clientIp: "127.0.0.1",
      now: issuedAt,
    });
    if (!session.ok) throw new Error("测试登录失败");
    const beforeExpiry = new Date(issuedAt.getTime() + 30_000);
    const afterExpiry = new Date(issuedAt.getTime() + 61_000);
    await expect(authenticateSession(pool, session.token, beforeExpiry)).resolves.not.toBeNull();
    await expect(authenticateSession(pool, session.token, afterExpiry)).resolves.toBeNull();
  });
});
