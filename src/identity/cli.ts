import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { loadConfig, type IdentityConfig } from "./config.js";
import { closeDatabasePool, createDatabasePool } from "./db.js";
import { normalizeEmail } from "./email.js";
import {
  createUserAccount,
  listUserAccounts,
  resetUserPassword,
  setUserEnabled,
} from "./identity-service.js";
import { runMigrations } from "./migrations.js";
import { createSecretReader, type SecretInput, type SecretOutput, type SecretReader } from "./secret.js";
import { isUserRole, type UserRole } from "./types.js";
import { findUserByEmail } from "./users.js";

export interface CliEnvironment {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly input: SecretInput;
  readonly output: SecretOutput;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface ParsedCommand {
  readonly command: string;
  readonly email: string | null;
  readonly role: UserRole;
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

const COMMANDS = [
  "migrate",
  "create-user",
  "reset-password",
  "disable-user",
  "enable-user",
  "list-users",
] as const;

const EMAIL_COMMANDS = new Set(["create-user", "reset-password", "disable-user", "enable-user"]);
const USAGE = [
  "用法: cli.js <command> [--email <email>] [--role player|admin]",
  "命令: migrate | create-user | reset-password | disable-user | enable-user | list-users",
].join("\n");

export function parseCommand(argv: readonly string[]): ParsedCommand {
  const command = argv[0];
  if (command === undefined || command.trim() === "") throw new CliError(`缺少命令\n${USAGE}`);
  if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) throw new CliError(`未知命令：${command}\n${USAGE}`);
  let values: { email?: string; role?: string };
  try {
    const parsed = parseArgs({
      args: [...argv.slice(1)],
      options: { email: { type: "string" }, role: { type: "string" } },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values;
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : "参数解析失败");
  }
  const email = values.email ?? null;
  const roleValue = values.role;
  const role: UserRole = roleValue === undefined ? "player" : isUserRole(roleValue) ? roleValue : "player";
  if (roleValue !== undefined && !isUserRole(roleValue)) throw new CliError("--role 只能是 player 或 admin");
  if (roleValue !== undefined && command !== "create-user") throw new CliError("--role 仅用于 create-user");
  if (EMAIL_COMMANDS.has(command) && email === null) throw new CliError(`${command} 需要 --email`);
  if (!EMAIL_COMMANDS.has(command) && email !== null) throw new CliError(`${command} 不接受 --email`);
  return { command, email, role };
}

function normalizeCliEmail(email: string | null): string {
  if (email === null) throw new CliError("缺少 --email");
  const normalized = normalizeEmail(email);
  if (normalized === null) throw new CliError("邮箱格式无效");
  return normalized;
}

async function runMigrate(pool: Pool, config: IdentityConfig, environment: CliEnvironment): Promise<number> {
  const report = await runMigrations(pool, config.migrationsDir);
  for (const file of report.applied) environment.stdout(`applied ${file}`);
  environment.stdout(`migrations applied: ${report.applied.length}, skipped: ${report.skipped.length}`);
  return 0;
}

async function runCreateUser(
  pool: Pool,
  environment: CliEnvironment,
  readPassword: (prompt: string) => Promise<string>,
  email: string | null,
  role: UserRole,
): Promise<number> {
  const normalized = normalizeCliEmail(email);
  const existing = await findUserByEmail(pool, normalized);
  if (existing !== null) {
    environment.stdout(`user already exists: ${existing.id}`);
    return 0;
  }
  const password = await readPassword("Password: ");
  if (password.length === 0) {
    environment.stderr("error: 密码不能为空");
    return 1;
  }
  const outcome = await createUserAccount(pool, { email: normalized, password, role });
  if (!outcome.ok) {
    environment.stderr(`error: 无法创建账号（${outcome.error}）`);
    return 1;
  }
  environment.stdout(
    outcome.created ? `created user: ${outcome.user.id}` : `user already exists: ${outcome.user.id}`,
  );
  return 0;
}

async function runResetPassword(
  pool: Pool,
  environment: CliEnvironment,
  readPassword: (prompt: string) => Promise<string>,
  email: string | null,
): Promise<number> {
  const normalized = normalizeCliEmail(email);
  const user = await findUserByEmail(pool, normalized);
  if (user === null) {
    environment.stderr("error: 用户不存在");
    return 1;
  }
  const first = await readPassword("New password: ");
  const second = await readPassword("Repeat password: ");
  if (first.length === 0) {
    environment.stderr("error: 密码不能为空");
    return 1;
  }
  if (first !== second) {
    environment.stderr("error: 两次输入的密码不一致");
    return 1;
  }
  await resetUserPassword(pool, normalized, first, new Date());
  environment.stdout(`password updated: ${user.id}; sessions revoked`);
  return 0;
}

async function runSetEnabled(
  pool: Pool,
  environment: CliEnvironment,
  email: string | null,
  enabled: boolean,
): Promise<number> {
  const normalized = normalizeCliEmail(email);
  const user = await setUserEnabled(pool, normalized, enabled, new Date());
  if (user === null) {
    environment.stderr("error: 用户不存在");
    return 1;
  }
  environment.stdout(`${enabled ? "enabled" : "disabled"} user: ${user.id}${enabled ? "" : "; sessions revoked"}`);
  return 0;
}

async function runListUsers(pool: Pool, environment: CliEnvironment): Promise<number> {
  const users = await listUserAccounts(pool);
  for (const user of users) {
    environment.stdout(
      `${user.id}\t${user.email}\t${user.role}\t${user.status}\t${user.createdAt.toISOString()}`,
    );
  }
  return 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCli(argv: readonly string[], environment: CliEnvironment): Promise<number> {
  let pool: Pool | null = null;
  const secret = { reader: null as SecretReader | null };
  const readPassword = (prompt: string): Promise<string> => {
    secret.reader ??= createSecretReader({ input: environment.input, output: environment.output });
    return secret.reader.read(prompt);
  };
  try {
    const command = parseCommand(argv);
    const config = loadConfig(environment.env, environment.cwd);
    pool = createDatabasePool(config);
    switch (command.command) {
      case "migrate":
        return await runMigrate(pool, config, environment);
      case "create-user":
        return await runCreateUser(pool, environment, readPassword, command.email, command.role);
      case "reset-password":
        return await runResetPassword(pool, environment, readPassword, command.email);
      case "disable-user":
        return await runSetEnabled(pool, environment, command.email, false);
      case "enable-user":
        return await runSetEnabled(pool, environment, command.email, true);
      case "list-users":
        return await runListUsers(pool, environment);
      default:
        throw new CliError(`未知命令：${command.command}`);
    }
  } catch (error) {
    environment.stderr(`error: ${describeError(error)}`);
    return 1;
  } finally {
    secret.reader?.close();
    if (pool !== null) await closeDatabasePool(pool);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const environment: CliEnvironment = {
    env: process.env,
    cwd: process.cwd(),
    input: process.stdin,
    output: process.stdout,
    stdout: (line: string) => process.stdout.write(`${line}\n`),
    stderr: (line: string) => process.stderr.write(`${line}\n`),
  };
  void runCli(process.argv.slice(2), environment).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
