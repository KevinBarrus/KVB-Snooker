import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Audio smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.soundProbe = { starts: [], peak: 0, active: 0, contexts: [] };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.soundProbe.starts.push({ offset: args[1], duration: this.buffer?.duration });
      window.soundProbe.active++;
      this.addEventListener("ended", () => { window.soundProbe.active--; }, { once: true });
      return start.apply(this, args);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (...args) {
      if (args[0] instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        const data = new Float32Array(analyser.fftSize);
        window.soundProbe.contexts.push(this.context);
        setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          for (const value of data) window.soundProbe.peak = Math.max(window.soundProbe.peak, Math.abs(value));
        }, 5);
      }
      return connect.apply(this, args);
    };
  });
  const url = process.env.RENDER_URL ?? "http://127.0.0.1:5173";
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  assert.equal(await page.evaluate(async () => {
    const runtime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    window.audioRuntime = runtime; runtime.engine.stopRenderLoop();
    const { BrowserSoundBackend } = await import("/src/audio/browser-backend.ts");
    const play = BrowserSoundBackend.prototype.play;
    window.decisions = [];
    BrowserSoundBackend.prototype.play = function (decision) { window.decisions.push(decision); return play.call(this, decision); };
    window.impacts = []; runtime.game.bus.on("sim/impact", event => window.impacts.push(event));
    return runtime.audio.ready;
  }), true, "All 79 samples must load and decode");
  await page.locator("canvas").click({ position: { x: 600, y: 400 } });
  await page.waitForFunction(() => document.querySelector(".audio-control span").textContent === "音量");
  await page.locator("canvas").focus(); await page.keyboard.press("w");
  await page.evaluate(() => { for (let i = 0; i < 120; ++i) window.audioRuntime.game.update(.0167); });
  const predictionQuiet = await page.evaluate(() => {
    const { game } = window.audioRuntime;
    const count = window.soundProbe.starts.length;
    for (let i = 0; i < 5; ++i) game.simulator.predict(game.human.getStrokeVars());
    return window.soundProbe.starts.length === count;
  });
  assert.ok(predictionQuiet, "Prediction must remain silent");
  await page.keyboard.press("Space");
  await page.evaluate(() => window.audioRuntime.game.update(.0167));
  assert.equal(await page.evaluate(() => window.soundProbe.starts.length), 0, "Pullback must not play cue sound");
  await page.evaluate(() => {
    for (let i = 0; i < 100 && !window.impacts.some(e => e.kind === "cue"); ++i) window.audioRuntime.game.update(.0167);
  });
  assert.equal(await page.evaluate(() => window.impacts.filter(e => e.kind === "cue").length), 1);
  await page.waitForFunction(() => window.soundProbe.peak > .001);
  assert.ok(await page.evaluate(() => window.soundProbe.peak < 1), "Measured output must retain headroom");

  const trial = async ({ cue, object, speed, direction = [1, 0] }) => page.evaluate(({ cue, object, speed, direction }) => {
    const { game, simulator, audio, scene } = window.audioRuntime;
    game.shots.finish();
    const balls = Array.from({ length: simulator.getBallCount() }, (_, index) => ({ index,
      x: index === 0 ? cue[0] : object?.[0] ?? 0, z: index === 0 ? cue[1] : object?.[1] ?? 0,
      active: index === 0 || (index === 1 && object !== null) }));
    game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup: { balls, ballOn: 2, inHand: 0, playerIndex: 0, scores: [0, 0] } });
    audio.sync(game.session, simulator.evolution, false);
    window.impacts = []; window.decisions = [];
    const before = window.soundProbe.starts.length;
    const p = simulator.getCueBallPosition(), r = simulator.ballRadius + .005;
    const vars = new Float32Array([p.x - r * direction[0], p.y, p.z - r * direction[1], direction[0], 0, direction[1], speed, .005]);
    if (!game.session.stroke(0, vars)) throw new Error("Test shot rejected");
    for (let i = 0; i < 1200 && simulator.nAwakened; ++i) simulator.step(.0167);
    scene.render();
    return { decisions: window.decisions, events: window.impacts, plays: window.soundProbe.starts.length - before, result: simulator.getResult() };
  }, { cue, object, speed, direction });
  const collision = await trial({ cue: [0, 0], object: [.3, 0], speed: 20 });
  assert.ok(collision.events.some(e => e.kind === "ball" && e.speed > 0));
  assert.ok(collision.plays >= 2);
  const pot = await trial({ cue: [1.35, .45], object: null, speed: 20, direction: [Math.SQRT1_2, Math.SQRT1_2] });
  assert.ok(pot.result.pottedIndices.includes(0), JSON.stringify(pot));
  assert.ok(pot.events.some(e => e.kind === "surface" && e.surface === "tunnel"));
  assert.equal(pot.plays, 2, "Cue plus a single pocket sound");
  assert.equal(pot.decisions.at(-1).sound, "pocket-clean");
  const jaw = await trial({ cue: [1.35, .45], object: null, speed: 25, direction: [Math.cos(.73), Math.sin(.73)] });
  assert.ok(jaw.result.pottedIndices.includes(0));
  assert.equal(jaw.decisions.at(-1).sound, "pocket-jaw");
  assert.equal(jaw.plays, 2);
  const soft = await trial({ cue: [1.77, .87], object: null, speed: 2, direction: [Math.SQRT1_2, Math.SQRT1_2] });
  assert.ok(soft.result.pottedIndices.includes(0));
  console.log("Soft pocket:", JSON.stringify(soft));
  assert.equal(soft.plays, 1, "Soft entry must not become loud because of falling into the funnel");
  const objectPot = await trial({ cue: [1.35, .45], object: [1.65, .75], speed: 35, direction: [Math.SQRT1_2, Math.SQRT1_2] });
  assert.ok(objectPot.result.pottedIndices.includes(1), JSON.stringify(objectPot));
  assert.equal(objectPot.decisions.filter(decision => decision.sound.startsWith("pocket-")).length, 1);
  assert.ok(objectPot.events.some(event => event.kind === "surface" && event.ballIndex === 1 && event.entrySpeed > .25));


  await page.locator('.audio-control input').fill("0");
  const muted = await trial({ cue: [0, 0], object: [.3, 0], speed: 20 });
  assert.equal(muted.plays, 0, "Muted playback must not start voices");
  assert.equal(await page.evaluate(() => localStorage.getItem("snk.volume")), "0");
  await page.locator('.audio-control input').fill("0.7");
  const isolated = await page.evaluate(() => {
    const { game, audio, simulator } = window.audioRuntime;
    const before = JSON.stringify(simulator.serialize());
    audio.sync(game.session, simulator.evolution, true);
    const starts = window.soundProbe.starts.length;
    game.bus.emit("sim/impact", { kind: "ball", speed: 3, time: 1, ballIndex: 0, x: 0, z: 0 });
    return { silent: starts === window.soundProbe.starts.length, unchanged: before === JSON.stringify(simulator.serialize()) };
  });
  assert.deepEqual(isolated, { silent: true, unchanged: true });
  await page.evaluate(() => window.audioRuntime.audio.dispose());
  await page.waitForFunction(() => window.soundProbe.contexts.every(context => context.state === "closed"));
  assert.deepEqual(errors, []);

  const unavailable = await browser.newPage();
  await unavailable.route("**/assets/audio/manifest.json", route => route.fulfill({ status: 404, body: "missing" }));
  await unavailable.goto(url);
  await unavailable.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  assert.equal(await unavailable.locator(".audio-control span").textContent(), "声音不可用");
  console.log("Audio smoke passed: assets, actual output, timing, collisions, pocket, mute, replay isolation and missing-assets fallback.");
} finally { clearTimeout(timeout); await browser.close(); }
