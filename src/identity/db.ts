import { Pool, type PoolClient } from "pg";
import type { IdentityConfig } from "./config.js";

const APPLICATION_NAME = "kvb-snooker-identity";
const POOL_SIZE = 8;
const IDLE_TIMEOUT_MS = 30_000;

/** 连接配置只来自 DATABASE_URL 或 PG* 环境变量；不在此记录或输出。 */
export function createDatabasePool(config: IdentityConfig): Pool {
  const connection = config.databaseUrl === null
    ? {
        host: config.pg.host ?? undefined,
        port: config.pg.port ?? undefined,
        user: config.pg.user ?? undefined,
        password: config.pg.password ?? undefined,
        database: config.pg.database ?? undefined,
      }
    : { connectionString: config.databaseUrl };
  return new Pool({
    ...connection,
    application_name: APPLICATION_NAME,
    max: POOL_SIZE,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
  });
}

export async function isDatabaseAvailable(pool: Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabasePool(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // 关闭失败不覆盖调用方结果。
  }
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // 回滚失败保留原始错误。
    }
    throw error;
  } finally {
    client.release();
  }
}
