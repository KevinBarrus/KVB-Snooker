import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { CHROME_BIN, buildServer, startServer, stopServer, openClient, closePages, aimClient, shoot, readNet, waitFor } from "./net-smoke-lib.mjs";

const browser = await chromium.launch({ executablePath: CHROME_BIN, headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Pause smoke timed out"); void browser.close(); }, 180000);
const pages = [];
let server;
const errors = [];
const evaluate = (page, source, arg) => page.evaluate(async ({ source, arg }) => {
  const runtime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
  return new Function("runtime", "arg", source)(runtime, arg);
}, { source, arg });
const step = (page, seconds) => evaluate(page, "runtime.game.update(arg); runtime.balls.sync(); runtime.scene.render();", seconds);
const state = page => evaluate(page, `const {game}=runtime; return { pause:game.pause.view, clock:game.session.clock,
  checkpoint:game.session.exportCheckpoint(), target:{...game.human.camera.target}, input:game.controls.input.enabled };`);

try {
  const local = await browser.newPage({ viewport: { width: 1280, height: 800 } }); pages.push(local);
  local.on("pageerror", error => errors.push(error.message));
  await local.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await local.waitForFunction(() => document.body.dataset.state === "ready");
  await local.getByRole("button", { name: "练习", exact: true }).click();
  await local.getByRole("button", { name: "自由练习", exact: true }).click();
  await evaluate(local, "runtime.engine.stopRenderLoop(); runtime.game.update(.01); runtime.scene.render();");
  await local.getByRole("button", { name: "菜单", exact: true }).click();
  await local.getByRole("button", { name: "暂停", exact: true }).click();
  assert.equal((await state(local)).pause.phase, "paused");
  const before = await state(local);
  await step(local, 1000);
  assert.deepEqual((await state(local)).checkpoint, before.checkpoint);
  const opaque = await local.locator(".pause-cover").evaluate(el => {
    const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
    return el.open && rect.width >= innerWidth && rect.height >= innerHeight && css.backgroundColor === "rgb(16, 26, 21)";
  });
  assert.equal(opaque, true);
  await local.keyboard.press("Escape");
  await local.keyboard.press("w");
  assert.equal((await state(local)).pause.phase, "paused");
  await local.getByRole("button", { name: "准备继续", exact: true }).click();
  await step(local, 2);
  assert.equal((await state(local)).pause.phase, "resuming");
  await local.keyboard.down("Space");
  await step(local, 1);
  await local.keyboard.up("Space");
  assert.deepEqual((await state(local)).checkpoint, before.checkpoint);
  assert.equal((await state(local)).pause.phase, "running");

  await evaluate(local, `runtime.game.setMode("single-play", "EASY", {ruleset:"snooker-900"}); runtime.game.update(7);`);
  const timed = await state(local);
  assert.ok(timed.clock.shotSeconds < 14 && timed.clock.shotSeconds > 12);
  await evaluate(local, "runtime.game.pause.request();");
  await step(local, 40);
  assert.deepEqual((await state(local)).checkpoint, timed.checkpoint);
  await local.getByRole("button", { name: "准备继续", exact: true }).click();
  await step(local, 3);
  assert.deepEqual((await state(local)).clock, timed.clock);
  assert.equal(await evaluate(local, "return runtime.game.pause.request();"), false);
  await step(local, 1);
  assert.ok((await state(local)).clock.shotSeconds < timed.clock.shotSeconds);

  await evaluate(local, `runtime.game.setMode("single-play", "EASY", {ruleset:"snooker-900"}); runtime.game.pause.request();`);
  const automatic = await state(local);
  await step(local, 181);
  assert.equal((await state(local)).pause.phase, "resuming");
  await step(local, 2);
  assert.equal((await state(local)).pause.phase, "running");
  assert.deepEqual((await state(local)).clock, automatic.clock);

  await local.selectOption('select[name="mode"]', "rules-test");
  await local.selectOption('select[name="rules"]', "snooker-900");
  await local.locator('.game-options button[type="submit"]').evaluate(button => button.click());
  await step(local, 1);
  assert.ok(Math.abs((await state(local)).clock.shotSeconds - 19) < 1e-6);
  await local.getByRole("button", { name: "菜单", exact: true }).click();
  await local.getByRole("button", { name: "暂停", exact: true }).click();
  assert.deepEqual((await state(local)).pause.used, [1,0]);
  await local.getByRole("button", { name: "准备继续", exact: true }).click();
  await step(local, 3); await step(local, 19);
  assert.equal(await evaluate(local, "return runtime.game.pause.request();"), true);
  assert.deepEqual((await state(local)).pause.used, [1,1]);
  await local.getByRole("button", { name: "准备继续", exact: true }).click();
  await step(local, 3);

  await evaluate(local, `runtime.game.setMode("single-play", "EASY", {openingPlayerIndex:1}); runtime.game.pause.request();`);
  const ai = await state(local);
  await step(local, 20);
  assert.deepEqual((await state(local)).checkpoint, ai.checkpoint);
  await local.getByRole("button", { name: "准备继续", exact: true }).click();
  await step(local, 3);
  const aiPlayed = await evaluate(local, `const {game}=runtime; for(let i=0;i<1200 && game.session.players[1].shootingCount===0;i++)game.update(.0167);
    return game.session.players[1].shootingCount;`);
  assert.equal(aiPlayed, 1);
  await local.close(); pages.pop();

  buildServer(); server = await startServer();
  const a = await openClient(browser, server.info, "pause-smoke", 0, "pause-0"); pages.push(a);
  const b = await openClient(browser, server.info, "pause-smoke", 1, "pause-1"); pages.push(b);
  for (const page of [a,b]) page.on("pageerror", error => errors.push(error.message));
  await a.evaluate(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
  await a.getByRole("button", { name: "请求暂停", exact: true }).click();
  await b.getByRole("button", { name: "同意暂停", exact: true }).waitFor();
  assert.equal(await a.locator(".pause-cover").evaluate(el => el.open), false);
  await b.getByRole("button", { name: "同意暂停", exact: true }).click();
  for (const page of [a,b]) await page.locator(".pause-cover").waitFor({state:"visible"});
  const settled = await readNet(a);
  await a.keyboard.press("Escape"); await a.keyboard.press("w"); await a.keyboard.press("Space");
  assert.deepEqual((await readNet(a)).snapshot.balls, settled.snapshot.balls);
  await a.getByRole("button", { name: "准备继续", exact: true }).click();
  await a.waitForTimeout(300);
  assert.equal(await a.locator(".pause-cover").evaluate(el => el.open), true);
  await b.getByRole("button", { name: "准备继续", exact: true }).click();
  for (const page of [a,b]) await page.locator(".pause-cover").waitFor({state:"hidden"});
  assert.deepEqual((await readNet(a)).snapshot.balls, settled.snapshot.balls);
  assert.deepEqual((await readNet(a)).cameraTarget, settled.cameraTarget);
  try { await aimClient(a); } catch (error) { console.error("RESUME_AIM", JSON.stringify(await readNet(a))); throw error; }
  await shoot(a);
  await b.getByRole("button", { name: "请求暂停", exact: true }).click();
  await a.getByRole("button", { name: "同意暂停", exact: true }).click();
  for (const page of [a,b]) await page.locator(".pause-cover").waitFor({state:"visible",timeout:30000});
  await waitFor(a, () => !window.__snkNet.shotsBusy, 20000, "本杆完整结算");
  assert.equal((await readNet(a)).snapshot.match.shotCount, 1);
  const endA = await readNet(a), endB = await readNet(b);
  assert.deepEqual(endA.snapshot.balls, endB.snapshot.balls);
  assert.equal(endA.snapshot.match.lastShotId, endB.snapshot.match.lastShotId);
  await b.close();
  await a.getByRole("heading", { name: "连接已断开", exact: true }).waitFor();
  assert.equal(await a.getByRole("button", { name: "准备继续", exact: true }).isDisabled(), true);
  const rejoined = await openClient(browser, server.info, "pause-smoke", 1, "pause-rejoin"); pages.push(rejoined);
  await rejoined.locator(".pause-cover").waitFor({state:"visible"});
  await a.getByRole("button", { name: "准备继续", exact: true }).click();
  await a.waitForTimeout(300);
  await rejoined.getByRole("button", { name: "准备继续", exact: true }).click();
  for (const page of [a,rejoined]) await page.locator(".pause-cover").waitFor({state:"hidden"});
  assert.deepEqual((await readNet(rejoined)).snapshot.context, endA.snapshot.context);
  assert.deepEqual(errors, []);
  console.log("PAUSE_SMOKE_OK local: practice/menu/opaque/input/900-budget/auto-resume/two-local-seats/AI; network: consent/ready/countdown/camera/shot-settlement/rejoin");
} finally {
  clearTimeout(timeout);
  await closePages(pages); await stopServer(server); await browser.close();
}
