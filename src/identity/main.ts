import { loadConfig } from "./config.js";
import { createDatabasePool } from "./db.js";
import { createIdentityHttpServer } from "./http.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function log(message: string): void {
  process.stdout.write(`[identity] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.cwd());
  const pool = createDatabasePool(config);
  const server = createIdentityHttpServer({ pool, config });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  log(`listening on http://${config.host}:${config.port}`);
  if (config.staticDir === null) log("STATIC_DIR 未设置：只提供 /api");
  if (config.internalToken !== null) log("内部会话校验端点已启用（/api/internal/session/verify）");

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}: shutting down`);
    const timer = setTimeout(() => {
      log("shutdown timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close(() => {
      pool.end().catch(() => undefined).finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[identity] 启动失败：${message}\n`);
  process.exitCode = 1;
});
