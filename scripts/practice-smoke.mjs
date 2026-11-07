import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

/**
 * 练球球形真实浏览器验收：菜单启动、全台自由摆球、犯规弹窗、复位回滚与不计分模式。
 * 需要 Vite 开发服务（默认 http://127.0.0.1:5173）。
 */
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Practice smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => {
    const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    engine.stopRenderLoop();
  });
  assert.equal(await page.locator(".hud").count(), 1, "Tests must reuse the page entry module");

  const getRuntime = () => page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const active = Array.from({ length: game.simulator.getBallCount() }, (_, index) => game.simulator.getBallView(index))
      .filter(ball => ball.active).length;
    const cue = game.simulator.getCueBallPosition();
    return {
      rounds: game.session.context.nRounds,
      ballOn: game.session.context.ballOn,
      inHand: game.session.context.inHand,
      state: game.session.state,
      shots: game.session.players[0].shootingCount,
      active,
      cue: { x: cue.x, z: cue.z },
      restoreHidden: document.querySelector(".practice-restore")?.hidden,
      restoreDisabled: document.querySelector(".practice-restore")?.disabled,
      choiceHidden: document.querySelector(".practice-choice")?.hidden,
      scoreHidden: document.querySelector(".score-container .left")?.style.display === "none",
      replayOpenHidden: document.querySelector(".replay-open")?.hidden,
      replayOpenDisabled: document.querySelector(".replay-open")?.disabled
    };
  });

  const advance = async count => {
    await page.evaluate(async count => {
      const { game, scene, balls } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      for (let index = 0; index < count; index++) game.update(.0167);
      balls.sync(); scene.render();
    }, count);
    return getRuntime();
  };

  const launchShape = async label => {
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "球形练习", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
    return advance(2);
  };

  const leavePractice = async () => {
    await page.locator(".ingame-menu-trigger").click();
    await page.getByRole("button", { name: "退出练习", exact: true }).click();
  };

  await mkdir(".cache/practice", { recursive: true });

  // 1) 经典蛇彩：菜单启动、22 球、全台自由摆球、犯规弹窗与复位回滚
  let state = await launchShape("经典蛇彩");
  assert.equal(state.state, 4);
  assert.equal(state.ballOn, 2);
  assert.equal(state.inHand, 2);
  assert.equal(state.active, 22);
  assert.equal(state.scoreHidden, false);
  assert.equal(state.restoreHidden, false);
  assert.equal(state.restoreDisabled, true, "No previous shot means restore is disabled");

  const placed = await page.evaluate(async () => {
    const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const ok = game.session.placeCueBall(-0.9, game.simulator.spotY, 0);
    game.controls.inHand.exit();
    return { ok, inHand: game.session.context.inHand };
  });
  assert.deepEqual(placed, { ok: true, inHand: 1 }, "Shape practice must allow full-table cue placement");
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  await advance(120);
  await page.keyboard.press("Space");
  state = await advance(1);
  for (let index = 0; index < 200 && state.rounds === 0; index++) state = await advance(20);
  assert.equal(state.rounds, 1);
  assert.equal(state.choiceHidden, false, "A foul must open the restart/restore choice");
  await page.getByRole("button", { name: "复位", exact: true }).click();
  state = await advance(2);
  assert.equal(state.shots, 0, "Restore must roll back shooting stats");
  assert.equal(state.choiceHidden, true);
  assert.equal(state.restoreDisabled, false, "A restored shot leaves another restore available");
  assert.equal(state.replayOpenHidden, false, "Replay of the restored shot must stay available");
  await page.locator(".practice-restore").click();
  state = await advance(2);
  assert.equal(state.shots, 0);
  await page.screenshot({ path: ".cache/practice/snake.png" });

  // 重新开始 = 重摆回该球形
  await page.locator(".ingame-menu-trigger").click();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  state = await advance(2);
  assert.equal(state.active, 22);
  assert.equal(state.ballOn, 2);
  assert.equal(state.inHand, 2);
  assert.equal(state.shots, 0);
  assert.equal(state.restoreDisabled, true);

  // 2) 清彩：无红球、从黄球开始、不显示比分
  await leavePractice();
  state = await launchShape("清彩练习");
  assert.equal(state.active, 7);
  assert.equal(state.ballOn, 4);
  assert.equal(state.scoreHidden, true, "Clearance practice must not show a score");

  // 3) 五分点：只剩蓝球 + 母球，母球默认绿球点，不计分
  await leavePractice();
  state = await launchShape("五分点练习");
  assert.equal(state.active, 2);
  assert.equal(state.ballOn, 32);
  assert.equal(state.scoreHidden, true);
  assert.ok(Math.abs(state.cue.x + 1.04) < 1e-6 && Math.abs(state.cue.z - .29) < 1e-6,
    "Five-spot cue ball defaults to the green spot");

  // 4) 五分点犯规弹窗与重摆
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  await advance(120);
  await page.keyboard.press("Space");
  state = await advance(1);
  for (let index = 0; index < 200 && state.rounds === 0; index++) state = await advance(20);
  assert.equal(state.rounds, 1);
  if (!state.choiceHidden) {
    await page.getByRole("button", { name: "重摆", exact: true }).click();
    state = await advance(2);
  }
  assert.equal(state.choiceHidden, true);
  assert.equal(state.active, 2);
  assert.equal(state.ballOn, 32);
  await page.screenshot({ path: ".cache/practice/five-spots.png" });

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Practice smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
