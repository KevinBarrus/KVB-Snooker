/**
 * 联机开发原型验收公共工具：服务器进程、浏览器页面、快照比较与一杆记录。
 * 供 scripts/net-smoke.mjs 使用；不是游戏源码，不参与 Vite 构建。
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SERVER_MAIN = `${ROOT}.cache/net-server/server/main.js`;
const VITE_URL = process.env.RENDER_URL ?? "http://127.0.0.1:5173";
const CHROME_BIN = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const DEV_TOKEN = "dev-local";
const LEAD_MS = 700;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function buildServer() {
  execFileSync("npx", ["tsc", "-p", "tsconfig.server.json"], { cwd: ROOT, stdio: "inherit" });
}

function startServer(extraArgs = [], leadMs = LEAD_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SERVER_MAIN, "--host", "127.0.0.1", "--port", "0",
      "--dev-token", DEV_TOKEN, "--first-opening-player", "0", "--prepare-lead-ms", String(leadMs), ...extraArgs], { cwd: ROOT });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; proc.kill("SIGKILL"); reject(new Error("服务器启动超时")); }
    }, 20000);
    const onData = chunk => {
      stdout += String(chunk);
      if (settled) return;
      const line = stdout.split("\n").find(entry => entry.startsWith("NET_SERVER_READY "));
      if (!line) return;
      settled = true;
      clearTimeout(timer);
      try {
        const info = JSON.parse(line.slice("NET_SERVER_READY ".length));
        resolve({ proc, info, stdout: () => stdout });
      } catch (error) { reject(error); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", chunk => { stdout += String(chunk); });
    proc.on("exit", code => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`服务器提前退出：${code}\n${stdout}`)); } });
  });
}

async function stopServer(server) {
  if (!server) return;
  server.proc.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.proc.once("exit", resolve)), sleep(3000)]);
}

function netUrl(info, roomId, seat) {
  return `${VITE_URL}/?net=${encodeURIComponent(roomId)}&token=${DEV_TOKEN}` +
    `&server=${encodeURIComponent(`ws://127.0.0.1:${info.port}/net`)}&seat=${seat}`;
}

async function openClient(browser, info, roomId, seat, label) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on("pageerror", error => console.error(`[${label}] pageerror: ${error.message}`));
  await page.goto(netUrl(info, roomId, seat));
  await page.waitForFunction(() => document.body.dataset.state === "ready" && Boolean(window.__snkNet), undefined, { timeout: 30000 });
  await page.evaluate(() => window.__snkNet.ready);
  await historyDeadline(page, () => { const net = window.__snkNet; return net !== undefined && net.snapshot() !== null && net.snapshot().seat !== null; }, 20000, `${label} 等待快照`);
  await historyDeadline(page, () => window.__snkNet !== undefined && window.__snkNet.connectionState === "ready", 10000, `${label} 连接就绪`);
  return page;
}

function readNet(page) {
  return page.evaluate(() => {
    const net = window.__snkNet;
    return {
      snapshot: net.snapshot(), timing: net.timing(), latency: net.latency,
      connectionState: net.connectionState, seat: net.seat, lastError: net.lastError,
      cameraState: net.cameraState, cameraPosition: net.cameraPosition, cameraTarget: net.cameraTarget,
      shotsBusy: net.shotsBusy, turn: net.turn, readyToStroke: net.readyToStroke,
      lastRejectReason: net.lastRejectReason
    };
  });
}

/** 轮询直到浏览器内条件成立；条件在页面内执行，参数为 window.__snkNet。 */
async function historyDeadline(page, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(predicate)) return;
    await sleep(40);
  }
  throw new Error(`等待超时：${label}`);
}

async function closePages(pages) {
  await Promise.all(pages.map(page => page.close().catch(() => {})));
}

async function waitFor(page, predicate, timeoutMs, label) {
  return historyDeadline(page, predicate, timeoutMs, label);
}

