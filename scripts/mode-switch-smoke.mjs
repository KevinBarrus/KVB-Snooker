import assert from "node:assert/strict";
import { chromium } from "playwright-core";

/** 退出尚未触球的人机对局后，新开的双人比赛必须是全新 GameSession，不能沿用旧对局。 */
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Mode switch smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await page.evaluate(async () => {
    window.modeSwitchRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
  });

  await page.getByRole("button", { name: "AI 对战", exact: true }).click();
  await page.getByRole("button", { name: "经典斯诺克", exact: true }).click();
  await page.getByRole("button", { name: "normal", exact: true }).click();
  await page.getByRole("button", { name: "开始比赛", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.modeSwitchRuntime.game.human.gotoState1(true));
  await page.waitForFunction(() => window.modeSwitchRuntime.game.human.isReadyToStroke(), undefined, { timeout: 10000 });

  const pendingExit = await page.evaluate(() => {
    const game = window.modeSwitchRuntime.game;
    const launched = game.shots.launch(game.human);
    document.querySelector(".ingame-menu-trigger").click();
    [...document.querySelectorAll(".ingame-action-btn")]
      .find(button => button.textContent.includes("退出对局"))?.click();
    return { launched, pendingShot: game.pendingShot };
  });
  assert.equal(pendingExit.launched, true, "出杆应已开始");
  assert.equal(pendingExit.pendingShot, true, "退出前应处于尚未触球的 pending 状态");

  await page.waitForFunction(() => !document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await page.waitForFunction(() => window.modeSwitchRuntime.game.isSuspended, undefined, { timeout: 10000 });
  await page.waitForTimeout(100);
  const afterExit = await page.evaluate(() => ({
    pendingShot: window.modeSwitchRuntime.game.pendingShot,
    canReset: window.modeSwitchRuntime.game.canReset
  }));
  assert.equal(afterExit.pendingShot, false, "回到主菜单必须清理未触球出杆");
  assert.equal(afterExit.canReset, true, "退出菜单后必须允许开始新对局");

  await page.getByRole("button", { name: "双人对战", exact: true }).click();
  await page.getByRole("button", { name: "创建比赛", exact: true }).click();
  await page.getByRole("button", { name: "经典斯诺克", exact: true }).click();
  await page.locator(".menu-frames-select").selectOption("1");
  await page.getByRole("button", { name: "生成比赛 ID", exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "进入比赛", exact: true }).click();
  await page.waitForTimeout(600);

  const switched = await page.evaluate(() => {
    const game = window.modeSwitchRuntime.game;
    return {
      mode: game.session.mode,
      players: game.session.players.map(player => player.type),
      scores: [game.session.getScore(0), game.session.getScore(1)],
      pendingShot: game.pendingShot,
      suspended: game.isSuspended,
      menuHidden: document.querySelector(".game-menu-main").hidden
    };
  });
  assert.equal(switched.mode, "single-play");
  assert.deepEqual(switched.players, ["USER", "USER"], "新比赛必须是双人对局，而不是旧的人机对局");
  assert.deepEqual(switched.scores, [0, 0]);
  assert.equal(switched.pendingShot, false);
  assert.equal(switched.suspended, false);
  assert.equal(switched.menuHidden, true);

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Mode switch smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
