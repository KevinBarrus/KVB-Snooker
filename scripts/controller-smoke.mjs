import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Controller smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => { const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime; engine.stopRenderLoop(); });
  assert.equal(await page.locator(".hud").count(), 1, "Tests must reuse the page entry module");
  const advance = async (count, dt = .0167) => page.evaluate(async ({ count, dt }) => {
    const { game, scene, balls } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (let i = 0; i < count; ++i) game.update(dt);
    balls.sync(); scene.render();
    return { state: game.human.camera.state, ratio: game.human.camera.stateRatio, power: game.human.strokePower,
      ready: game.human.isReadyToStroke(), busy: game.shots.busy, locked: game.shots.inputLocked,
      rounds: game.session.context.nRounds, player: game.session.context.playerIndex,
      shots: game.session.players.map(player => player.shootingCount) };
  }, { count, dt });
  await mkdir(".cache/controller", { recursive: true });
  await page.screenshot({ path: ".cache/controller/stand.png" });
  const opening = await page.evaluate(async () => {
    const { game, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { active: game.controls.inHand.active, origin: scene.getMeshByName("respot-origin").isVisible,
      preview: scene.getMeshByName("respot-preview").isVisible };
  });
  assert.deepEqual(opening, { active: true, origin: true, preview: false },
    "a new match must open with the cue ball waiting to be placed");
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  assert.equal((await advance(120)).ready, true);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 200);
  assert.equal((await advance(30)).power, .6);
  await page.keyboard.down("Alt");
  await page.mouse.down(); await page.mouse.move(680, 400); await page.mouse.up();
  await page.keyboard.up("Alt");
  await advance(30);
  const before = await page.evaluate(async () => Array.from((await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.human.getStrokeVars()));
  await page.keyboard.press("c"); await advance(30);
  const cleared = await page.evaluate(async () => Array.from((await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.human.getStrokeVars()));
  assert.notDeepEqual(before, cleared);
  const cueView = await page.evaluate(async () => {
    const { scene, game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const cue = scene.getMeshByName("StickAlpha");
    return { visible: cue.isVisible, ready: cue.material.isReady(cue),
      transform: Array.from(cue.getWorldMatrix().m).every((value, i) => Math.abs(value - game.human.stick.worldMatrix.m[i]) < 1e-6),
      powerWidth: document.querySelector(".power-bar-fill").style.width };
  });
  assert.deepEqual(cueView, { visible: true, ready: true, transform: true, powerWidth: "60%" });
  await page.screenshot({ path: ".cache/controller/aim.png" });
  await page.keyboard.press("Space");
  let state = await advance(1);
  assert.equal(state.locked, true); assert.equal(state.shots[0], 0);
  await page.keyboard.press("Space");
  state = await advance(55);
  assert.equal(state.locked, false); assert.equal(state.shots[0], 1);
  for (let i = 0; i < 100 && state.rounds === 0; ++i) state = await advance(30);
  assert.equal(state.rounds, 1); assert.equal(state.busy, false);
  await page.keyboard.press("p"); await advance(120);
  const opened = await page.evaluate(async () => {
    const { game, scene } = await (await import(document.querySelector('script[src*="/app.ts"]').src)).runtime;
    return { active: game.controls.inHand.active, visible: game.controls.inHand.visible,
      origin: scene.getMeshByName("respot-origin").isVisible, preview: scene.getMeshByName("respot-preview").isVisible };
  });
  assert.deepEqual(opened, { active: true, visible: false, origin: true, preview: false });
  const project = async points => page.evaluate(async ({ points }) => {
    const { game, scene, engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    game.human.camera.lookTo(-1.3, 0, true);
    for (let i = 0; i < 120; ++i) game.update(.0167);
    scene.render();
    const m = scene.getTransformMatrix().m;
    return points.map(([x, y, z]) => {
      const w = x * m[3] + y * m[7] + z * m[11] + m[15];
      return [(1 + (x * m[0] + y * m[4] + z * m[8] + m[12]) / w) * engine.getRenderWidth() / 2,
        (1 - (x * m[1] + y * m[5] + z * m[9] + m[13]) / w) * engine.getRenderHeight() / 2];
    });
  }, { points });
  const dragStart = await page.evaluate(async () => {
    const { simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const cue = simulator.getCueBallPosition();
    return [cue.x, cue.z];
  });
  let projected = await project([[-1.2, .88, .15], [-1.5, .88, 0]]);
  await page.mouse.move(...projected[0]); await advance(2);
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.controls.inHand.valid), true);
  await page.mouse.down(); await page.mouse.move(projected[0][0] + 40, projected[0][1] + 10, { steps: 2 }); await page.mouse.up();
  await advance(2);
  const dragged = await page.evaluate(async () => {
    const { game, simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const cue = simulator.getCueBallPosition();
    return { active: game.controls.inHand.active, cue: [cue.x, cue.z] };
  });
  assert.deepEqual(dragged, { active: true, cue: dragStart }, "dragging must only move the view");
  projected = await project([[-1.2, .88, .15]]);
  await page.mouse.move(...projected[0]); await advance(2);
  const candidate = await page.evaluate(async () => {
    const { game, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { valid: game.controls.inHand.valid, color: scene.getMeshByName("respot-preview").getVerticesData("color").slice(0, 3),
      preview: scene.getMeshByName("respot-preview").isVisible };
  });
  assert.equal(candidate.valid, true);
  assert.ok(candidate.color[1] > candidate.color[0]);
  assert.equal(candidate.preview, true);
  await page.mouse.down(); await page.mouse.up(); await advance(2);
  const placed = await page.evaluate(async () => {
    const { game, simulator, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const cue = simulator.getCueBallPosition();
    return { x: cue.x, z: cue.z, displayed: scene.getMeshByName("ball-0").position.asArray(),
      active: game.controls.inHand.active, origin: scene.getMeshByName("respot-origin").isVisible, preview: scene.getMeshByName("respot-preview").isVisible };
  });
  assert.ok(Math.abs(placed.x + 1.2) < .01 && Math.abs(placed.z - .15) < .01, JSON.stringify(placed));
  assert.ok(Math.abs(placed.displayed[0] - placed.x) < 1e-5 && Math.abs(placed.displayed[2] - placed.z) < 1e-5);
  assert.deepEqual({ active: placed.active, origin: placed.origin, preview: placed.preview },
    { active: false, origin: false, preview: false }, "a placed ball must end placement and hide both markers");
  await page.screenshot({ path: ".cache/controller/placement.png" });
  await page.mouse.move(640, 400); await advance(2);
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).scene.getMeshByName("respot-preview").isVisible), false,
    "ordinary mouse movement after placing must not show a candidate");
  await page.keyboard.press("p"); await advance(2);
  projected = await project([[0, .88, 0]]);
  await page.mouse.move(...projected[0]); await advance(2);
  const denied = await page.evaluate(async () => {
    const { game, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { valid: game.controls.inHand.valid, red: scene.getMeshByName("respot-preview").getVerticesData("color")[0] };
  });
  assert.deepEqual(denied, { valid: false, red: 1 });
  await page.mouse.down(); await page.mouse.up(); await advance(2);
  const unchanged = await page.evaluate(async () => {
    const { simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const point = simulator.getCueBallPosition();
    return [point.x, point.z];
  });
  assert.deepEqual(unchanged, [placed.x, placed.z]);
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.controls.inHand.active), false);
  await page.keyboard.down("d"); await advance(10);
  await page.locator("canvas").evaluate(canvas => canvas.blur());
  await advance(90);
  const position = await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.human.camera.bodyPosition.asArray());
  await advance(30);
  const stopped = await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.human.camera.bodyPosition.asArray());
  assert.deepEqual(stopped, position);
  await page.keyboard.up("d");
  await page.selectOption('select[name="mode"]', "single-play");
  await page.selectOption('select[name="difficulty"]', "EASY");
  await page.getByRole("button", { name: "开始新局" }).click();
  await page.locator("canvas").focus(); await page.keyboard.press("w");
  await page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    game.human.camera.resetWithKissDir(0, 1);
    game.human.gotoState1(true);
  });
  await advance(30);
  await page.locator("canvas").focus(); await page.keyboard.press("Space");
  state = await advance(60);
  for (let i = 0; i < 160 && state.shots[1] === 0; ++i) state = await advance(30);
  assert.equal(state.shots[0], 1);
  assert.ok(state.shots[1] >= 1, "AI must take its turn through the shot animation");
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("Controller smoke passed: keyboard/mouse/spin, delayed stroke, practice round, pickup, blur release, human-to-AI turn");
} finally { clearTimeout(timeout); await browser.close(); }
