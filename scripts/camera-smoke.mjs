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
  const traces = await page.evaluate(() => {
    const { game, simulator, scene } = window.cameraTestRuntime;
    return ["natural", "cue", "object"].map(mode => {
      for (let i = 0; i < 3600 && game.shots.busy; ++i) game.update(1 / 60);
      if (!game.setMode("practice")) throw new Error("Camera trace could not reset the game");
      game.human.camera.shotView.mode = mode;
      game.human.camera.resetWithKissDir(1, .1);
      game.human.gotoState1(true);
      for (let i = 0; i < 120; ++i) game.update(1 / 60);
      game.human.strokePower = .8;
      const stroke = Array.from(game.human.getStrokeVars());
      if (!game.shots.launch(game.human)) throw new Error("Camera trace could not launch the shot");
      const positions = [];
      let firstKiss = 0, samples = 0, central = 0, maxOffset = 0, minRatio = 1, movingFrames = 0;
      for (let i = 0; i < 360; ++i) {
        game.update(1 / 60);
        const rig = game.human.camera;
        positions.push(rig.position.asArray());
        firstKiss ||= simulator.getResult().firstKissIndex;
        const ball = simulator.getBallView(mode === "object" && firstKiss ? firstKiss : 0);
        minRatio = Math.min(minRatio, rig.stateRatio);
        if (ball.async && ball.active) ++movingFrames;
        if (rig.stateRatio > .8 || !ball.active || !ball.async || ball.position.y < .88) continue;
        const eye = rig.position, target = rig.target;
        let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z;
        const len = Math.hypot(fx, fy, fz); fx /= len; fy /= len; fz /= len;
        const horizontal = Math.hypot(fx, fz), rx = fz / horizontal, rz = -fx / horizontal;
        const ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
        const dx = ball.renderPosition.x - eye.x, dy = ball.renderPosition.y - eye.y, dz = ball.renderPosition.z - eye.z;
        const depth = dx * fx + dy * fy + dz * fz;
        const fov = Math.tan(scene.activeCamera.fov / 2);
        const x = (dx * rx + dz * rz) / (depth * fov * 1.6);
        const y = (dx * ux + dy * uy + dz * uz) / (depth * fov);
        const offset = depth > 0 ? Math.max(Math.abs(x), Math.abs(y)) : Infinity;
        maxOffset = Math.max(maxOffset, offset); ++samples;
        if (offset < .8) ++central;
      }
      return { mode, stroke, positions, firstKiss, samples, central, maxOffset, minRatio, movingFrames };
    });
  });
  for (const trace of traces) {
    assert(trace.firstKiss > 0, "High-power thin shot must hit an object ball");
    assert.deepEqual(trace.stroke, traces[0].stroke);
    assert.deepEqual(trace.positions, traces[0].positions, "All modes must share the rising camera path");
    if (trace.mode !== "natural") {
      assert(trace.samples > 5, JSON.stringify({ ...trace, positions: undefined }));
      assert(trace.central / trace.samples > .95, JSON.stringify({ ...trace, positions: undefined }));
    }
  }
  console.log("High-power tracking:", traces.map(({ mode, samples, central, maxOffset }) => ({ mode, samples, central, maxOffset })));
  await page.evaluate(() => localStorage.setItem("snk.shot-view", "invalid"));
  await page.reload(); await ready(); assert.equal(await mode(), "natural");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Blocked storage"); }; });
  await page.keyboard.press("v"); assert.equal(await mode(), "cue");
  assert.deepEqual(errors, []);
  console.log("Camera smoke passed: V modes, notice, persistence/fallback, moving switch, manual takeover, high-power shot");
} finally { clearTimeout(timeout); await browser.close(); }
