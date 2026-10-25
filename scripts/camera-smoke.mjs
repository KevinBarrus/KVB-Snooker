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
    return [.1, .07, 0].flatMap(direction => ["natural", "cue", "object"].map(mode => {
      for (let i = 0; i < 3600 && game.shots.busy; ++i) game.update(1 / 60);
      if (!game.setMode("practice")) throw new Error("Camera trace could not reset the game");
      game.human.camera.shotView.mode = mode;
      game.human.camera.resetWithKissDir(1, direction);
      game.human.gotoState1(true);
      for (let i = 0; i < 120; ++i) game.update(1 / 60);
      game.human.strokePower = .8;
      const stroke = Array.from(game.human.getStrokeVars());
      if (!game.shots.launch(game.human)) throw new Error("Camera trace could not launch the shot");
      const positions = [];
      const approachTargets = [];
      let firstKiss = 0, samples = 0, central = 0, maxOffset = 0, minRatio = 1, movingFrames = 0;
      let contactPitch = null, contactAcceleration = null, maxAimPitch = 0, standingFrames = 0, standingDrift = 0;
      const pitch = () => {
        const { target, position: eye } = game.human.camera;
        return Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
      };
      let previousPitch = pitch(), previousRatio = 1, previousPitchSpeed = 0;
      for (let i = 0; i < 360; ++i) {
        game.update(1 / 60);
        const rig = game.human.camera;
        positions.push(rig.position.asArray());
        const currentPitch = pitch(), deltaPitch = Math.abs(currentPitch - previousPitch) * 180 / Math.PI;
        const pitchSpeed = (currentPitch - previousPitch) * 60;
        if (!firstKiss) approachTargets.push(rig.target.asArray());
        if (!firstKiss && simulator.getResult().firstKissIndex) {
          contactPitch = deltaPitch; contactAcceleration = Math.abs(pitchSpeed - previousPitchSpeed) * 60;
        }
        if (previousRatio === 1 && rig.stateRatio === 1) maxAimPitch = Math.max(maxAimPitch, deltaPitch);
        previousPitch = currentPitch; previousRatio = rig.stateRatio; previousPitchSpeed = pitchSpeed;
        if (mode === "natural" && rig.shotView.active && rig.stateRatio === 0) {
          ++standingFrames; standingDrift = Math.max(standingDrift, Math.hypot(rig.target.x, rig.target.z));
        }
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
      return { mode, direction, stroke, positions, approachTargets, firstKiss, samples, central, maxOffset, minRatio, movingFrames,
        contactPitch, contactAcceleration, maxAimPitch, standingFrames, standingDrift };
    }));
  });
  for (const trace of traces) {
    assert(trace.firstKiss > 0, "High-power thin shot must hit an object ball");
    const reference = traces.find(value => value.direction === trace.direction && value.mode === "natural");
    assert.deepEqual(trace.stroke, reference.stroke);
    assert.deepEqual(trace.positions, reference.positions, "All modes must share the rising camera path");
    assert(trace.contactAcceleration !== null && trace.contactAcceleration < 12.001, `First-contact acceleration spike: ${JSON.stringify({ ...trace, positions: undefined })}`);
    if (trace.mode === "object") {
      const cue = traces.find(value => value.direction === trace.direction && value.mode === "cue");
      assert.deepEqual(trace.approachTargets, cue.approachTargets, "Object view must follow the cue before and on first contact without restarting");
      const start = trace.approachTargets[0], end = trace.approachTargets.at(-1);
      assert(Math.hypot(end[0] - start[0], end[2] - start[2]) > .05, "Pre-contact view must already be moving");
    }
    assert(trace.maxAimPitch < .9, "Tracking must not snap upward before standing");
    if (trace.mode === "natural") {
      assert(trace.standingFrames > 5);
      assert(trace.standingDrift < 1e-10, "Natural focus must arrive with the standing camera");
    }
    if (trace.mode !== "natural") {
      assert(trace.samples > 5, JSON.stringify({ ...trace, positions: undefined }));
      assert(trace.central / trace.samples > .95, JSON.stringify({ ...trace, positions: undefined }));
    }
  }
  console.log("High-power tracking:", traces.map(({ mode, direction, samples, central, maxOffset, contactPitch, contactAcceleration, maxAimPitch, standingDrift }) =>
    ({ mode, direction, samples, central, maxOffset, contactPitch, contactAcceleration, maxAimPitch, standingDrift })));
  await page.evaluate(() => localStorage.setItem("snk.shot-view", "invalid"));
  await page.reload(); await ready(); assert.equal(await mode(), "natural");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Blocked storage"); }; });
  await page.keyboard.press("v"); assert.equal(await mode(), "cue");
  assert.deepEqual(errors, []);
  console.log("Camera smoke passed: V modes, notice, persistence/fallback, moving switch, manual takeover, high-power shot");
} finally { clearTimeout(timeout); await browser.close(); }
