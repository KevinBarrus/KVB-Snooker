import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => void browser.close(), 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  if (process.env.EXPECT_RULES_TEST === "0") {
    assert.equal(await page.locator('option[value="rules-test"]').count(), 0);
    assert.equal(await page.locator('select[name="test-position"]').count(), 0);
    console.log("Rules test tools are disabled");
  } else {
    await page.evaluate(async () => {
      window.rulesRuntime = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      window.rulesRuntime.engine.stopRenderLoop();
    });
    const advance = count => page.evaluate(count => {
      const { game, balls, scene } = window.rulesRuntime;
      for (let i = 0; i < count; ++i) game.update(1 / 60);
      game.update(0);
      balls.sync(); scene.render();
      return { busy: game.shots.busy, player: game.session.context.playerIndex, rounds: game.session.context.nRounds };
    }, count);
    const snapshot = () => page.evaluate(() => {
      const { game, simulator } = window.rulesRuntime;
      return { context: { ...game.session.context }, players: game.session.players.map(player => ({
        type: player.type, pts: player.pts, brk: player.brk, maxbrk: player.maxbrk, penalty: player.penalty,
        shootingCount: player.shootingCount, scoreCount: player.scoreCount })), result: simulator.getResult(),
        balls: Array.from({ length: simulator.getBallCount() }, (_, index) => simulator.getBallView(index)) };
    });
    await page.selectOption('select[name="mode"]', "rules-test");
    assert.equal(await page.locator('select[name="difficulty"]').isVisible(), false);
    await page.getByRole("button", { name: "加载球局", exact: true }).click(); await advance(0);
    assert.equal((await snapshot()).balls.filter(ball => ball.active).length, 22);
    assert.deepEqual(await page.locator(".score-container .head").allTextContents(), ["玩家 1", "玩家 2"]);
    await page.selectOption('select[name="test-position"]', "last-red");
    await page.getByRole("button", { name: "加载球局", exact: true }).click(); await advance(0);
    const initial = await snapshot();
    assert.equal(initial.balls.filter(ball => ball.active).length, 8);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      game.human.camera.resetWithKissDir(0, -1); game.human.gotoState1(true);
      game.human.strokePower = .4; game.human.stick.setTipPercent(0, -.99);
      game.human.stick.setAngleV(.025 * Math.PI);
    });
    await advance(150);
    await page.locator("canvas").focus(); await page.keyboard.press("Space"); await advance(1);
    assert.equal(await page.getByRole("button", { name: "重置当前球局" }).isEnabled(), false);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.setMode("practice")), false);
    let state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal(state.busy, false);
    const scored = await snapshot();
    assert.equal(scored.players[0].pts, 1, JSON.stringify({ context: scored.context, result: scored.result,
      cue: scored.balls[0].position, red: scored.balls[1].position, players: scored.players }));
    assert.equal(scored.context.ballOn, 252);
    assert.equal(await page.locator(".score-container .left .pts").textContent(), "1");
    await page.selectOption('select[name="test-position"]', "colours");
    await page.getByRole("button", { name: "重置当前球局" }).click(); await advance(0);
    assert.equal(await page.locator('select[name="test-position"]').inputValue(), "last-red");
    assert.deepEqual(await snapshot(), initial);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.replay.clip.available), false);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      game.human.camera.resetWithKissDir(0, 1); game.human.gotoState1(true); game.human.strokePower = .1;
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space");
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal(state.player, 1);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.opponent.active), false);
    await page.keyboard.press("w"); await advance(150); await page.keyboard.press("Space"); await advance(1);
    assert.deepEqual(await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      return { actor: game.shots.launchingController.playerIndex, locked: game.shots.inputLocked,
        view: game.human.camera.shotView.active };
    }), { actor: 1, locked: true, view: true });
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal((await snapshot()).players[1].shootingCount, 1);
    await page.selectOption('select[name="test-position"]', "colours");
    await page.getByRole("button", { name: "加载球局", exact: true }).click(); await advance(0);
    assert.equal((await snapshot()).balls.filter(ball => ball.active).length, 7);
    assert.equal((await snapshot()).context.ballOn, 4);
    await page.selectOption('select[name="mode"]', "practice");
    await page.getByRole("button", { name: "开始新局" }).click(); await advance(0);
    assert.equal((await snapshot()).context.ballOn, 65535);
    assert.equal(await page.locator(".rule-test").isVisible(), false);
    const assets = await readdir("dist/assets");
    for (const file of assets.filter(name => name.endsWith(".js"))) {
      const source = await readFile(`dist/assets/${file}`, "utf8");
      assert(!source.includes("双人规则测试") && !source.includes("last-red"), "Production bundle must exclude dev presets and UI");
    }
    console.log("Rules test passed: local seats, scoring, presets, full reset, input lock, production exclusion");
  }
  assert.deepEqual(errors, []);
} finally { clearTimeout(timeout); await browser.close(); }
