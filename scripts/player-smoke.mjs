import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { preview } from "vite";
import { chromium } from "playwright-core";
import { createIdentityHttpServer } from "../.cache/identity/identity/http.js";
import { loadConfig } from "../.cache/identity/identity/config.js";
import { runMigrations } from "../.cache/identity/identity/migrations.js";
import { createUserAccount } from "../.cache/identity/identity/identity-service.js";
import { startDevServer } from "../.cache/net-server/server/transport.js";
import { createPlayerAccess } from "../.cache/net-server/server/player-identity.js";
import { loadPhysicsTable, createTableMesh } from "../.cache/net-server/server/table.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required; tests create and remove an isolated schema only");
const origin = `http://127.0.0.1:${process.env.PLAYER_TEST_PORT ?? 18473}`;
const schema = `player_smoke_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: databaseUrl });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
let identity, game, web, browser;
let pages = [];
const webSockets = new Set();
const internalToken = randomBytes(32).toString("hex"), password = randomBytes(24).toString("hex");
const messages = [[], []], errors = [], disconnected = [false, false];
async function until(test, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
const latest = seat => messages[seat].findLast(m => m.type === "snapshot");
try {
  await runMigrations(pool, "db/migrations");
  for (const name of ["alpha", "beta"]) assert.equal((await createUserAccount(pool, { email: `${name}@players.test`, password, role: "player" })).ok, true);
  const config = loadConfig({ DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: origin, COOKIE_SECURE: "0", INTERNAL_TOKEN: internalToken }, process.cwd());
  identity = createIdentityHttpServer({ pool, config, logger: () => {} });
  await new Promise(resolve => identity.listen(0, "127.0.0.1", resolve));
  const identityUrl = `http://127.0.0.1:${identity.address().port}`;
  const table = await loadPhysicsTable();
  game = await startDevServer({ host: "127.0.0.1", port: 0, devToken: "",
    access: createPlayerAccess({ origin, identityUrl, internalToken }),
    latency: { inboundMs: 0, outboundMs: 0, jitterMs: 0, dropNextAck: false },
    room: { prepareLeadMs: 700, tickHz: 60, snapshotHz: 20, seed: 2026, firstOpeningPlayer: 0 }, meshFactory: () => createTableMesh(table.data) });
  const target = game.url.replace("ws:", "http:");
  web = await preview({ configFile: false, preview: { host: "127.0.0.1", port: Number(new URL(origin).port), strictPort: true,
    proxy: { "/api/rooms": { target, changeOrigin: false }, "/net": { target, changeOrigin: false, ws: true }, "/api": { target: identityUrl, changeOrigin: false } } } });
  web.httpServer.on("connection", socket => { webSockets.add(socket); socket.on("close", () => webSockets.delete(socket)); });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  pages = await Promise.all(contexts.map(c => c.newPage()));
  for (const [seat, page] of pages.entries()) {
    page.on("pageerror", error => errors.push(error.message));
    page.on("websocket", socket => {
      socket.on("close", () => { disconnected[seat] = true; });
      socket.on("framereceived", frame => {
        const message = JSON.parse(String(frame.payload)); messages[seat].push(message);
      });
    });
    await page.addInitScript(() => {
      window.__playedAudio = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) { window.__playedAudio++; return start.apply(this, args); };
    });
    await page.goto(`${origin}/?multiplayer`);
    await page.locator(".login-input").nth(0).fill(`${seat ? "beta" : "alpha"}@players.test`);
    await page.locator(".login-input").nth(1).fill(password);
    await page.locator(".login-submit").click();
    await page.getByRole("button", { name: "创建房间", exact: true }).waitFor();
  }
  console.log("PLAYER_SMOKE: authenticated two accounts");
  await pages[0].getByRole("button", { name: "创建房间", exact: true }).click();
  await pages[0].waitForURL(/room=/);
  const code = new URL(pages[0].url()).searchParams.get("room");
  assert.match(code, /^[A-Z2-9]{6}$/);
  await pages[1].getByRole("textbox", { name: "房间码" }).fill("ZZZZZZ");
  await pages[1].getByRole("button", { name: "加入房间", exact: true }).click();
  await pages[1].getByText("房间不存在", { exact: true }).waitFor();
  await pages[1].getByRole("textbox", { name: "房间码" }).fill(code);
  await pages[1].getByRole("button", { name: "加入房间", exact: true }).click();
  await Promise.all(pages.map(p => p.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 60000 })));
  assert.deepEqual(messages.map(ms => ms.find(m => m.type === "welcome").seat), [0, 1]);
  for (const page of pages) assert.equal(await page.evaluate(() => window.__snkNet === undefined), true, "production has no developer handle");
  const request = (page, path, body) => page.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/rooms${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  assert.equal((await request(pages[0], "", { ruleset: "classic", bestOf: 3 })).status, 409);
  await pages[0].getByRole("button", { name: "准备", exact: true }).click();
  await sleep(300); assert.equal(latest(0).version, 0);
  await pages[1].getByRole("button", { name: "准备", exact: true }).click();
  await until(() => messages.every(ms => ms.some(m => m.type === "lobby" && m.lobby.phase === "playing")), "both ready");
  await pages[0].waitForFunction(() => document.querySelector("output")?.textContent?.includes("本机回合"));
  await pages[0].locator("canvas").focus(); await pages[0].keyboard.press("w");
  await pages[0].locator(".power-bar").waitFor({ state: "visible" }); await sleep(1000);
  await pages[0].keyboard.press("Space");
  await until(() => messages.every(ms => ms.some(m => m.type === "event" && m.event.type === "shot-fired")), "actual shot");
  await until(() => messages.every(ms => ms.some(m => m.type === "event" && m.event.type === "shot-settled")), "settled", 45000);
  await sleep(500);
  assert.deepEqual(latest(0), latest(1));
  for (const page of pages) {
    assert.equal(await page.locator(".net-hud").isVisible(), false);
    assert.equal(await page.locator(".score-container").isVisible(), true);
    assert.ok(await page.evaluate(() => window.__playedAudio > 0), "authoritative impact produces audio in each client");
    assert.ok((await page.locator(".hud").textContent()).includes("ALPHA"));
  }
  console.log("PLAYER_SMOKE: shot, score and audio passed");
  const seat = latest(0).context.playerIndex;
  if (latest(0).phase === "deciding") await pages[seat].getByRole("button", { name: "自己接手", exact: true }).click();
  await until(() => latest(0).phase === "ready" && latest(1).phase === "ready", "choice resolved");
  await pages[0].getByRole("button", { name: "请求暂停", exact: true }).click();
  await pages[1].getByRole("button", { name: "同意暂停", exact: true }).click();
  await Promise.all(pages.map(p => p.getByRole("dialog", { name: "比赛已暂停" }).waitFor({ state: "visible" })));
  await Promise.all(pages.map(p => p.getByRole("button", { name: "准备继续", exact: true }).click()));
  await Promise.all(pages.map(p => p.getByRole("dialog", { name: "比赛已暂停" }).waitFor({ state: "hidden", timeout: 10000 })));
  for (let frame = 0; frame < 2; frame++) {
    console.log("PLAYER_SMOKE: concede frame", frame + 1, latest(1).phase, latest(1).pause.phase);
    await pages[1].bringToFront();
    await pages[1].getByRole("button", { name: "认输本局", exact: true }).click({ timeout: 10000 });
    await pages[1].getByRole("button", { name: "确认认输本局", exact: true }).click({ timeout: 10000 });
    await until(() => latest(0).match.frameWins[0] === frame + 1, "frame result");
    if (!frame) {
      await Promise.all(pages.map(p => p.getByRole("button", { name: "准备下一局", exact: true }).click()));
      await until(() => latest(0).match.frameNumber === 2 && latest(1).match.frameNumber === 2, "next frame");
      assert.equal(latest(0).match.openingPlayer, 1);
    }
  }
  assert.deepEqual(latest(0).match.frameWins, [2, 0]);
  for (const ms of messages) assert.equal(ms.filter(m => m.type === "event" && m.event.type === "match-ended").length, 1);
  assert.equal(await pages[1].evaluate(async () => (await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } })).status), 204);
  await until(() => disconnected[1], "logout revokes WebSocket", 10000);
  assert.equal((await request(pages[1], "/current")).status, 401);
  await pages[0].bringToFront();
  await pages[0].getByRole("button", { name: "离开房间", exact: true }).click();
  await pages[0].waitForURL(/multiplayer/);
  assert.equal((await request(pages[0], "/current")).body.room, null);
  assert.deepEqual(errors, []);
  await mkdir(".cache/player-smoke", { recursive: true });
  await writeFile(".cache/player-smoke/result.json", JSON.stringify({ code, shots: 1, frameWins: [2, 0], errors, production: true, realIdentity: true }, null, 2));
  console.log("PLAYER_SMOKE_OK: two real accounts, room/create/join/ready, shot/HUD/audio, pause, best-of-three and exit");
} catch (error) {
  console.error("PLAYER_SMOKE_FAILED", error);
  await mkdir(".cache/player-smoke", { recursive: true });
  for (const [seat, page] of pages.entries()) {
    await page.screenshot({ path: `.cache/player-smoke/failure-${seat}.png`, timeout: 5000 }).catch(() => {});
    await writeFile(`.cache/player-smoke/failure-${seat}.json`, JSON.stringify({ snapshot: latest(seat), messages: messages[seat].slice(-25), text: await page.locator("body").innerText().catch(() => "") }, null, 2));
  }
  throw error;
} finally {
  await browser?.close();
  for (const socket of webSockets) socket.destroy();
  await game?.close();
  if (web) await new Promise(resolve => { web.httpServer.close(resolve); web.httpServer.closeAllConnections(); });
  if (identity) await new Promise(resolve => { identity.close(resolve); identity.closeAllConnections(); });
  await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
}
