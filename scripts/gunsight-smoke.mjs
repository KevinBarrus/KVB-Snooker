import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Gunsight smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.state), undefined, { timeout: 30000 });
  assert.equal(await page.locator("body").getAttribute("data-state"), "ready", errors.join("\n"));
  await page.evaluate(async () => { const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime; engine.stopRenderLoop(); });
  assert.equal(await page.locator(".hud").count(), 1, "Tests must reuse the page entry module");
  const advance = async (frames = 1) => page.evaluate(async frames => {
    const { game, scene, balls } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (let i = 0; i < frames; ++i) game.update(.0167);
    balls.sync(); scene.render();
    const meshes = scene.meshes.filter(mesh => mesh.name.startsWith("gunsight-"));
    return { visible: meshes.filter(mesh => mesh.isVisible).map(mesh => mesh.name),
      alpha: Math.max(...meshes.flatMap(mesh => Array.from(mesh.getVerticesData("alpha")))),
      finite: meshes.every(mesh => Array.from(mesh.getVerticesData("position")).every(Number.isFinite)),
      prediction: game.human.prediction, state: game.session.state, rounds: game.session.context.nRounds,
      targetColor: Array.from(scene.getMeshByName("gunsight-target-mark").getVerticesData("color")).slice(0, 3),
      incoming: Array.from(scene.getMeshByName("gunsight-incoming").getVerticesData("position")) };
  }, frames);
  const aim = async (mode, dx, dz) => {
    await page.evaluate(async ({ mode, dx, dz }) => {
      const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      if (!game.setMode(mode, "EASY")) throw new Error("Cannot reset while shooting");
      game.human.camera.resetWithKissDir(dx, dz);
      game.human.gotoState1(true);
    }, { mode, dx, dz });
    return advance(90);
  };
  const capture = async name => {
    await page.evaluate(async () => {
      const { scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      await new Promise(requestAnimationFrame); scene.render();
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: `.cache/controller/gunsight-${name}.png` });
  };
  await mkdir(".cache/controller", { recursive: true });
  assert.deepEqual((await advance()).visible, []);
  await page.locator("canvas").focus(); await page.keyboard.press("w");
  assert.deepEqual((await advance(15)).visible, []);
  let view = await advance(90);
  assert.ok(view.alpha > .59 && view.finite);
  assert.equal(view.prediction.impactOccured, false);
  assert.deepEqual(view.visible, ["gunsight-incoming"]);
  await capture("no-hit");

  view = await aim("practice", 0, 1);

  assert.equal(view.prediction.hasImpactTarget, true);
  assert.equal(view.prediction.targetNumber, 4);
  assert.deepEqual(view.targetColor, Array(3).fill(218 / 255));
  assert.ok(view.visible.includes("gunsight-target-mark"));
  await capture("legal");
  view = await aim("single-play", 0, 1);
  assert.equal(view.prediction.hasImpactTarget, true);
  assert.deepEqual(view.targetColor, [1, 80 / 255, 15 / 255]);
  await capture("illegal");

  await page.locator("canvas").focus();
  await page.mouse.move(640, 400); await page.mouse.wheel(0, 300);
  let changed = await advance(30);
  assert.notDeepEqual(changed.prediction, view.prediction);
  view = changed;
  await page.keyboard.down("Alt");
  await page.mouse.down(); await page.mouse.move(670, 415); await page.mouse.up();
  await page.keyboard.up("Alt");
  changed = await advance(30);
  assert.notDeepEqual(changed.prediction, view.prediction);
  view = changed;
  await page.keyboard.down("Alt"); await page.mouse.wheel(0, -300); await page.keyboard.up("Alt");
  changed = await advance(30);
  assert.notDeepEqual(changed.prediction, view.prediction);
  await page.keyboard.press("s"); assert.deepEqual((await advance(90)).visible, []);
  await page.keyboard.press("p"); assert.deepEqual((await advance(90)).visible, []);
  await page.keyboard.press("Escape");

  view = await aim("practice", -1, .1);
  assert.equal(view.prediction.impactOccured, true);
  assert.equal(view.prediction.hasImpactTarget, false);
  assert.ok(view.visible.includes("gunsight-cue-mark"));
  assert.ok(!view.visible.includes("gunsight-target-mark"));
  await capture("cushion");

  await page.evaluate(async () => {
    const { game, simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    game.setMode("practice");
    simulator.respotIndexXYZ(0, -.6, simulator.spotY, 0);
    simulator.respotIndexXYZ(16, -.6 + 2 * simulator.ballRadius + .001, simulator.spotY, 0);
    for (let i = 0; i < 100 && simulator.nAwakened; ++i) simulator.step(.1);
    game.human.activate(); game.human.camera.resetWithKissDir(1, 0); game.human.gotoState1(true);
  });
  view = await advance(90);
  assert.equal(view.prediction.hasImpactTarget, true);
  assert.ok(!view.visible.includes("gunsight-incoming"));
  assert.equal(view.finite, true);

  const stress = await page.evaluate(async () => {
    const { game, simulator, scene, balls } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    game.setMode("practice"); game.human.gotoState1(true);
    for (let i = 0; i < 90; ++i) game.update(.0167);
    const snapshot = () => JSON.stringify({ world: simulator.serialize(), result: simulator.getResult(),
      views: Array.from({ length: simulator.getBallCount() }, (_, i) => simulator.getBallView(i)),
      context: game.session.context, rounds: game.session.context.nRounds });
    const before = snapshot();
    let finite = true;
    for (let i = 0; i < 100; ++i) {
      game.human.strokePower = i % 11 / 10;
      game.human.stick.setTipPercent((i % 5 - 2) / 4, (i % 7 - 3) / 5);
      game.human.stick.setAngleV(i % 4 * Math.PI / 36);
      game.human.camera.resetWithKissDir(Math.cos(i * .04), Math.sin(i * .04));
      for (let f = 0; f < 25; ++f) game.update(.0167);
      balls.sync(); scene.render();
      finite &&= scene.meshes.filter(mesh => mesh.name.startsWith("gunsight-")).every(mesh =>
        Array.from(mesh.getVerticesData("position")).every(Number.isFinite));
    }
    return { restored: snapshot() === before, finite };
  });
  assert.deepEqual(stress, { restored: true, finite: true });
  await aim("single-play", 0, 1);
  await page.locator("canvas").focus(); await page.keyboard.press("Space");
  view = await advance(3);
  assert.ok(view.alpha > 0 && view.alpha < .6);
  view = await advance(20);
  assert.deepEqual(view.visible, []);
  for (let i = 0; i < 100 && view.rounds === 0; ++i) view = await advance(30);
  assert.equal(view.rounds, 1);
  assert.deepEqual(view.visible, []);
  const ownership = await page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { player: game.session.context.playerIndex, active: game.human.active };
  });
  assert.deepEqual(ownership, { player: 1, active: false });
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("Gunsight smoke passed: no-hit/ball/cushion/touching, legal colors, input refresh, 100 read-only prediction changes, shot fade and AI turn");
} finally { clearTimeout(timeout); await browser.close(); }
