#!/usr/bin/env node
/**
 * 本地内测演练编排：PostgreSQL（Docker 或本机已有）+ 身份服务 + Vite。
 * 用法见 `node scripts/identity-local.mjs --help`。
 * 约束：不写死密码、不提交密钥；生成的 deploy/dev.env 已被 deploy/.gitignore 忽略。
 * 本脚本只启动本地进程，不执行 create-user（密码必须交互隐藏输入，见结束提示）。
 * 入口与 CLI 路径遵循 package.json 的身份脚本约定（.cache/identity/identity/{main,cli}.js）。
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEV_ENV_PATH = join(ROOT, "deploy/dev.env");
const IDENTITY_ENTRY = join(ROOT, ".cache/identity/identity/main.js");
const IDENTITY_CLI = join(ROOT, ".cache/identity/identity/cli.js");
const VITE_BIN = join(ROOT, "node_modules/.bin/vite");
const ROOT_VITE_CONFIG = join(ROOT, "vite.config.ts");
const COMPOSE_FILES = ["-f", "docker-compose.yml", "-f", "deploy/docker-compose.dev.yml"];

const usage = `本地内测演练编排
用法: node scripts/identity-local.mjs [选项]

  --db <docker|local>  PostgreSQL 来源；默认 docker（本机已装 Docker 时）
                       docker: 用 deploy/docker-compose.dev.yml 启动 postgres（127.0.0.1:55433）
                       local : 使用已运行的本机 PostgreSQL，读取 DATABASE_URL
  --no-build           跳过 npm run identity:build
  --no-migrate         跳过迁移（数据库已迁移时可用）
  --no-vite            只启动身份服务
  --serve-dist         身份服务直接服务 dist（STATIC_DIR=dist），不启动 Vite
  --port <端口>        身份服务端口，默认 8788
  --vite-port <端口>   Vite 端口，默认 5173
  --help               显示本说明

环境变量从当前进程与 deploy/dev.env（若存在）读取，进程环境优先。
不写死密码：--db docker 首次运行会生成含随机密码的 deploy/dev.env，且已被忽略。
`;

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  console.log(usage);
  process.exit(0);
}

const children = new Set();
let shuttingDown = false;

function parseOptions(argv) {
  const parsed = {
    db: undefined,
    build: true,
    migrate: true,
    vite: true,
    serveDist: false,
    port: 8788,
    vitePort: 5173,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--db") parsed.db = argv[++index];
    else if (arg === "--no-build") parsed.build = false;
    else if (arg === "--no-migrate") parsed.migrate = false;
    else if (arg === "--no-vite") parsed.vite = false;
    else if (arg === "--serve-dist") parsed.serveDist = true;
    else if (arg === "--port") parsed.port = Number(argv[++index]);
    else if (arg === "--vite-port") parsed.vitePort = Number(argv[++index]);
    else if (arg.startsWith("--db=")) parsed.db = arg.slice("--db=".length);
    else {
      console.error(`[identity-local] 未知参数: ${arg}\n`);
      console.log(usage);
      process.exit(2);
    }
  }
  if (parsed.db !== undefined && !["docker", "local"].includes(parsed.db)) {
    console.error(`[identity-local] --db 只能是 docker 或 local，收到 ${parsed.db}`);
    process.exit(2);
  }
  return parsed;
}

function parseEnvFile(path) {
  const result = new Map();
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.set(key, value);
  }
  return result;
}

function loadLocalEnv() {
  if (!existsSync(DEV_ENV_PATH)) return { fileEnv: {}, generated: false };
  return { fileEnv: Object.fromEntries(parseEnvFile(DEV_ENV_PATH)), generated: false };
}

function generateDevEnv() {
  const password = randomBytes(24).toString("base64url");
  const content = [
    "# 由 scripts/identity-local.mjs 生成；已被 deploy/.gitignore 忽略，不提交。",
    "# 仅用于本机 Docker 演练；不要复用生产密码。",
    "POSTGRES_USER=snk",
    `POSTGRES_PASSWORD=${password}`,
    "POSTGRES_DB=snk",
    `DATABASE_URL=postgres://snk:${password}@127.0.0.1:55433/snk`,
    "PUBLIC_ORIGIN=http://127.0.0.1:5173",
    "COOKIE_SECURE=0",
    "SESSION_TTL_SECONDS=604800",
    "TRUST_PROXY=0",
    "",
  ].join("\n");
  writeFileSync(DEV_ENV_PATH, content, { mode: 0o600 });
  console.log(`[identity-local] 已生成 ${relative(ROOT, DEV_ENV_PATH)}（随机密码，已被忽略，不提交）。`);
}

function dockerAvailable() {
  const result = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  return result.status === 0;
}

function runCompose(args, label) {
  const result = spawnSync("docker", ["compose", ...COMPOSE_FILES, ...args], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[identity-local] ${label} 失败（docker compose ${args.join(" ")}，退出码 ${result.status}）`);
    return false;
  }
  return true;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function databaseTarget(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return { host: url.hostname || "127.0.0.1", port: Number(url.port || 5432), label: `${url.protocol}//${url.host}` };
  } catch {
    return null;
  }
}

function waitForTcp(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise) => {
    const attempt = () => {
      const socket = createConnection({ host, port });
      socket.setTimeout(1500);
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        if (Date.now() > deadline) resolvePromise(false);
        else setTimeout(attempt, 500);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) resolvePromise(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function composePostgresHealth() {
  const result = spawnSync("docker", ["compose", ...COMPOSE_FILES, "ps", "--format", "json", "postgres"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed[0] ?? null : null;
  } catch {
    return null;
  }
}

async function waitForPostgresHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = composePostgresHealth();
    if (status && (status.Health === "healthy" || (!status.Health && status.State === "running"))) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForIdentityHealth(healthUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "无响应";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  return { status: 0, body: null, error: lastError };
}

function trackChild(child, name, onExit) {
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[identity-local] ${name} 已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => {
  console.log("\n[identity-local] 收到 Ctrl+C，停止本地进程…");
  shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));

function fail(message, hint) {
  console.error(`[identity-local] ${message}`);
  if (hint) console.error(hint);
  shutdown(1);
}

async function main() {
  const localEnv = loadLocalEnv();
  const fileEnv = localEnv.fileEnv;
  const mergedEnv = { ...fileEnv, ...process.env };
  const dbMode = options.db ?? "docker";

  if (dbMode === "docker") {
    if (!dockerAvailable()) {
      fail(
        "未找到可用的 docker compose。",
        "三选一：安装 Docker 后重试；或启动本机 PostgreSQL 并用 --db local；或按 deploy/README.md 的分步命令手动启动。",
      );
      return;
    }
    if (!existsSync(DEV_ENV_PATH)) {
      generateDevEnv();
      Object.assign(fileEnv, Object.fromEntries(parseEnvFile(DEV_ENV_PATH)));
      Object.assign(mergedEnv, { ...fileEnv, ...process.env });
    }
    console.log("[identity-local] 启动 PostgreSQL（Docker，127.0.0.1:55433）…");
    if (!runCompose(["up", "-d", "postgres"], "启动 PostgreSQL")) {
      fail("PostgreSQL 容器启动失败。", "检查 docker 权限与镜像拉取网络后重试，或查看 docker compose logs postgres。");
      return;
    }
    console.log("[identity-local] 等待 PostgreSQL 健康…");
    if (!(await waitForPostgresHealthy(60000))) {
      console.error("[identity-local] PostgreSQL 未在 60 秒内健康，最近日志：");
      spawnSync("docker", ["compose", ...COMPOSE_FILES, "logs", "--tail", "30", "postgres"], { cwd: ROOT, stdio: "inherit" });
      fail("PostgreSQL 未就绪。");
      return;
    }
  } else {
    if (!mergedEnv.DATABASE_URL) {
      fail(
        "--db local 未找到 DATABASE_URL。",
        "复制 deploy/dev.env.example 为 deploy/dev.env 并填写 DATABASE_URL，或 export DATABASE_URL=postgres://<user>@127.0.0.1:5432/<db>；脚本不会创建数据库账号或写入密码。",
      );
      return;
    }
    const target = databaseTarget(mergedEnv.DATABASE_URL);
    if (target === null) {
      fail(`DATABASE_URL 不是合法 URL（当前值无法解析，请检查 deploy/dev.env）。`);
      return;
    }
    console.log(`[identity-local] 使用本机 PostgreSQL：${target.label}`);
    if (!(await waitForTcp(target.host, target.port, 5000))) {
      fail(
        `连不上 ${target.host}:${target.port}。`,
        "请先启动本机 PostgreSQL，或用 --db docker 让 compose 启动一个；也可改用 postgres://… 的 DATABASE_URL。",
      );
      return;
    }
  }

  const databaseUrl = mergedEnv.DATABASE_URL;
  if (!databaseUrl) {
    fail("缺少 DATABASE_URL，无法启动身份服务。", "检查 deploy/dev.env 或当前环境变量。");
    return;
  }

  if (options.build) {
    console.log("[identity-local] 编译身份服务（npm run identity:build）…");
    const build = spawnSync("npm", ["run", "identity:build"], { cwd: ROOT, stdio: "inherit" });
    if (build.status !== 0) {
      fail("身份服务编译失败。", "先确认 src/identity/** 存在且 npx tsc -p tsconfig.identity.json 通过。");
      return;
    }
  }
  if (!existsSync(IDENTITY_ENTRY)) {
    fail(`缺少 ${relative(ROOT, IDENTITY_ENTRY)}。`, "运行 npm run identity:build 后再试，或去掉 --no-build。");
    return;
  }

  const identityEnv = {
    ...mergedEnv,
    DATABASE_URL: databaseUrl,
    HOST: mergedEnv.HOST ?? "127.0.0.1",
    PORT: String(options.port),
    PUBLIC_ORIGIN: mergedEnv.PUBLIC_ORIGIN ?? `http://127.0.0.1:${options.vitePort}`,
    COOKIE_SECURE: mergedEnv.COOKIE_SECURE ?? "0",
    TRUST_PROXY: mergedEnv.TRUST_PROXY ?? "0",
    ...(options.serveDist ? { STATIC_DIR: join(ROOT, "dist") } : {}),
  };

  if (options.migrate) {
    console.log("[identity-local] 应用数据库迁移（幂等）…");
    const migrate = spawnSync(process.execPath, [IDENTITY_CLI, "migrate"], {
      cwd: ROOT,
      stdio: "inherit",
      env: identityEnv,
    });
    if (migrate.status !== 0) {
      fail("数据库迁移失败。", `检查数据库连接与 db/migrations；DATABASE_URL 指向 ${databaseTarget(databaseUrl)?.label ?? "未知主机"}。`);
      return;
    }
  }

  console.log(`[identity-local] 启动身份服务（127.0.0.1:${options.port}）…`);
  trackChild(spawn(process.execPath, [IDENTITY_ENTRY], { cwd: ROOT, stdio: "inherit", env: identityEnv }), "身份服务");

  const healthUrl = `http://127.0.0.1:${options.port}/api/health`;
  const health = await waitForIdentityHealth(healthUrl, 20000);
  if (health.status !== 200) {
    fail(
      `身份服务健康检查未通过（HTTP ${health.status}，${health.error ?? JSON.stringify(health.body)}）。`,
      "确认 DATABASE_URL 正确、迁移已应用；失败时服务会打印具体原因。",
    );
    return;
  }
  console.log(`[identity-local] 健康检查通过：${JSON.stringify(health.body)}`);

  if (options.serveDist && !options.vite) {
    console.log(`\n本地演练已就绪（身份服务直接服务 dist，无需 Vite）：`);
    console.log(`  网页:     http://127.0.0.1:${options.port}/`);
    console.log(`  健康检查: ${healthUrl}`);
  } else if (options.vite) {
    if (!options.serveDist) {
      const identityOrigin = `http://127.0.0.1:${options.port}`;
      const useRootViteConfig = existsSync(ROOT_VITE_CONFIG);
      console.log(
        `[identity-local] 启动 Vite（127.0.0.1:${options.vitePort}，/api 反代到 ${options.port}，` +
          `${useRootViteConfig ? "使用仓库 vite.config.ts" : "使用 deploy/vite.local.config.mjs 回退"}）…`,
      );
      const viteEnv = {
        ...process.env,
        // 根 vite.config.ts 读 IDENTITY_PROXY；本地回退配置读 IDENTITY_ORIGIN，两者都设置以保持一致。
        IDENTITY_PROXY: identityOrigin,
        IDENTITY_ORIGIN: identityOrigin,
        VITE_DEV_PORT: String(options.vitePort),
      };
      const viteArgs = useRootViteConfig
        ? ["--host", "127.0.0.1", "--port", String(options.vitePort), "--strictPort"]
        : ["--config", "deploy/vite.local.config.mjs"];
      const viteCommand = existsSync(VITE_BIN) ? VITE_BIN : "npx";
      const viteArguments = existsSync(VITE_BIN) ? viteArgs : ["--no-install", "vite", ...viteArgs];
      trackChild(spawn(viteCommand, viteArguments, { cwd: ROOT, stdio: "inherit", env: viteEnv }), "Vite");
    }
    console.log(`\n本地演练已就绪：`);
    console.log(`  网页:      http://127.0.0.1:${options.vitePort}/`);
  } else {
    console.log(`\n本地演练已就绪（仅身份服务）：`);
  }
  console.log(`  身份服务:  http://127.0.0.1:${options.port}/`);
  console.log(`  健康检查:  ${healthUrl}`);
  console.log("\n创建内测账号（另开终端；密码交互隐藏输入，不进入命令行）：");
  console.log("  set -a; . deploy/dev.env; set +a");
  console.log("  npm run identity:create-user -- --email beta1@example.com --role player");
  console.log("\n停止：Ctrl+C");
}

await main();
