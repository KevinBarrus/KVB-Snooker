import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => void browser.close(), 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  const ready = async () => {
    await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
    await page.evaluate(async () => {
      const app = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      app.engine.stopRenderLoop();
      window.cameraTestRuntime = app;
    });
    assert.equal(await page.locator(".hud").count(), 1);
    await page.locator("canvas").focus();
  };
  const advance = count => page.evaluate(count => {
    const { game, scene, balls } = window.cameraTestRuntime;
    for (let i = 0; i < count; ++i) game.update(1 / 60);
    balls.sync(); scene.render();
  }, count);
  const mode = () => page.evaluate(() => window.cameraTestRuntime.game.human.camera.shotView.mode);
  await ready();
  assert.equal(await mode(), "natural");
  for (const [value, label] of [["cue", "视线跟随母球"], ["object", "视线跟随子球"], ["natural", "自然起身"]]) {
    await page.keyboard.press("v");
    assert.equal(await mode(), value);
    assert.equal(await page.locator(".view-notice").textContent(), label);
  }
  await page.keyboard.press("v");
  await page.reload(); await ready();
  assert.equal(await mode(), "cue");
  await page.keyboard.press("w"); await advance(120);
  await page.evaluate(() => {
    const { game } = window.cameraTestRuntime;
    game.human.strokePower = 1;
    game.human.camera.resetWithKissDir(1, .1);
  });
  await advance(60);
  await page.keyboard.press("Space"); await advance(55);
  assert.equal(await page.evaluate(() => window.cameraTestRuntime.game.shots.busy), true);
  const before = await page.evaluate(() => window.cameraTestRuntime.game.human.camera.target.asArray());
  await page.keyboard.press("v");
  assert.equal(await mode(), "object");
  const after = await page.evaluate(() => window.cameraTestRuntime.game.human.camera.target.asArray());
  assert.deepEqual(after, before);
  await advance(70);
  await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(670, 405); await page.mouse.up();
  await advance(10);
  assert.equal(await page.evaluate(() => window.cameraTestRuntime.game.human.camera.shotView.manual), true);
  await page.keyboard.press("v"); await advance(2);
  assert.equal(await mode(), "natural");
  assert.equal(await page.evaluate(() => window.cameraTestRuntime.game.human.camera.shotView.manual), false);
  await mkdir(".cache/camera", { recursive: true });
  await page.screenshot({ path: ".cache/camera/natural.png" });
  const stable = await page.evaluate(() => {
    const { game } = window.cameraTestRuntime;
    const values = [];
    for (let i = 0; i < 60; ++i) { game.update(1 / 60); values.push(game.human.camera.target.asArray()); }
    return values.every(point => point.every(Number.isFinite));
  });
  assert(stable);
  await advance(200);
  assert.equal(await page.locator(".view-notice").isVisible(), false);
  await page.evaluate(() => localStorage.setItem("snk.shot-view", "invalid"));
  await page.reload(); await ready(); assert.equal(await mode(), "natural");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Blocked storage"); }; });
  await page.keyboard.press("v"); assert.equal(await mode(), "cue");
  assert.deepEqual(errors, []);
  console.log("Camera smoke passed: V modes, notice, persistence/fallback, moving switch, manual takeover, high-power shot");
} finally { clearTimeout(timeout); await browser.close(); }
