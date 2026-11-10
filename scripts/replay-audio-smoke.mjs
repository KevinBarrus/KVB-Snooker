import assert from "node:assert/strict";
import { chromium } from "playwright-core";

/** 回放音频：录制 impact 事件，按回放 playHead 播放，暂停/重播/定位不重复。 */
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Replay audio smoke timed out"); void browser.close(); }, 240000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => {
    window.replayAudioRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    window.replayAudioRuntime.engine.stopRenderLoop();
    await window.replayAudioRuntime.audio.ready;
    window.replayAudioLog = [];
    const backend = window.replayAudioRuntime.audio.backend;
    const original = backend.play.bind(backend);
    backend.play = decision => {
      window.replayAudioLog.push({ sound: decision.sound, head: window.replayAudioRuntime.game.replay.playHead });
      original(decision);
    };
  });
  const advance = count => page.evaluate(count => {
    const r = window.replayAudioRuntime;
    for (let index = 0; index < count; ++index) {
      r.game.update(1 / 60);
      if (index % 2 === 1 || index === count - 1) { r.balls.sync(); r.scene.render(); }
    }
    return { busy: r.game.shots.busy, available: r.game.replay.clip.available,
      active: r.game.replay.active, paused: r.game.replay.paused, head: r.game.replay.playHead,
      duration: r.game.replay.clip.duration, events: r.game.replay.audioEvents.length };
  }, count);
  const clearLog = () => page.evaluate(() => { window.replayAudioLog = []; });
  const log = () => page.evaluate(() => window.replayAudioLog);

  await page.getByRole("button", { name: "练习", exact: true }).click();
  await page.getByRole("button", { name: "自由练习", exact: true }).click();
  await advance(2);
  await page.locator("canvas").focus();
  await page.keyboard.press("w"); await advance(120);
  await page.keyboard.press("Space");
  let state = await advance(90);
  for (let index = 0; index < 120 && state.busy; ++index) state = await advance(30);
  assert.equal(state.busy, false);
  assert.equal(state.available, true);
  assert.ok(state.events > 0, "a shot must record replay audio events");

  clearLog();
  assert.equal(await page.evaluate(() => window.replayAudioRuntime.game.replay.open()), true);
  await advance(120);
  const first = await log();
  assert.ok(first.length > 0, "replay must play recorded audio");
  assert.ok(first.every(item => item.head >= 0));

  await page.keyboard.press("Space"); // pause
  const paused = await advance(30);
  assert.equal(paused.paused, true);
  clearLog(); await advance(60);
  assert.deepEqual(await log(), [], "paused replay must not play new sounds");

  await page.evaluate(() => { window.replayAudioRuntime.game.replay.restart(); });
  clearLog(); await advance(120);
  assert.ok((await log()).length > 0, "restart must replay audio from the beginning");

  await page.evaluate(() => { window.replayAudioRuntime.game.replay.clip.seek(.99); });
  clearLog(); await advance(0);
  assert.deepEqual(await log(), [], "seeking past the shot must not replay old sounds");

  await page.evaluate(() => { window.replayAudioRuntime.game.replay.close(); });
  assert.equal(await page.evaluate(() => window.replayAudioRuntime.game.replay.active), false);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Replay audio smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
