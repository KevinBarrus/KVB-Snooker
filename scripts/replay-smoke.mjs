import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => void browser.close(), 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => {
    window.replayTestRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    window.replayTestRuntime.engine.stopRenderLoop();
  });
  const advance = count => page.evaluate(count => {
    const { game, balls, scene } = window.replayTestRuntime;
    for (let i = 0; i < count; ++i) game.update(1 / 60);
    balls.sync(); scene.render();
    return { busy: game.shots.busy, available: game.replay.clip.available, rounds: game.session.context.nRounds,
      active: game.replay.active, paused: game.replay.clip.paused, time: game.replay.clip.playHead, duration: game.replay.clip.duration };
  }, count);
  const snapshot = () => page.evaluate(() => {
    const { game, simulator } = window.replayTestRuntime;
    return { physics: simulator.serialize(), context: { ...game.session.context }, players: game.session.players.map(p => ({
      pts: p.pts, penalty: p.penalty, brk: p.brk, shootingCount: p.shootingCount })),
      eye: game.human.camera.position.asArray(), target: game.human.camera.target.asArray(), ratio: game.human.camera.stateRatio };
  });
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.replay.open()), false);
  await page.locator("canvas").focus(); await page.keyboard.press("w"); await advance(120);
  const initial = await page.evaluate(() => window.replayTestRuntime.simulator.getBallView(0).renderPosition);
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.replay.open()), false);
  let state = await advance(90);
  for (let i = 0; i < 120 && state.busy; ++i) state = await advance(30);
  assert.equal(state.busy, false); assert.equal(state.available, true);
  assert.equal(await page.locator(".replay-open").isVisible(), true);
  const before = await snapshot();
  await page.getByRole("button", { name: "回看上一杆", exact: true }).click();
  state = await advance(0); assert.equal(state.active, true);
  const replayStart = await page.evaluate(() => window.replayTestRuntime.game.getDisplayBallView(0).renderPosition);
  assert.deepEqual(replayStart, initial);
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  state = await advance(20); assert(state.time > 0);
  await page.keyboard.press("Space"); const paused = await advance(60);
  assert.equal(paused.time, state.time); assert.equal(paused.paused, true);
  await page.getByRole("button", { name: "切换四分之一慢放", exact: true }).click();
  await page.keyboard.press("Space"); state = await advance(60);
  assert.ok(Math.abs(state.time - paused.time - .25) < 1e-6);
  await page.getByRole("button", { name: "重新播放上一杆", exact: true }).click();
  assert.equal((await advance(0)).time, 0);
  await page.locator('input[aria-label="回放进度"]').evaluate(input => {
    input.value = ".5"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state = await advance(0); assert.equal(state.paused, true); assert.ok(Math.abs(state.time - state.duration * .5) < 1e-6);
  await page.locator("canvas").focus(); await page.keyboard.press("v"); await advance(30);
  assert.equal(await page.locator(".view-notice").textContent(), "视线跟随母球");
  await page.mouse.move(650, 400); await page.mouse.down(); await page.mouse.move(700, 420); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.replay.view.manual), true);
  await page.keyboard.press("Space"); await advance(60);
  assert.deepEqual(await snapshot(), before);
  await mkdir(".cache/replay", { recursive: true });
  await page.screenshot({ path: ".cache/replay/playback.png" });
  await page.locator('input[aria-label="回放进度"]').focus();
  await page.keyboard.press("Escape"); state = await advance(0); assert.equal(state.active, false);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await page.evaluate(() => {
    const { game, simulator } = window.replayTestRuntime;
    return JSON.stringify(game.getDisplayBallView(0)) === JSON.stringify(simulator.getBallView(0));
  }), true);
  await page.keyboard.press("w"); await advance(120); await page.keyboard.press("Space");
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.replay.open()), false);
  state = await advance(90); for (let i = 0; i < 120 && state.busy; ++i) state = await advance(30);
  assert(state.available);
  await page.evaluate(() => window.replayTestRuntime.game.setMode("single-play")); await advance(0);
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  await page.keyboard.press("w"); await advance(120);
  await page.evaluate(() => window.replayTestRuntime.game.human.camera.resetWithKissDir(0, 1));
  await advance(30); await page.keyboard.press("Space");
  state = await advance(90); for (let i = 0; i < 120 && state.busy; ++i) state = await advance(10);
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.session.context.playerIndex), 1);
  const aiBefore = await snapshot();
  await page.getByRole("button", { name: "回看上一杆", exact: true }).click();
  await advance(600); assert.deepEqual(await snapshot(), aiBefore);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("Replay smoke passed: entry timing, last-shot poses, pause/slow/seek/restart, V/manual, live state and AI isolation, next shot/new game");
} finally { clearTimeout(timeout); await browser.close(); }
