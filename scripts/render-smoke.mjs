import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.state), undefined, { timeout: 30000 })
    .catch(error => { throw new Error(`${error.message}\n${errors.join("\n")}`); });
  const state = await page.locator("body").getAttribute("data-state");
  assert.equal(state, "ready", await page.locator("output").textContent());
  const sceneState = await page.evaluate(async () => {
    const { scene } = await (await import("/src/app.ts")).runtime;
    const gameLight = scene.getLightByName("GameLight");
    const pocketLight = scene.getLightByName("PocketLight");
    const balls = scene.meshes.filter(mesh => /^ball-\d+$/.test(mesh.name));
    const shadow = scene.getMeshByName("ball-shadows");
    const frame = scene.getMeshByName("Frame").material;
    return {
      meshes: ["Room", "Ground", "TableInner", "Pocket", "Frame"].every(name => scene.getMeshByName(name)?.isReady()),
      light: [gameLight.intensity, gameLight.position.y, gameLight.angle],
      lightMeshes: gameLight.includedOnlyMeshes.map(mesh => mesh.name),
      pocketMeshes: pocketLight.includedOnlyMeshes.map(mesh => mesh.name),
      materials: [...new Set(balls.map(ball => ball.material.name))].sort(),
      ready: balls.every(ball => ball.material.isReady(ball)),
      shadow: [shadow.position.y, shadow.getTotalVertices(), ...new Set(shadow.getVerticesData("alpha"))],
      frame: [frame.metallic, frame.roughness, frame.disableLighting]
    };
  });
  assert.equal(sceneState.meshes, true);
  assert.deepEqual(sceneState.light, [60, 3.6, 175 / 180 * Math.PI]);
  assert.deepEqual(sceneState.lightMeshes, ["TableInner"]);
  assert.deepEqual(sceneState.pocketMeshes, ["Pocket"]);
  assert.deepEqual(sceneState.materials, Array.from({ length: 8 }, (_, i) => `ball-material-${i}`));
  assert.equal(sceneState.ready, true);
  assert.deepEqual(sceneState.shadow, [0.881, 88, Math.fround(0.8)]);
  assert.deepEqual(sceneState.frame, [1, 0.8, true]);
  const motion = await page.evaluate(async () => {
    const { engine, scene, simulator, balls } = await (await import("/src/app.ts")).runtime;
    engine.stopRenderLoop();
    const cue = scene.getMeshByName("ball-0");
    const positionsMatch = () => {
      for (let i = 0; i < simulator.getBallCount(); ++i) {
        const view = simulator.getBallView(i);
        const mesh = scene.getMeshByName(`ball-${i}`);
        const p = view.renderPosition;
        const q = view.renderOrientation;
        if (mesh.isVisible !== view.active || (view.active &&
            (mesh.position.x !== p.x || mesh.position.y !== p.y || mesh.position.z !== p.z ||
             mesh.rotationQuaternion.x !== q.x || mesh.rotationQuaternion.y !== q.y ||
             mesh.rotationQuaternion.z !== q.z || mesh.rotationQuaternion.w !== q.w))) return false;
      }
      return true;
    };
    const initial = positionsMatch();
    const start = simulator.getCueBallPosition();
    simulator.stroke(new Float32Array([start.x - 0.02625, start.y, start.z + 0.00875, 1, 0, 0, 10, 0.005]));
    for (let i = 0; i < 10; ++i) simulator.step(0.0167);
    const physical = JSON.stringify(simulator.serialize());
    balls.sync();
    const readonly = JSON.stringify(simulator.serialize()) === physical;
    const moved = cue.position.x !== start.x;
    const rotated = Math.hypot(cue.rotationQuaternion.x, cue.rotationQuaternion.y, cue.rotationQuaternion.z) > 0;
    const synced = positionsMatch();
    scene.render();
    simulator.reset(true, true);
    simulator.respotIndexXYZ(0, 0, simulator.spotY, 0.8);
    const p = simulator.getCueBallPosition();
    simulator.stroke(new Float32Array([p.x, p.y, p.z - 0.02625, 0, 0, 1, 8, 0.005]));
    for (let i = 0; i < 300 && simulator.getBallView(0).active; ++i) simulator.step(0.0167);
    balls.sync();
    const result = simulator.getResult();
    const dropped = result.pottedIndices.includes(0) || result.outOfBoundsIndices.includes(0);
    const shadow = scene.getMeshByName("ball-shadows");
    const hidden = !cue.isVisible && shadow.getVerticesData("alpha").slice(0, 4).every(value => value === 0);
    simulator.reset(true, true);
    balls.sync();
    const respotted = cue.isVisible && cue === scene.getMeshByName("ball-0") && positionsMatch() &&
      shadow.getVerticesData("alpha").slice(0, 4).every(value => value === Math.fround(0.8));
    scene.render();
    return { count: simulator.getBallCount(), initial, readonly, moved, rotated, synced, dropped, hidden, respotted };
  });
  assert.deepEqual(motion, { count: 22, initial: true, readonly: true, moved: true, rotated: true,
    synced: true, dropped: true, hidden: true, respotted: true });
  assert.deepEqual(errors, [], errors.join("\n"));
  const colors = await page.locator("canvas").evaluate(canvas => {
    const sample = document.createElement("canvas");
    sample.width = 64; sample.height = 64;
    const context = sample.getContext("2d");
    context.drawImage(canvas, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  });
  assert.ok(colors > 30, `Canvas has only ${colors} colors`);
  await mkdir(".cache/render", { recursive: true });
  await page.screenshot({ path: ".cache/render/smoke.png" });
  const disposed = await page.evaluate(async () => {
    const { engine, scene, balls } = await (await import("/src/app.ts")).runtime;
    balls.dispose();
    const removed = !scene.meshes.some(mesh => mesh.name.startsWith("ball-"));
    const tableRetained = !!scene.getMeshByName("TableInner");
    scene.dispose(); engine.dispose();
    return { removed, tableRetained };
  });
  assert.deepEqual(disposed, { removed: true, tableRetained: true });
  assert.deepEqual(errors, [], errors.join("\n"));
  const invalidPage = await browser.newPage();
  await invalidPage.route("**/assets/physics/table.json", route => route.fulfill({
    status: 200, contentType: "application/json", body: "{}"
  }));
  await invalidPage.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await invalidPage.waitForFunction(() => document.body.dataset.state === "error", undefined, { timeout: 30000 });
  assert.equal(await invalidPage.locator("output").textContent(), "Physics table digest mismatch");
  console.log(`Render smoke passed: 22 balls, motion/rotation/pot/respot/disposal, ${colors} sampled colors, invalid asset rejected`);
} finally {
  await browser.close();
}
