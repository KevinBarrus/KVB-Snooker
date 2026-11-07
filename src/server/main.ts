import { networkInterfaces } from "node:os";
import { parseArgs } from "node:util";
import { DEFAULT_DEV_TOKEN, DEFAULT_NET_PORT, NET_PROTOCOL_VERSION } from "../net/protocol.js";
import { PHYSICS_TABLE_PATH, TABLE_MESH_ID, createTableMesh, loadPhysicsTable } from "./table.js";
import { startDevServer, type DevServer } from "./transport.js";

interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly devToken: string;
  readonly prepareLeadMs: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly tablePath: string;
  readonly latencyInMs: number;
  readonly latencyOutMs: number;
  readonly latencyJitterMs: number;
  readonly dropNextAck: boolean;
}

function numberArg(value: string | boolean | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name} 需要一个数字`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} 不是有限数字：${value}`);
  return parsed;
}

function readConfig(argv: readonly string[]): ServerConfig {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: String(DEFAULT_NET_PORT) },
      "dev-token": { type: "string", default: DEFAULT_DEV_TOKEN },
      "latency-in-ms": { type: "string", default: "0" },
      "latency-out-ms": { type: "string", default: "0" },
      "latency-jitter-ms": { type: "string", default: "0" },
      "drop-next-ack": { type: "boolean", default: false },
      "prepare-lead-ms": { type: "string", default: "700" },
      "tick-hz": { type: "string", default: "60" },
      "snapshot-hz": { type: "string", default: "20" },
      table: { type: "string", default: PHYSICS_TABLE_PATH }
    }
  });
  const host = String(values.host ?? "");
  const port = numberArg(values.port, "port", DEFAULT_NET_PORT);
  const latencyInMs = numberArg(values["latency-in-ms"], "latency-in-ms", 0);
  const latencyOutMs = numberArg(values["latency-out-ms"], "latency-out-ms", 0);
  const latencyJitterMs = numberArg(values["latency-jitter-ms"], "latency-jitter-ms", 0);
  const prepareLeadMs = numberArg(values["prepare-lead-ms"], "prepare-lead-ms", 700);
  const tickHz = numberArg(values["tick-hz"], "tick-hz", 60);
  const snapshotHz = numberArg(values["snapshot-hz"], "snapshot-hz", 20);
  const devToken = String(values["dev-token"] ?? "");
  const tablePath = String(values.table ?? PHYSICS_TABLE_PATH);
  if (host.length === 0) throw new Error("--host 不能为空");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port 必须是 0–65535 整数");
  for (const [name, value] of [["latency-in-ms", latencyInMs], ["latency-out-ms", latencyOutMs],
    ["latency-jitter-ms", latencyJitterMs]] as const) {
    if (value < 0 || value > 10000) throw new Error(`--${name} 必须在 0–10000ms 之间`);
  }
  if (prepareLeadMs < 0 || prepareLeadMs > 5000) throw new Error("--prepare-lead-ms 必须在 0–5000ms 之间");
  if (tickHz < 1 || tickHz > 240) throw new Error("--tick-hz 必须在 1–240 之间");
  if (snapshotHz < 1 || snapshotHz > 240) throw new Error("--snapshot-hz 必须在 1–240 之间");
  if (devToken.length === 0) throw new Error("--dev-token 不能为空");
  return {
    host, port, devToken, prepareLeadMs, tickHz, snapshotHz, tablePath,
    latencyInMs, latencyOutMs, latencyJitterMs,
    dropNextAck: values["drop-next-ack"] === true
  };
}

function lanAddresses(port: number): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (!info.internal && info.family === "IPv4") addresses.push(`ws://${info.address}:${port}`);
    }
  }
  return addresses;
}

function describeLatency(config: ServerConfig): string {
  if (config.latencyInMs === 0 && config.latencyOutMs === 0 && config.latencyJitterMs === 0) {
    return "关闭（0ms；配置值为单程，往返≈入站+出站+处理时间）";
  }
  const jitter = config.latencyJitterMs > 0 ? ` + 抖动 0–${config.latencyJitterMs}ms` : "";
  return `仅开发环境：入站 ${config.latencyInMs}ms${jitter}，出站 ${config.latencyOutMs}ms${jitter}；` +
    "配置值为单程，往返≈入站+出站+处理时间";
}

async function main(): Promise<void> {
  const config = readConfig(process.argv.slice(2));
  const table = await loadPhysicsTable(config.tablePath);
  console.log(`[net] 物理台面：${table.path}（sha256=${table.sha256}，mesh.id=${TABLE_MESH_ID}）`);
  console.log(`[net] 协议版本 ${NET_PROTOCOL_VERSION}；开发令牌：${config.devToken}`);
  console.log(`[net] 延迟注入：${describeLatency(config)}`);
  if (config.dropNextAck) {
    console.warn("[net] 警告：--drop-next-ack 已开启（仅开发故障注入）：将丢弃下一条 Ack，只丢弃一次。");
  }

  const server: DevServer = await startDevServer({
    host: config.host,
    port: config.port,
    devToken: config.devToken,
    latency: {
      inboundMs: config.latencyInMs,
      outboundMs: config.latencyOutMs,
      jitterMs: config.latencyJitterMs,
      dropNextAck: config.dropNextAck
    },
    room: {
      prepareLeadMs: config.prepareLeadMs,
      tickHz: config.tickHz,
      snapshotHz: config.snapshotHz,
      seed: 2026
    },
    meshFactory: () => createTableMesh(table.data)
  });

  const latencyPayload = {
    enabled: config.latencyInMs > 0 || config.latencyOutMs > 0 || config.latencyJitterMs > 0,
    inboundMs: config.latencyInMs,
    outboundMs: config.latencyOutMs,
    jitterMs: config.latencyJitterMs,
    appliesTo: "one-way-per-direction" as const
  };
  console.log(`NET_SERVER_READY ${JSON.stringify({
    host: server.host,
    port: server.port,
    rooms: server.roomIds(),
    prepareLeadMs: config.prepareLeadMs,
    latency: latencyPayload,
    tickHz: config.tickHz,
    snapshotHz: config.snapshotHz,
    protocolVersion: NET_PROTOCOL_VERSION
  })}`);
  console.log(`[net] 监听 ${server.url}（WebSocket；hello 携带 roomId/devToken）`);
  console.log("[net] Vite 开发服务器提示：客户端页面由 app-net 装配根连接本服务器，默认 127.0.0.1:5173。");
  if (config.host === "0.0.0.0" || config.host === "::") {
    const addresses = lanAddresses(server.port);
    console.log(`[net] 局域网地址：${addresses.length > 0 ? addresses.join("，") : "未发现非回环 IPv4 地址"}`);
    console.warn("[net] 警告：--host 0.0.0.0 仅供可信开发机之间的局域网测试；本原型无正式鉴权，禁止暴露到公网。");
  }

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`[net] 收到 ${signal}，正在关闭连接与定时器……`);
    server.close().then(() => {
      console.log("[net] 已关闭。");
      process.exit(0);
    }).catch((error: unknown) => {
      console.error("[net] 关闭失败：", error);
      process.exit(1);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[net] 启动失败：", error);
  process.exitCode = 1;
});