async function aimClient(page) {
  // 回合就绪（出杆收尾 + 显示追上权威快照）前输入会被忽略，先等就绪再按 W。
  await waitFor(page, () => {
    const net = window.__snkNet;
    return net !== undefined && net.turnReady && net.turn;
  }, 20000, "回合就绪");
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  await waitFor(page, () => {
    const net = window.__snkNet;
    return net !== undefined && net.cameraState === 1 && net.turn && net.readyToStroke;
  }, 20000, "进入瞄准并准备出杆");
}

async function shoot(page) {
  await page.locator("canvas").focus();
  await page.keyboard.press("Space");
}

/** 记录一杆从 Space 到结算期间各端收到的快照（按 version）；shooterIndex 指明发起击球的页面。 */
async function recordShot(pages, shooterIndex, timeoutMs = 30000) {
  const samples = pages.map(() => new Map());
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const states = await Promise.all(pages.map(readNet));
    states.forEach((state, index) => {
      const snapshot = state.snapshot;
      if (snapshot !== null && !samples[index].has(snapshot.version)) {
        samples[index].set(snapshot.version, { phase: snapshot.phase, context: snapshot.context, balls: snapshot.balls });
      }
    });
    const shooter = states[shooterIndex];
    const stable = shooter.snapshot?.phase === "ready" || shooter.snapshot?.phase === "deciding" || shooter.snapshot?.phase === "finished";
    if (!shooter.shotsBusy && stable && shooter.timing.shotId !== null && shooter.timing.firstMotionSnapshotAtMs !== null) {
      return { samples, states };
    }
    await sleep(40);
  }
  const states = await Promise.all(pages.map(readNet));
  throw new Error(`等待一杆完成超时：${JSON.stringify(states.map(state => ({
    phase: state.snapshot?.phase, version: state.snapshot?.version, seat: state.seat,
    shotsBusy: state.shotsBusy, turn: state.turn, readyToStroke: state.readyToStroke,
    timing: state.timing, lastError: state.lastError, lastRejectReason: state.lastRejectReason
  })))}`);
}

/** 经典犯规后的最简 decide-turn：由拥有选择权的页面点击“自己接手”，让对局继续到 ready。 */
async function resolveDecision(pages, timeoutMs = 10000) {
  const states = await Promise.all(pages.map(readNet));
  const deciding = states.find(state => state.snapshot?.phase === "deciding");
  if (!deciding) return false;
  const owner = deciding.snapshot.context.playerIndex;
  const page = pages[states.findIndex(state => state.seat === owner)];
  assert.ok(page, `找不到拥有选择权的席位页面（owner=${owner}）`);
  await page.getByRole("button", { name: "自己接手", exact: true }).click();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const after = await readNet(page);
    if (after.snapshot?.phase !== "deciding") return true;
    await sleep(40);
  }
  throw new Error("decide-turn 后未回到 ready");
}

function assertSnapshotsEqual(a, b, label) {
  assert.equal(a.version, b.version, `${label}: 版本应一致`);
  assert.equal(a.phase, b.phase, `${label}: 阶段应一致`);
  assert.deepEqual(a.context, b.context, `${label}: 球权/比分/目标球应一致`);
  assert.equal(a.balls.length, b.balls.length, `${label}: 球数应一致`);
  a.balls.forEach((ball, index) => {
    const other = b.balls[index];
    assert.equal(ball.index, other.index, `${label}: 球索引应一致`);
    assert.equal(ball.number, other.number, `${label}: 球号应一致`);
    assert.equal(ball.active, other.active, `${label}: 球 ${ball.index} 活跃状态应一致`);
    for (const axis of ["x", "y", "z"]) {
      assert.ok(Math.abs(ball[axis] - other[axis]) < 1e-9,
        `${label}: 球 ${ball.index} ${axis} 不一致 ${ball[axis]} vs ${other[axis]}`);
    }
  });
}


export {
  ROOT,
  SERVER_MAIN,
  VITE_URL,
  CHROME_BIN,
  DEV_TOKEN,
  LEAD_MS,
  sleep,
  buildServer,
  startServer,
  stopServer,
  netUrl,
  openClient,
  readNet,
  historyDeadline,
  waitFor,
  closePages,
  aimClient,
  shoot,
  recordShot,
  resolveDecision,
  assertSnapshotsEqual
};
