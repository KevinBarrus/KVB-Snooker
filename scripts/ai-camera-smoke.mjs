import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => void browser.close(), 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => {
    window.aiCameraRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    window.aiCameraRuntime.engine.stopRenderLoop();
  });
  assert.equal(await page.locator(".hud").count(), 1);
  const snapshot = () => page.evaluate(() => {
    const { game, scene } = window.aiCameraRuntime;
    return { target: game.human.camera.target.asArray(), renderedTarget: scene.activeCamera.lockedTarget.asArray(),
      active: game.human.camera.shotView.active, mode: game.human.camera.shotView.mode,
      stored: localStorage.getItem("snk.shot-view"), notice: document.querySelector(".view-notice").textContent };
  });
  for (const mode of ["natural", "cue", "object"]) {
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.state === "ready");
    await page.evaluate(async mode => {
      const app = window.aiCameraRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      app.engine.stopRenderLoop();
      const { game } = app;
      if (!game.setMode("single-play", "EASY")) throw new Error("Could not start single play");
      while (game.human.camera.shotView.mode !== mode) game.cycleView();
      game.human.camera.resetWithKissDir(0, 1);
      game.human.gotoState1(true);
      for (let i = 0; i < 120; ++i) game.update(1 / 60);
      if (!game.shots.launch(game.human)) throw new Error("Could not launch human shot");
      for (let i = 0; i < 5000 && game.session.context.nRounds === 0; ++i) game.update(1 / 60);
      if (game.session.context.playerIndex !== 1 || game.shots.busy) throw new Error("Expected AI turn after human miss");
      game.human.camera.lookTo(1.1, .5, true);
      game.update(0);
    }, mode);
    const before = await snapshot();
    assert.equal(before.active, false, "Human shot observation must finish before the AI turn");
    await page.locator("canvas").focus();
    await page.keyboard.press("v");
    assert.deepEqual(await snapshot(), before, "V while AI thinks must not change the saved mode");
    const launch = await page.evaluate(() => {
      const { game } = window.aiCameraRuntime;
      const target = game.human.camera.target.clone();
      let maxDrift = 0;
      for (let i = 0; i < 5000 && !game.shots.busy; ++i) {
        game.update(1 / 60);
        maxDrift = Math.max(maxDrift, game.human.camera.target.subtract(target).length());
      }
      return { maxDrift, actor: game.shots.launchingController?.playerIndex, active: game.human.camera.shotView.active };
    });
    assert.equal(launch.actor, 1);
    assert.equal(launch.active, false, `${mode}: AI launch must not start human shot observation`);
    assert(launch.maxDrift < 1e-10, `${mode}: AI launch moved the observer by ${launch.maxDrift}`);
    await page.locator("canvas").focus();
    await page.keyboard.press("v");
    assert.deepEqual(await snapshot(), before, "V during AI pullback must not change view, preference or notice");
    const contact = await page.evaluate(() => {
      const { game } = window.aiCameraRuntime;
      const target = game.human.camera.target.clone();
      let maxDrift = 0;
      for (let i = 0; i < 1000 && game.session.players[1].shootingCount === 0; ++i) {
        game.update(1 / 60);
        maxDrift = Math.max(maxDrift, game.human.camera.target.subtract(target).length());
      }
      return { maxDrift, shots: game.session.players[1].shootingCount };
    });
    assert.equal(contact.shots, 1);
    assert(contact.maxDrift < 1e-10, "AI physical stroke must preserve the observer target");
    await page.keyboard.press("v");
    assert.deepEqual(await snapshot(), before, "V during AI ball motion must not start following");
    await page.mouse.move(640, 400); await page.mouse.down();
    await page.mouse.move(710, 425); await page.mouse.up();
    await page.evaluate(() => {
      const { game } = window.aiCameraRuntime;
      for (let i = 0; i < 120; ++i) game.update(1 / 60);
    });
    const moved = await snapshot();
    assert.notDeepEqual(moved.target, before.target, "Dragging during the AI stroke must move the view");
    assert.equal(moved.active, false);
    const settled = await page.evaluate(() => {
      const { game, simulator } = window.aiCameraRuntime;
      const target = game.human.camera.target.clone();
      let maxDrift = 0, contacts = 0;
      for (let i = 0; i < 20000; ++i) {
        if (!game.shots.busy && game.session.context.playerIndex === 0) break;
        game.update(1 / 60);
        maxDrift = Math.max(maxDrift, game.human.camera.target.subtract(target).length());
        contacts = Math.max(contacts, simulator.getResult().nKissed);
      }
      return { maxDrift, contacts, player: game.session.context.playerIndex, busy: game.shots.busy,
        mode: game.human.camera.shotView.mode, active: game.human.camera.shotView.active,
        aiShots: game.session.players[1].shootingCount };
    });
    assert(settled.maxDrift < 1e-10, `AI collision/end/continuation changed the manual view: ${JSON.stringify(settled)}`);
    assert(settled.contacts > 0, "AI stroke must exercise actual ball collisions");
    assert.equal(settled.player, 0); assert.equal(settled.busy, false);
    assert.equal(settled.mode, mode); assert.equal(settled.active, false);
    await page.keyboard.press("w");
    await page.evaluate(() => { for (let i = 0; i < 150; ++i) window.aiCameraRuntime.game.update(1 / 60); });
    await page.keyboard.press("Space");
    const resumed = await snapshot();
    assert.equal(resumed.active, true, "Next human shot must restore shot observation");
    assert.equal(resumed.mode, mode);
    await page.keyboard.press("v");
    assert.equal((await snapshot()).mode, { natural: "cue", cue: "object", object: "natural" }[mode]);
    console.log("AI observer camera passed:", { mode, ...settled });
  }
  assert.deepEqual(errors, []);
} finally { clearTimeout(timeout); await browser.close(); }
