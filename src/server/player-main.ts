import { createPlayerAccess } from "./player-identity.js";
import { loadPhysicsTable, createTableMesh } from "./table.js";
import { startDevServer } from "./transport.js";

async function main(): Promise<void> {
  const access = createPlayerAccess({ origin: process.env.PUBLIC_ORIGIN ?? "",
    identityUrl: process.env.IDENTITY_URL ?? "http://127.0.0.1:8788", internalToken: process.env.INTERNAL_TOKEN ?? "",
    cookieName: process.env.COOKIE_NAME });
  const table = await loadPhysicsTable();
  const server = await startDevServer({ access, host: process.env.NET_HOST ?? "127.0.0.1",
    port: Number(process.env.NET_PORT ?? 8787), devToken: "", latency: { inboundMs: 0, outboundMs: 0, jitterMs: 0, dropNextAck: false },
    room: { prepareLeadMs: 700, tickHz: 60, snapshotHz: 20, seed: 2026 },
    meshFactory: () => createTableMesh(table.data) });
  console.log(`[players] ${server.host}:${server.port}; authenticated classic multiplayer`);
  let closing = false;
  const stop = (): void => { if (closing) return; closing = true; void server.close().catch(() => { process.exitCode = 1; }); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Player server failed"); process.exitCode = 1; });
