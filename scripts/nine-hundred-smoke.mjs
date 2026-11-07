import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(
() => { console.error("900 smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const clickOptionsButton = async (name, exact = false) => page.evaluate(({ name, exact }) => {
    const buttons = [...document.querySelectorAll(".game-options button")];
    const target = buttons.find(button => exact ? button.textContent.trim() === name : button.textContent.includes(name));
    if (!target) throw new Error(`Missing game-options button: ${name}`);
    target.click();
  }, { name, exact });

  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  const load = async () => {
    await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
    await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
    await page.evaluate(async () => {
      const { engine } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
      engine.stopRenderLoop();
    });
  };
  const advance = async (count, dt = 1 / 60, stopAfterRound = false) => page.evaluate(async ({ count, dt, stopAfterRound }) => {
    const { game, balls, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const round = game.session.context.nRounds;
    for (let i = 0; i < count; ++i) {
      game.update(dt);
      if (stopAfterRound && game.session.context.nRounds !== round) break;
    }
    balls.sync(); scene.render();
    return { clock: game.session.clock, player: game.session.context.playerIndex, inHand: game.session.context.inHand,
      foul: game.session.result.foulCode, round: game.session.context.nRounds, busy: game.shots.busy,
      shots: game.session.players.map(player => player.shootingCount), ready: game.human.isReadyToStroke(),
      placement: game.controls.inHand.active, finished: game.session.finished, state: game.session.state };
  }, { count, dt, stopAfterRound });
  const start = async (mode = "single-play") => {
    await page.selectOption('select[name="mode"]', mode);
    await page.selectOption('select[name="rules"]', "snooker-900");
    await page.locator('.game-options button[type="submit"]').evaluate(button => button.click());
    return advance(1, 0);
  };
  const press = async key => { await page.locator("canvas").focus(); await page.keyboard.press(key); };
  await load();
  let state = await start();
  const progress = () => page.locator(".match-clock").evaluate(element => {
    const bar = element.querySelector(".match-clock-progress");
    const fill = bar.querySelector(".match-clock-fill");
    const bounds = element.getBoundingClientRect();
    const score = document.querySelector(".score-container").getBoundingClientRect();
    const ratio = fill ? parseFloat((fill.style.transform.match(/scaleX\(([^)]+)\)/) ?? [])[1] ?? "NaN") : null;
    return { ratio, color: fill ? getComputedStyle(fill).backgroundColor : null,
      warn: bar.classList.contains("warn"), urgent: bar.classList.contains("urgent"),
      belowScore: bounds.top >= score.bottom, height: bar.getBoundingClientRect().height };
  });
  assert.deepEqual(await progress(), { ratio: 1, color: "rgb(74, 222, 128)", warn: false, urgent: false, belowScore: true, height: 10 });
  await mkdir(".cache/900", { recursive: true });
  await page.screenshot({ path: ".cache/900/green.png" });
  assert.deepEqual(state.clock, { frameSeconds: 900, shotSeconds: 20, phase: "placement", shootout: false });
  assert.equal(state.placement, true, "a new match opens with the cue ball waiting to be placed");
  assert.equal(await page.evaluate(async () => (await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime).scene.getMeshByName("respot-origin").isVisible), true);
  state = await advance(60);
  assert.ok(Math.abs(state.clock.frameSeconds - 899) < 1e-6);
  assert.ok(Math.abs(state.clock.shotSeconds - 19) < 1e-6);
  await press("w"); state = await advance(120);
  assert.equal(state.ready, true, "default opening must still allow W and close the placement mode");
  await press("Space"); state = await advance(60);
  assert.equal(state.shots[0], 1, "Space must apply an actual stroke");
  assert.equal(state.clock.phase, "rolling");
  const remainingShot = state.clock.shotSeconds, remainingFrame = state.clock.frameSeconds;
  const stoppedBar = await progress();
  state = await advance(10);
  assert.deepEqual(await progress(), stoppedBar);
  assert.equal(state.clock.shotSeconds, remainingShot);
  assert.ok(state.clock.frameSeconds < remainingFrame);
  state = await advance(2400, 1 / 60, true);
  assert.equal(state.round, 1);
  assert.equal(state.busy, false);
  assert.equal(state.clock.shotSeconds, 20);

  state = await start();
  assert.equal(state.player, 1, "second formal frame must open with AI");
  const aiOpening = await page.evaluate(async () => {
    const { game, simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    let distance = Infinity;
    const off = game.bus.on("sim/shooting-start", () => {
      const p = game.opponent.stick.kissPoint, cue = simulator.getCueBallPosition();
      distance = Math.hypot(p.x - cue.x, p.y - cue.y, p.z - cue.z);
    });
    for (let i = 0; i < 1200 && game.session.players[1].shootingCount === 0; ++i) game.update(1 / 60);
    off();
    return { distance, shots: game.session.players[1].shootingCount };
  });
  assert.equal(aiOpening.shots, 1);
  assert.ok(aiOpening.distance < .04, `AI cue must touch cue ball: ${aiOpening.distance}`);
  await advance(2400, 1 / 60, true);

  await load();
  await start();
  state = await advance(1, 17.01);
  await page.waitForTimeout(600);
  assert.ok(Math.abs((await progress()).ratio - 0.1495) < 0.01, `urgent bar must shrink continuously: ${(await progress()).ratio}`);
  assert.equal((await progress()).color, "rgb(248, 113, 113)");
  assert.equal((await progress()).urgent, true);
  await page.screenshot({ path: ".cache/900/red.png" });
  state = await advance(1, 3);
  assert.equal(state.foul, 128);
  assert.equal(state.player, 1);
  assert.equal(state.clock.phase, "aiming", "AI must confirm after placement");
  const afterPlacement = await page.evaluate(async () => {
    const { game, simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const cue = simulator.getCueBallPosition();
    const target = game.opponent.stick.kissPoint;
    return { distance: Math.hypot(cue.x - target.x, cue.y - target.y, cue.z - target.z),
      hand: game.session.context.inHand, score: game.session.getScore(1) };
  });
  assert.equal(afterPlacement.hand, 1);
  assert.equal(afterPlacement.score, 4);
  assert.ok(afterPlacement.distance < .04, `AI must re-anchor after placing: ${afterPlacement.distance}`);
  assert.match(await page.locator(".hud .message-box").first().textContent(), /FOUL/);

  await load();
  state = await start("rules-test");
  assert.ok(state.clock, "two-human rules test must honor the selected 900 ruleset");
  await press("p"); state = await advance(8 * 60);
  assert.equal(state.placement, true);
  assert.ok(Math.abs(state.clock.shotSeconds - 12) < 1e-6);
  await press("p"); state = await advance(1, 0);
  assert.equal(state.placement, false);
  assert.equal(state.clock.phase, "aiming");
  assert.ok(Math.abs(state.clock.shotSeconds - 12) < 1e-6);
  await press("p"); await press("Escape");
  state = await advance(1, 12.001);
  assert.equal(state.player, 1);
  assert.equal(state.foul, 128);
  assert.equal(state.placement, true, "next local player gets a visible timed placement workflow");
  const invalid = await page.evaluate(async () => {
    const { game, simulator } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    simulator.resetBallPosition(simulator.getBallAtIndex(0), null);
    game.controls.inHand.enter();
    game.update(0);
    const entered = { active: game.controls.inHand.active, visible: game.controls.inHand.visible,
      phase: game.session.clock.phase };
    simulator.respotIndexXYZ(0, -1.04, simulator.spotY, -0.145);
    return entered;
  });
  assert.deepEqual(invalid, { active: true, visible: false, phase: "placement" },
    "no automatic candidate before the mouse points at the table");
  await press("w"); state = await advance(120);
  assert.equal(state.ready, true, "W confirms a legal current cue position before aiming");
  await press("Space"); state = await advance(60);
  assert.equal(state.shots[1], 1, "second local player must also strike");
  await advance(2400, 1 / 60, true);
  await page.selectOption('select[name="rules"]', "classic");
  await clickOptionsButton("重置当前球局");
  state = await advance(1, 0);
  assert.ok(state.clock, "reset retains the loaded ruleset, not the unsubmitted dropdown");
  assert.equal(state.clock.shotSeconds, 20);
  await mkdir(".cache/900", { recursive: true });
  await page.screenshot({ path: ".cache/900/game.png" });

  const finalBlack = await page.evaluate(async () => {
    const { game, simulator: sim, scene } = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const { makeStrokeVars } = await import("/src/core/ai/stroke.ts");
    const black = sim.getBalls().find(ball => ball.number === 7).index;
    const setup = { balls: sim.getBalls().map(ball => ({ index: ball.index,
      x: ball.index === 0 ? -1 : ball.spot.x, z: ball.index === 0 ? .4 : ball.spot.z,
      active: ball.index === 0 || ball.index === black })), scores: [60, 64], playerIndex: 1, inHand: 0, ballOn: 128 };
    if (!game.setMode("single-play", "NORMAL", { ruleset: "snooker-900", players: ["USER", "USER"], setup })) throw new Error("Cannot start final-black fixture");
    game.session.stroke(1, makeStrokeVars(sim, { dx: -1, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 1 }));
    game.session.advanceTime(498);
    for (let i = 0; i < 3000 && game.session.context.nRounds === 0; ++i) game.update(1 / 60);
    scene.render();
    return { finished: game.session.finished, winner: game.session.winnerIndex, score: game.session.players.map((_, i) => game.session.getScore(i)),
      ballOn: game.session.context.ballOn, player: game.session.context.playerIndex, inHand: game.session.context.inHand,
      placement: game.controls.inHand.active, legalBeyondD: game.session.canPlaceCueBall(1.2, sim.spotY, .5),
      phase: game.session.clock.phase, output: document.querySelector("output").textContent };
  });
  assert.deepEqual(finalBlack.score, [67, 64]);
  assert.equal(finalBlack.finished, false);
  assert.equal(finalBlack.winner, null);
  assert.equal(finalBlack.ballOn, 128);
  assert.equal(finalBlack.player, 0);
  assert.equal(finalBlack.inHand, 2);
  assert.equal(finalBlack.placement, true);
  assert.equal(finalBlack.legalBeyondD, true);
  assert.doesNotMatch(finalBlack.output, /本局结束/);
  const boundaries = await page.evaluate(async () => {
    const { MatchClock, MatchClockDom } = await import("/src/ui/match-clock.ts");
    const clock = new MatchClock(), dom = new MatchClockDom();
    document.body.append(dom.element);
    const results = [];
    for (const seconds of [20, 19, 8, 3.001, 3, 0]) {
      clock.sync({ frameSeconds: 300, shotSeconds: seconds, phase: "aiming", shootout: false }); dom.sync(clock);
      await new Promise(resolve => setTimeout(resolve, 500));
      const bar = dom.element.querySelector(".match-clock-progress");
      const fill = bar.querySelector(".match-clock-fill");
      results.push({ ratio: parseFloat((fill.style.transform.match(/scaleX\(([^)]+)\)/) ?? [])[1] ?? "NaN"),
        color: getComputedStyle(fill).backgroundColor, warn: bar.classList.contains("warn"),
        urgent: bar.classList.contains("urgent"), value: bar.getAttribute("aria-valuenow") });
    }
    dom.element.remove(); return results;
  });
  assert.deepEqual(boundaries, [
    { ratio: 1, color: "rgb(74, 222, 128)", warn: false, urgent: false, value: "20" },
    { ratio: 0.95, color: "rgb(74, 222, 128)", warn: false, urgent: false, value: "19" },
    { ratio: 0.4, color: "rgb(251, 191, 36)", warn: true, urgent: false, value: "8" },
    { ratio: 0.15005, color: "rgb(251, 191, 36)", warn: true, urgent: false, value: "3.001" },
    { ratio: 0.15, color: "rgb(248, 113, 113)", warn: false, urgent: true, value: "3" },
    { ratio: 0, color: "rgb(248, 113, 113)", warn: false, urgent: true, value: "0" }
  ]);

  await page.selectOption('select[name="mode"]', "practice");
  await page.locator('.game-options button[type="submit"]').evaluate(button => button.click());
  state = await advance(1, 0);
  assert.equal(state.clock, null);
  assert.equal(await page.locator(".match-clock").evaluate(node => node.hidden), true);
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("900 smoke passed: direct opening, rolling/shot clocks, AI re-anchor, timed placement, two-human play, final-black foul continuation and green/red progress bar");
} finally { clearTimeout(timeout); await browser.close(); }
