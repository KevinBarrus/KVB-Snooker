import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { withTransaction } from "./db.js";

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

const MIGRATION_FILE_SUFFIX = ".sql";

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(CREATE_MIGRATIONS_TABLE);
}

async function readAppliedVersions(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => row.version));
}

async function listMigrationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(MIGRATION_FILE_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

/**
 * 按文件名排序应用未执行迁移；每个迁移与其 schema_migrations 记录在同一事务内提交。
 * 重复运行跳过已应用版本，因此可安全用于部署前步骤。
 */
export async function runMigrations(pool: Pool, directory: string): Promise<MigrationReport> {
  await ensureMigrationsTable(pool);
  const appliedVersions = await readAppliedVersions(pool);
  const files = await listMigrationFiles(directory);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (appliedVersions.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(`${directory}/${file}`, "utf8");
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [file]);
    });
    appliedVersions.add(file);
    applied.push(file);
  }
  return { applied, skipped };
}
