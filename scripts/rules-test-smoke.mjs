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
    await advance(0);
    assert.equal(await page.getByRole("combobox", { name: "提名目标球" }).isVisible(), true);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      for (let i = 0; i < 32; ++i) {
        const angle = i * Math.PI / 16;
        if (game.session.getNomination(Math.sin(angle), Math.cos(angle)).ballIndex === null) {
          game.human.camera.resetWithKissDir(Math.sin(angle), Math.cos(angle)); break;
        }
      }
      game.human.gotoState1(true);
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space"); await advance(0);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.shots.busy), false);
    await page.getByRole("combobox", { name: "提名目标球" }).selectOption("21");
    await page.keyboard.press("Space"); await advance(1);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.session.context.nominatedBallIndex), 21);
    assert.equal(await page.getByRole("combobox", { name: "提名目标球" }).isEnabled(), false);
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
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
    assert.equal(await page.locator(".rule-choice").isVisible(), true);
    await page.locator("canvas").focus(); await page.keyboard.press("w"); await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.shots.busy), false);
    const restore = page.getByRole("button", { name: "复位，让对手重打", exact: true });
    assert.equal(await restore.isVisible(), true);
    assert.equal(await page.locator(".hud .message-box .box-head").textContent(), "FOUL AND A MISS");
    const penalty = await page.evaluate(() => window.rulesRuntime.game.session.getScore(1));
    await restore.click(); await advance(0);
    const restored = await snapshot();
    assert.deepEqual(restored.balls, initial.balls);
    assert.equal(restored.context.playerIndex, 0); assert.equal(restored.context.nRounds, 1);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.session.getScore(1)), penalty);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.replay.clip.available), false);
    assert.equal(restored.result.firstKissIndex, 0);
    assert.equal(await restore.isVisible(), false);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      game.human.camera.resetWithKissDir(0, 1); game.human.gotoState1(true); game.human.strokePower = .1;
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space");
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    await page.getByRole("button", { name: "自己接手", exact: true }).click(); await advance(0);
    assert.equal(await page.locator(".rule-choice").isVisible(), false);
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
    await page.evaluate(() => {
      const { game, simulator } = window.rulesRuntime;
      game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup: {
        balls: Array.from({ length: simulator.getBallCount() }, (_, index) => ({ index,
          x: index === 0 ? -1.2 : 1.42, z: 0, active: index === 0 || index === 21 })),
        ballOn: 128, inHand: 0, playerIndex: 0, scores: [7, 0]
      } });
      game.human.camera.resetWithKissDir(0, 1); game.human.gotoState1(true); game.human.strokePower = .1;
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space");
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    const black = await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      return { decision: game.session.decision, player: game.session.context.playerIndex, inHand: game.session.context.inHand,
        scores: [game.session.getScore(0), game.session.getScore(1)], finished: game.session.finished };
    });
    assert.equal(black.decision, null); assert.equal(black.inHand, 2);
    assert.deepEqual(black.scores, [7, 7]); assert.equal(black.finished, false);
    assert.equal(black.player, 1);
    assert.equal(await page.locator(".rule-choice").isVisible(), false);
    await page.evaluate(() => {
      const { game, simulator } = window.rulesRuntime;
      const locations = { 0: [0, .2], 1: [.6, .2], 21: [.15, .2], 16: [-.9, .5] };
      game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup: {
        balls: Array.from({ length: simulator.getBallCount() }, (_, index) => ({ index,
          x: locations[index]?.[0] ?? 1, z: locations[index]?.[1] ?? 0, active: index in locations })),
        ballOn: 2, inHand: 0, playerIndex: 0, scores: [0, 0]
      } });
      game.human.camera.resetWithKissDir(0, 1); game.human.gotoState1(true); game.human.strokePower = 0;
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space");
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.session.freeBallAvailable), true);
    assert.match(await page.locator(".rule-choice").textContent(), /自由球/);
    await page.getByRole("button", { name: "自己接手", exact: true }).click(); await advance(0);
    const nominationSelect = page.getByRole("combobox", { name: "提名目标球" });
    assert.equal(await nominationSelect.locator('option[value="1"]').count(), 0);
    await nominationSelect.selectOption("21"); await advance(0);
    assert.match(await page.locator(".nomination").textContent(), /自由球：黑球，按 1 分计/);
    await page.keyboard.press("w"); await advance(150); await page.keyboard.press("Space"); await advance(1);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.session.context.freeBallIndex), 21);
    assert.equal(await nominationSelect.isEnabled(), false);
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    await page.selectOption('select[name="mode"]', "practice");
    await page.getByRole("button", { name: "开始新局" }).click(); await advance(0);
    assert.equal((await snapshot()).context.ballOn, 65535);
    assert.equal(await page.locator(".rule-test").isVisible(), false);
    await page.selectOption('select[name="mode"]', "rules-test");
    await page.selectOption('select[name="test-position"]', "black-tie");
    await page.getByRole("button", { name: "加载球局", exact: true }).click(); await advance(0);
    const blackInitial = await snapshot();
    assert.deepEqual(blackInitial.players.map(player => player.pts), [0, 7]);
    assert.equal(blackInitial.balls.filter(ball => ball.active).length, 2);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      game.human.camera.resetWithKissDir(Math.SQRT1_2, Math.SQRT1_2); game.human.gotoState1(true);
      game.human.strokePower = .55; game.human.stick.setTipPercent(0, -.99); game.human.stick.setAngleV(.025 * Math.PI);
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space");
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.deepEqual(await page.evaluate(() => {
      const game = window.rulesRuntime.game;
      return [game.session.getScore(0), game.session.getScore(1), game.session.context.playerIndex, game.session.context.inHand];
    }), [7, 7, 1, 2]);
    await page.getByRole("button", { name: "重置当前球局" }).click(); await advance(0);
    assert.deepEqual(await snapshot(), blackInitial);
    await page.evaluate(() => {
      const { game, simulator } = window.rulesRuntime;
      game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup: {
        balls: Array.from({ length: simulator.getBallCount() }, (_, index) => ({ index,
          x: index === 21 ? .8 : 0, z: index === 1 ? .2525 : .2, active: [0, 1, 21].includes(index) })),
        ballOn: 2, inHand: 0, playerIndex: 0, scores: [0, 0]
      } });
    });
    await advance(0);
    const touching = page.locator(".touching-notice");
    assert.equal(await touching.isVisible(), true);
    assert.match(await touching.textContent(), /TOUCHING BALL.*red/);
    assert.doesNotMatch(await touching.textContent(), /[\u3400-\u9fff]/);
    const box = await touching.boundingBox();
    assert(Math.abs(box.x + box.width / 2 - 720) < 2 && box.y > 150 && box.y < 450);
    const beforeDismiss = await snapshot();
    await touching.getByRole("button", { name: "Close touching ball notice" }).click();
    assert.equal(await touching.isVisible(), false);
    assert.equal(await page.locator("canvas").evaluate(canvas => document.activeElement === canvas), true);
    await advance(900);
    assert.equal(await touching.isVisible(), false, "A dismissed notice must not reappear on each frame");
    assert.deepEqual(await snapshot(), beforeDismiss);
    await page.evaluate(() => {
      const { game, simulator } = window.rulesRuntime;
      const setup = { balls: Array.from({ length: simulator.getBallCount() }, (_, index) => {
        const ball = simulator.getBallView(index);
        return { index, x: ball.position.x, z: ball.position.z, active: ball.active };
      }), ballOn: 2, inHand: 0, playerIndex: 0, scores: [0, 0] };
      if (!game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup })) throw new Error("Could not reload touching setup");
    });
    await advance(0);
    assert.equal(await touching.isVisible(), true, "Loading a new position re-arms its notice");
    await advance(900);
    assert.equal(await touching.isVisible(), false, "Notice must expire before the player shoots");
    await advance(120);
    assert.equal(await touching.isVisible(), false);
    await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      game.human.camera.resetWithKissDir(0, -1); game.human.gotoState1(true); game.human.strokePower = .4;
    });
    await advance(150); await page.locator("canvas").focus(); await page.keyboard.press("Space"); await advance(1);
    assert.equal(await touching.isVisible(), false);
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.session.result.foulCode), 8);
    assert.equal(await restore.isVisible(), false, "Playing away from touching red then in-off is an ordinary foul");
    assert.match(await page.locator(".rule-choice").textContent(), /D 区手中球/);
    await page.selectOption('select[name="mode"]', "practice");
    await page.getByRole("button", { name: "开始新局" }).click(); await advance(0);
    await page.evaluate(() => {
      const { simulator } = window.rulesRuntime;
      simulator.respotIndexXYZ(0, 0, simulator.spotY, .2);
      simulator.respotIndexXYZ(1, 0, simulator.spotY, .2525);
      simulator.reset(false, true);
    });
    await advance(0); assert.equal(await touching.isVisible(), false);
    await page.selectOption('select[name="mode"]', "single-play");
    for (const expected of [0, 1, 0]) {
      await page.getByRole("button", { name: "开始新局" }).click(); await advance(0);
      assert.equal((await snapshot()).context.playerIndex, expected, "Mid-frame restart alternates the opener");
      assert.equal(await page.evaluate(() => window.rulesRuntime.game.opponent.active), expected === 1);
      if (expected === 1) {
        await page.selectOption('select[name="mode"]', "rules-test");
        await page.getByRole("button", { name: "加载球局", exact: true }).click(); await advance(0);
        await page.getByRole("button", { name: "重置当前球局" }).click(); await advance(0);
        await page.selectOption('select[name="mode"]', "single-play");
      }
    }
    await page.evaluate(async () => {
      const { game } = window.rulesRuntime;
      const { makeRuleTestSetup } = await import("/src/devtools/presets.ts");
      game.setMode("single-play", "EASY", { setup: { ...makeRuleTestSetup("colours"), playerIndex: 1 } });
      game.human.camera.lookTo(1.1, .5, true);
      game.opponent.camera.resetWithKissDir(0, -1); game.opponent.gotoState1(true); game.opponent.strokePower = 0;
      for (let i = 0; i < 150; ++i) game.opponent.update(1 / 60);
      if (!game.shots.launch(game.opponent)) throw new Error("Could not launch AI fixture shot");
    });
    state = await advance(60);
    for (let i = 0; i < 200 && state.busy; ++i) state = await advance(30);
    assert.equal(await restore.isVisible(), true);
    await restore.click(); await advance(0);
    assert.equal((await snapshot()).context.playerIndex, 1);
    assert.equal(await page.evaluate(() => window.rulesRuntime.game.human.camera.shotView.active), false);
    const resumed = await page.evaluate(() => {
      const { game } = window.rulesRuntime;
      for (let i = 0; i < 5000 && game.session.players[1].shootingCount === 1; ++i) game.update(1 / 60);
      return { count: game.session.players[1].shootingCount, observer: game.human.camera.shotView.active };
    });
    assert.deepEqual(resumed, { count: 2, observer: false }, "AI must restart its search after replacement without taking over the camera");
    const assets = await readdir("dist/assets");
    for (const file of assets.filter(name => name.endsWith(".js"))) {
      const source = await readFile(`dist/assets/${file}`, "utf8");
      assert(!source.includes("双人规则测试") && !source.includes("last-red") && !source.includes("black-tie"), "Production bundle must exclude dev presets and UI");
    }
    console.log("Rules test passed: local seats, scoring, presets, full reset, foul choice, nomination, free ball, respotted black, input lock, Miss restoration, touching notice, restart rotation, production exclusion");
  }
  assert.deepEqual(errors, []);
} finally { clearTimeout(timeout); await browser.close(); }
