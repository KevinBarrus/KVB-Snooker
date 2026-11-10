import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseCommand, runCli, type CliEnvironment } from "../../src/identity/cli";

function cliEnvironment(env: NodeJS.ProcessEnv = {}): { environment: CliEnvironment; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    environment: {
      env,
      cwd: "/srv/kvb-snooker",
      input: Readable.from([]),
      output: { isTTY: false, write: (): boolean => true },
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("管理 CLI 参数与退出码", () => {
  it("解析命令、邮箱与角色，角色默认 player", () => {
    expect(parseCommand(["create-user", "--email", "Admin@Example.Test", "--role", "admin"])).toEqual({
      command: "create-user",
      email: "Admin@Example.Test",
      role: "admin",
    });
    expect(parseCommand(["create-user", "--email", "player@example.test"]).role).toBe("player");
    expect(parseCommand(["migrate"]).email).toBeNull();
    expect(parseCommand(["list-users"]).command).toBe("list-users");
  });

  it("拒绝未知命令、缺失邮箱、非法角色、错位选项与额外位置参数", () => {
    expect(() => parseCommand([])).toThrow(/缺少命令/);
    expect(() => parseCommand(["drop-database"])).toThrow(/未知命令/);
    expect(() => parseCommand(["create-user"])).toThrow(/需要 --email/);
    expect(() => parseCommand(["reset-password", "--email", "a@b.test", "--role", "admin"])).toThrow(/仅用于 create-user/);
    expect(() => parseCommand(["create-user", "--email", "a@b.test", "--role", "guest"])).toThrow(/player 或 admin/);
    expect(() => parseCommand(["migrate", "--email", "a@b.test"])).toThrow(/不接受 --email/);
    expect(() => parseCommand(["create-user", "--email", "a@b.test", "extra"])).toThrow();
    expect(() => parseCommand(["create-user", "--unknown", "x"])).toThrow();
  });

  it("缺少数据库配置或未知命令时返回非零退出码且错误走 stderr", async () => {
    const missingDatabase = cliEnvironment({});
    await expect(runCli(["list-users"], missingDatabase.environment)).resolves.toBe(1);
    expect(missingDatabase.stderr.join("\n")).toMatch(/必须设置 DATABASE_URL 或 PGDATABASE/);
    expect(missingDatabase.stdout).toEqual([]);

    const unknownCommand = cliEnvironment({ DATABASE_URL: "postgres://user:secret@127.0.0.1:1/unused" });
    await expect(runCli(["drop-database"], unknownCommand.environment)).resolves.toBe(1);
    expect(unknownCommand.stderr.join("\n")).toMatch(/未知命令/);
  });
});
