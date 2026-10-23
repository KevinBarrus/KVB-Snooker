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
  assert.deepEqual(sceneState.shadow, [0.881, 32, Math.fround(0.8)]);
  assert.deepEqual(sceneState.frame, [1, 0.8, true]);
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
  console.log(`Render smoke passed: ${colors} sampled colors, no shader/page/resource errors`);
} finally {
  await browser.close();
}
