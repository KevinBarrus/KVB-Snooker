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
  const cameraPose = () => page.evaluate(() => {
    const camera = window.replayTestRuntime.scene.activeCamera;
    return { eye: camera.position.asArray(), target: camera.lockedTarget.asArray() };
  });
  const broadcast = { eye: [3.66 / 2 + 1.6, .88 + 1.2, 0], target: [0, .88, 1e-5] };
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
  assert.deepEqual(await cameraPose(), broadcast);
  const tableVisible = await page.evaluate(() => {
    const { scene, engine } = window.replayTestRuntime, camera = scene.activeCamera;
    const eye = camera.position, target = camera.lockedTarget;
    let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z;
    const length = Math.hypot(fx, fy, fz); fx /= length; fy /= length; fz /= length;
    const horizontal = Math.hypot(fx, fz), rx = fz / horizontal, rz = -fx / horizontal;
    const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
    return [-1.83, 1.83].every(x => [-.9295, .9295].every(z => {
      const dx = x - eye.x, dy = .88 - eye.y, dz = z - eye.z;
      const depth = dx * fx + dy * fy + dz * fz, halfFov = Math.tan(camera.fov / 2);
      const screenX = (dx * rx + dz * rz) / (depth * halfFov * engine.getAspectRatio(camera));
      const screenY = (dx * ux + dy * uy + dz * uz) / (depth * halfFov);
      return depth > 0 && Math.abs(screenX) < .9 && Math.abs(screenY) < .9 &&
        document.elementFromPoint((1 + screenX) * innerWidth / 2, (1 - screenY) * innerHeight / 2)?.tagName === "CANVAS";
    }));
  });
  assert(tableVisible, "Broadcast camera must show all four table corners");
  await mkdir(".cache/replay", { recursive: true });
  await page.screenshot({ path: ".cache/replay/broadcast.png" });
  const replayStart = await page.evaluate(() => window.replayTestRuntime.game.getDisplayBallView(0).renderPosition);
  assert.deepEqual(replayStart, initial);
  assert.equal(await page.locator(".replay-open").isVisible(), false);
  state = await advance(20); assert(state.time > 0);
  assert.deepEqual(await cameraPose(), broadcast);
  await page.keyboard.press("Space"); const paused = await advance(60);
  assert.equal(paused.time, state.time); assert.equal(paused.paused, true);
  assert.deepEqual(await cameraPose(), broadcast);
  await page.getByRole("button", { name: "切换四分之一慢放", exact: true }).click();
  await page.keyboard.press("Space"); state = await advance(60);
  assert.ok(Math.abs(state.time - paused.time - .25) < 1e-6);
  assert.deepEqual(await cameraPose(), broadcast);
  await page.getByRole("button", { name: "重新播放上一杆", exact: true }).click();
  assert.equal((await advance(0)).time, 0);
  assert.deepEqual(await cameraPose(), broadcast);
  await page.locator('input[aria-label="回放进度"]').evaluate(input => {
    input.value = ".5"; input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  state = await advance(0); assert.equal(state.paused, true); assert.ok(Math.abs(state.time - state.duration * .5) < 1e-6);
  assert.deepEqual(await cameraPose(), broadcast);
  await page.locator("canvas").focus(); await page.keyboard.press("v"); await advance(30);
  assert.equal(await page.locator(".view-notice").textContent(), "视线跟随母球");
  assert.deepEqual((await cameraPose()).eye, broadcast.eye);
  await page.mouse.move(650, 400); await page.mouse.down(); await page.mouse.move(700, 420); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.replayTestRuntime.game.replay.view.manual), true);
  await page.keyboard.press("Space"); await advance(60);
  assert.deepEqual((await cameraPose()).eye, broadcast.eye);
  assert.deepEqual(await snapshot(), before);
  await mkdir(".cache/replay", { recursive: true });
  await page.screenshot({ path: ".cache/replay/playback.png" });
  await page.getByRole("button", { name: "重新播放上一杆", exact: true }).click();
  await advance(0); assert.deepEqual(await cameraPose(), broadcast);
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
  const replayMode = await page.evaluate(() => window.replayTestRuntime.game.human.camera.shotView.mode);
  await page.locator("canvas").focus(); await page.keyboard.press("v");
  assert.notEqual(await page.evaluate(() => window.replayTestRuntime.game.human.camera.shotView.mode), replayMode,
    "Replay V must remain available while the paused live turn belongs to AI");
  await advance(600); assert.deepEqual(await snapshot(), aiBefore);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("Replay smoke passed: fixed broadcast camera, full table visible, entry timing, last-shot poses, pause/slow/seek/restart, V/manual, live state and AI isolation, next shot/new game");
} finally { clearTimeout(timeout); await browser.close(); }
