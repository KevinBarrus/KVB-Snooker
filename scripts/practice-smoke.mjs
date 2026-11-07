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
    const { game, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const originMesh = scene.getMeshByName("respot-origin");
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
      replayOpenDisabled: document.querySelector(".replay-open")?.disabled,
      cueBallRedDots: game.cueBallRedDots,
      origin: originMesh ? { x: originMesh.position.x, z: originMesh.position.z } : null
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

  const launchShape = async (label, style = "经典母球") => {
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "球形练习", exact: true }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: style, exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
    return advance(2);
  };

  const leavePractice = async () => {
    await page.locator(".ingame-menu-trigger").click();
    await page.getByRole("button", { name: "退出练习", exact: true }).click();
    await page.getByRole("button", { name: "确认退出", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  };

  const shootUntilSessionReplaced = async () => {
    await page.evaluate(async () => {
      const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      window.__practiceSession = game.session;
    });
    await page.locator("canvas").focus();
    await page.keyboard.press("w");
    await advance(120);
    await page.keyboard.press("Space");
    let replaced = false;
    for (let index = 0; index < 200 && !replaced; index++) {
      await advance(10);
      replaced = await page.evaluate(async () => {
        const { game } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
        return game.session !== window.__practiceSession;
      });
    }
    assert.equal(replaced, true, "Five-spot practice must reset automatically after every shot");
    return advance(2);
  };

  await mkdir(".cache/practice", { recursive: true });

  // 1) 经典蛇彩：菜单启动、红点母球选择、22 球、全台自由摆球、犯规弹窗与复位回滚
  let state = await launchShape("经典蛇彩", "红点母球");
  assert.equal(state.state, 4);
  assert.equal(state.ballOn, 2);
  assert.equal(state.inHand, 2);
  assert.equal(state.active, 22);
  assert.equal(state.scoreHidden, false);
  assert.equal(state.cueBallRedDots, true);
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
  const boxes = await page.evaluate(() => {
    const restore = document.querySelector(".practice-restore").getBoundingClientRect();
    const replay = document.querySelector(".replay-open").getBoundingClientRect();
    return { restore: { left: restore.left, top: restore.top, right: restore.right, bottom: restore.bottom },
      replay: { left: replay.left, top: replay.top, right: replay.right, bottom: replay.bottom } };
  });
  assert.ok(boxes.restore.right <= boxes.replay.left || boxes.restore.bottom <= boxes.replay.top ||
    boxes.replay.right <= boxes.restore.left || boxes.replay.bottom <= boxes.restore.top,
    "Restore button must not overlap the replay button");
  await page.locator(".practice-restore").click();
  state = await advance(2);
  assert.equal(state.shots, 0);
  await page.screenshot({ path: ".cache/practice/snake.png" });

  // 退出练习必须先确认；取消后仍停留在对局
  await page.locator(".ingame-menu-trigger").click();
  await page.getByRole("button", { name: "退出练习", exact: true }).click();
  assert.equal(await page.locator(".game-menu-main").isHidden(), true, "Exit must wait for confirmation");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator(".game-menu-main").isHidden(), true, "Cancel keeps the practice running");

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
  assert.equal(state.cueBallRedDots, false);

  // 3) 五分点：只剩蓝球 + 母球，母球默认绿球点，不计分
  await leavePractice();
  state = await launchShape("五分点练习");
  assert.equal(state.active, 2);
  assert.equal(state.ballOn, 32);
  assert.equal(state.scoreHidden, true);
  assert.ok(Math.abs(state.cue.x + 1.04) < 1e-6 && Math.abs(state.cue.z - .29) < 1e-6,
    "Five-spot cue ball defaults to the green spot");
  assert.ok(state.origin && Math.abs(state.origin.x - state.cue.x) < 1e-6 && Math.abs(state.origin.z - state.cue.z) < 1e-6,
    "Placement ring must follow the cue ball instead of the previous mode's default");

  // 4) 五分点：每一杆后自动复位蓝球与母球，不产生犯规弹窗
  state = await shootUntilSessionReplaced();
  assert.equal(state.choiceHidden, true);
  assert.equal(state.active, 2);
  assert.equal(state.ballOn, 32);
  assert.equal(state.inHand, 2);
  assert.equal(state.rounds, 0);
  assert.ok(Math.abs(state.cue.x + 1.04) < 1e-6 && Math.abs(state.cue.z - .29) < 1e-6);
  assert.equal(state.cueBallRedDots, false);
  await page.screenshot({ path: ".cache/practice/five-spots.png" });

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Practice smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
