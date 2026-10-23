import assert from "node:assert/strict";
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
  await page.evaluate(async () => { const { engine } = await (await import("/src/app.ts")).runtime; engine.stopRenderLoop(); });
  const advance = async (count, dt = .0167) => page.evaluate(async ({ count, dt }) => {
    const { game, scene, balls } = await (await import("/src/app.ts")).runtime;
    for (let i = 0; i < count; ++i) game.update(dt);
    balls.sync(); scene.render();
    return { state: game.human.camera.state, ratio: game.human.camera.stateRatio, power: game.human.strokePower,
      ready: game.human.isReadyToStroke(), busy: game.shots.busy, locked: game.shots.inputLocked,
      rounds: game.session.context.nRounds, player: game.session.context.playerIndex,
      shots: game.session.players.map(player => player.shootingCount) };
  }, { count, dt });
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
  const before = await page.evaluate(async () => Array.from((await (await import("/src/app.ts")).runtime).game.human.getStrokeVars()));
  await page.keyboard.press("c"); await advance(30);
  const cleared = await page.evaluate(async () => Array.from((await (await import("/src/app.ts")).runtime).game.human.getStrokeVars()));
  assert.notDeepEqual(before, cleared);
  await page.keyboard.press("Space");
  let state = await advance(1);
  assert.equal(state.locked, true); assert.equal(state.shots[0], 0);
  await page.keyboard.press("Space");
  state = await advance(55);
  assert.equal(state.locked, false); assert.equal(state.shots[0], 1);
  for (let i = 0; i < 100 && state.rounds === 0; ++i) state = await advance(30);
  assert.equal(state.rounds, 1); assert.equal(state.busy, false);
  await page.keyboard.press("p"); await advance(120);
  assert.equal(await page.evaluate(async () => (await (await import("/src/app.ts")).runtime).game.controls.inHand.active), true);
  await page.keyboard.press("Escape");
  await page.keyboard.down("d"); await advance(10);
  await page.locator("canvas").evaluate(canvas => canvas.blur());
  await advance(90);
  const position = await page.evaluate(async () => (await (await import("/src/app.ts")).runtime).game.human.camera.bodyPosition.asArray());
  await advance(30);
  const stopped = await page.evaluate(async () => (await (await import("/src/app.ts")).runtime).game.human.camera.bodyPosition.asArray());
  assert.deepEqual(stopped, position);
  await page.keyboard.up("d");
  await page.evaluate(async () => {
    const { game } = await (await import("/src/app.ts")).runtime;
    game.setMode("single-play", "EASY");
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
