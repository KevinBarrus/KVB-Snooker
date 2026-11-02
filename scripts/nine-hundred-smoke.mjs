import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("900 smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => { const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime; engine.stopRenderLoop(); });
  const advance = async (count, dt = .1) => page.evaluate(async ({ count, dt }) => {
    const { game, balls, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (let i = 0; i < count; ++i) game.update(dt);
    balls.sync(); scene.render();
    return { ruleset: game.session.ruleset, clock: game.session.clock, player: game.session.context.playerIndex,
      inHand: game.session.context.inHand, foul: game.session.result.foulCode, phase: game.session.clock?.phase ?? null,
      finished: game.session.finished, round: game.session.context.nRounds,
      busy: game.shots.busy, state: game.session.state };
  }, { count, dt });

  const start900 = async () => {
    await page.selectOption('select[name="mode"]', "single-play");
    await page.selectOption('select[name="rules"]', "snooker-900");
    await page.getByRole("button", { name: "开始新局" }).click();
    return advance(2);
  };
  const confirmHere = async () => {
    await page.locator("canvas").focus();
    await page.keyboard.press("p"); await advance(2);
    await page.keyboard.press("Enter"); await advance(2);
  };

  let state = await start900();
  assert.equal(state.ruleset, "snooker-900");
  assert.deepEqual(state.clock, { frameSeconds: 900, shotSeconds: 20, phase: "placement", shootout: false });
  const clockText = await page.locator(".match-clock").evaluate(node => ({ hidden: node.hidden, text: node.textContent }));
  assert.equal(clockText.hidden, false);
  assert.match(clockText.text, /本局 15:00/);
  assert.match(clockText.text, /出杆 20/);
  assert.match(clockText.text, /摆球暂停/);
  const dots = await page.evaluate(async () => {
    const { scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const meshes = scene.meshes.filter(mesh => mesh.name.startsWith("cue-red-dot-"));
    return { count: meshes.length, visible: meshes.filter(mesh => mesh.isVisible).length,
      parent: meshes[0]?.parent?.name, flat: meshes.every(mesh => mesh.getTotalVertices() < 100) };
  });
  assert.deepEqual(dots, { count: 6, visible: 6, parent: "ball-0", flat: true });

  state = await advance(10);
  assert.deepEqual(state.clock, { frameSeconds: 900, shotSeconds: 20, phase: "placement", shootout: false });
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  const blocked = await page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (let i = 0; i < 60; ++i) game.update(.0167);
    return { state: game.human.camera.state, ratio: game.human.camera.stateRatio, phase: game.session.clock.phase };
  });
  assert.deepEqual(blocked, { state: 0, ratio: 0, phase: "placement" }, "placement must block aiming");

  await confirmHere();
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.session.clock.phase), "aiming");
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).game.session.context.inHand), 1);
  state = await advance(10);
  assert.equal(state.phase, "aiming");
  assert.deepEqual([state.clock.frameSeconds, state.clock.shotSeconds].map(value => Math.round(value)), [899, 19]);

  state = await advance(200);
  assert.equal(state.foul, 128);
  assert.equal(state.player, 1);
  assert.equal(state.inHand, 1, "AI must place the cue ball and start its own shot clock");
  assert.equal(state.phase, "aiming");
  assert.equal(Math.round(state.clock.frameSeconds), 879);
  assert.ok(state.clock.shotSeconds > 18 && state.clock.shotSeconds <= 20, `AI shot clock reset: ${state.clock.shotSeconds}`);
  assert.equal(state.finished, false);
  const afterTimeout = await page.locator(".match-clock").textContent();
  assert.match(afterTimeout, /出杆 (18|19|20)/);
  assert.match(afterTimeout, /瞄准中/);
  for (let i = 0; i < 80; ++i) { state = await advance(30); if (!state.busy && state.state === 4) break; }

  await page.reload();
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => { const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime; engine.stopRenderLoop(); });
  state = await start900();
  await confirmHere();
  await page.locator("canvas").focus();
  await page.keyboard.press("w"); await advance(120);
  await page.keyboard.press("Space"); await advance(60);
  const shotStarted = await page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { busy: game.shots.busy, striker: game.session.players[0].shootingCount, phase: game.session.clock.phase };
  });
  assert.deepEqual(shotStarted, { busy: true, striker: 1, phase: "rolling" }, "confirmed placement must allow a real stroke");
  for (let i = 0; i < 80; ++i) { state = await advance(30); if (!state.busy && state.state === 4) break; }
  assert.equal(state.state, 4, "stroke must settle back to READY");

  await page.selectOption('select[name="mode"]', "practice");
  await page.selectOption('select[name="rules"]', "snooker-900");
  await page.getByRole("button", { name: "开始新局" }).click();
  state = await advance(2);
  assert.equal(state.ruleset, "classic");
  assert.equal(state.clock, null);
  assert.equal(await page.locator(".match-clock").evaluate(node => node.hidden), true);
  assert.equal(await page.evaluate(async () => {
    const { scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return scene.meshes.filter(mesh => mesh.name.startsWith("cue-red-dot-") && mesh.isVisible).length;
  }), 0);

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("900 smoke passed: rules entry, dual clock, red-dot cue, timeout foul, practice fallback");
} finally { clearTimeout(timeout); await browser.close(); }
