import { describe, expect, it } from "vitest";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { MatchProgress } from "../../src/core/match-progress.js";
import { SeededRandom } from "../../src/core/rng.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makePocketTable } from "../fixtures/table.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import type { GameCheckpoint } from "../../src/core/game-checkpoint.js";

const balls = [0, 0, .15, 1, 0, -.55, 1, 1, 0, 2, -1.04, -.29, 5, 1.6, 0, 7, 1.42, 0];
function sim(ballSet = balls): Simulator { return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet }); }
function json<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function shot(game: GameSession, dx = 0, dz = -1, speed?: number): void {
  const vars = makeStrokeVars(game.simulator, { dx, dy: 0, dz, fbSpin: -.99, powerFactor: .1, priority: 1 });
  if (speed !== undefined) vars[6] = speed;
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  for (let n = 0; game.state === GAME_STATE.SIMULATING && n < 2000; n++) game.step(.1);
  expect(game.state).not.toBe(GAME_STATE.SIMULATING);
}
function restored(game: GameSession, ballSet = balls): GameSession {
  const data = json(game.exportCheckpoint());
  const next = GameSession.fromCheckpoint(sim(ballSet), data);
  expect(next.exportCheckpoint()).toEqual(data);
  return next;
}

describe("完整单局检查点", () => {
  it("JSON恢复连续得分、手选彩球、入袋球姿态，随后同一杆结算完全相同", () => {
    const game = new GameSession(sim());
    shot(game);
    expect(game.result.score).toBe(1);
    expect(game.nominate(0, 3)).toBe(true);
    const next = restored(game);
    expect(next.players[0].brk).toBe(1);
    expect(next.getNomination(1, 0)).toEqual({ required: true, ballIndex: 3, manual: true });
    expect(next.simulator.getBallView(1)).toEqual(game.simulator.getBallView(1));
    shot(game, 1, 0, 0); shot(next, 1, 0, 0);
    expect(next.exportCheckpoint()).toEqual(game.exportCheckpoint());
  });

  it("Miss待选择、自由球与提名可恢复，复位保留罚分并回到原球权", () => {
    const ballSet = [0, 0, .2, 1, .6, .2, 7, .15, .2];
    const game = new GameSession(sim(ballSet), "single-play", { players: ["USER", "USER"] });
    const before = game.simulator.serialize();
    shot(game, 1, 0, 0);
    expect(game.decision).toMatchObject({ playerIndex: 1, canReplace: true });
    expect(game.freeBallAvailable).toBe(true);
    const next = restored(game, ballSet);
    expect(next.restorePreviousShot(1)).toBe(true);
    expect(next.simulator.serialize()).toEqual(before);
    expect(next.getScore(1)).toBe(4);
    expect(next.context.playerIndex).toBe(0);
    const take = restored(game, ballSet);
    expect(take.chooseNextPlayer(1, 1)).toBe(true);
    expect(take.nominate(1, 2)).toBe(true);
    const nominated = restored(take, ballSet);
    expect(nominated.freeBallAvailable).toBe(true);
    expect(nominated.getNomination(1, 0).ballIndex).toBe(2);
    expect(nominated.restorePreviousShot(1)).toBe(false);
  });

  it("贴球几何恢复后仍能打离合法球，接触证据不依赖旧引用", () => {
    const ballSet = [0, 0, .2, 1, .0525, .2, 7, 1.4, 0];
    const game = new GameSession(sim(ballSet));
    const next = restored(game, ballSet);
    expect(next.touchingBallIndices).toEqual([1]);
    shot(game, -1, 0, 1); shot(next, -1, 0, 1);
    expect(next.result).toEqual(game.result);
    expect(next.result.foulCode).toBe(0);
    expect(restored(next, ballSet).simulator.getContactEvidence()).toEqual(game.simulator.getContactEvidence());
  });

  it("900剩余时间、全台手中球与再次超时判罚一致，不因恢复补时", () => {
    const game = new GameSession(sim(), "single-play", { ruleset: "snooker-900" });
    game.advanceTime(20);
    game.advanceTime(7.25);
    const next = restored(game);
    expect(next.clock).toMatchObject({ frameSeconds: 872.75, shotSeconds: 12.75, phase: "placement" });
    expect(next.canPlaceCueBall(1.6, next.simulator.spotY, .5)).toBe(true);
    expect(next.advanceTime(12.75)).toBe("shot");
    game.advanceTime(12.75);
    expect(next.exportCheckpoint()).toEqual(game.exportCheckpoint());
  });

  it("蓝球决胜保存双方不等次数，恢复后继续相同轮次而非提前判胜", () => {
    const ballSet = [0, -1.04, -.145, 1, 0, -.55, 5, 1.6, 0];
    const game = new GameSession(sim(ballSet), "single-play", { ruleset: "snooker-900" });
    for (let index = 0; index < 45; index++) game.advanceTime(20);
    expect(game.shootout).toEqual({ attempts: [0, 0], potted: [0, 0] });
    game.advanceTime(20);
    expect(game.shootout?.attempts).toEqual([0, 1]);
    const next = restored(game, ballSet);
    next.advanceTime(20); game.advanceTime(20);
    expect(next.shootout).toEqual({ attempts: [1, 1], potted: [0, 0] });
    expect(next.finished).toBe(false);
    expect(next.exportCheckpoint()).toEqual(game.exportCheckpoint());
  });

  it("练习完整恢复保留预设和复位语义，重置不遗失配置", () => {
    const setup = { balls: balls.filter((_, index) => index % 3 === 0).map((_, index) => ({ index,
      x: balls[index * 3 + 1], z: balls[index * 3 + 2], active: index !== 2 })),
      ballOn: 2, inHand: 0 as const, playerIndex: 0, scores: [0] };
    const game = new GameSession(sim(), "practice", { setup, practice: { freeScoring: true, respotColoursAfterReds: true } });
    const initial = game.exportCheckpoint();
    shot(game);
    expect(game.players[0].pts).toBe(1);
    const next = restored(game);
    expect(next.restorePreviousShot(0)).toBe(true);
    expect(next.players[0].pts).toBe(0);
    next.reset();
    expect(next.exportCheckpoint().options).toEqual(initial.options);
    expect(next.simulator.getBalls().map(ball => ball.active)).toEqual(setup.balls.map(ball => ball.active));
  });

  it.each([0, 7])("末黑进袋后恢复终局或平分争黑，原对手分数=%s", score => {
    const ballSet = [0, 0, .15, 7, 0, -.55];
    const game = new GameSession(sim(ballSet), "single-play", { setup: {
      balls: [{ index: 0, x: 0, z: .15, active: true }, { index: 1, x: 0, z: -.55, active: true }],
      ballOn: 128, inHand: 0, playerIndex: 0, scores: [0, score]
    } });
    shot(game);
    const next = restored(game, ballSet);
    expect(next.finished).toBe(score === 0);
    expect(next.winnerIndex).toBe(score === 0 ? 0 : null);
    if (score === 7) expect(next.context).toMatchObject({ ballOn: 128, playerIndex: 1, inHand: 2 });
  });

  it("保存固定步累积余量，恢复后下一杆同一时间点位置一致", () => {
    const game = new GameSession(sim());
    game.simulator.step(.005);
    const next = restored(game);
    const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: 0, powerFactor: .4, priority: 1 });
    expect(game.stroke(0, vars)).toBe(true);
    expect(next.stroke(0, vars)).toBe(true);
    for (let step = 0; step < 30; step++) {
      game.step(.01); next.step(.01);
      expect(next.simulator.serialize()).toEqual(game.simulator.serialize());
    }
  });

  it("预备与运动中拒绝导出，不撤销已准备出杆", () => {
    const game = new GameSession(sim());
    const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: 0, powerFactor: .1, priority: 1 });
    expect(game.prepareStroke(0, vars)).toBe(true);
    expect(() => game.exportCheckpoint()).toThrow();
    expect(game.stroke(0, vars)).toBe(true);
    expect(() => game.exportCheckpoint()).toThrow();
    expect(game.players[0].shootingCount).toBe(1);
  });

  it("拒绝损坏或不同配置，不修改目标模拟器；导出无可变引用", () => {
    const game = new GameSession(sim());
    const checkpoint = game.exportCheckpoint();
    const target = new GameSession(sim()).simulator;
    const before = target.exportCheckpoint();
    const mutations: ((data: GameCheckpoint) => unknown)[] = [
      data => ({ ...data, format: 2 }), data => ({ ...data, rulesVersion: "rules-2" }),
      data => ({ ...data, simulator: { ...data.simulator, configuration: "other" } }),
      data => ({ ...data, simulator: { ...data.simulator, resting: [...data.simulator.resting, ...data.simulator.resting] } }),
      data => ({ ...data, simulator: { ...data.simulator, residuals: [] } }),
      data => ({ ...data, context: { ...data.context, playerIndex: 2 } }),
      data => ({ ...data, decision: { kind: "foul", playerIndex: 1, canReplace: true } }),
      data => ({ ...data, simulator: { ...data.simulator, world: { ...data.simulator.world, balls: [1, 1] } } }),
      data => ({ ...data, players: [{ ...data.players[0], pts: NaN }, data.players[1]] })
    ];
    for (const mutate of mutations) {
      expect(() => GameSession.fromCheckpoint(target, mutate(checkpoint))).toThrow();
      expect(target.exportCheckpoint()).toEqual(before);
    }
    checkpoint.simulator.world.balls[2] = 123;
    expect(game.simulator.exportCheckpoint()).toEqual(before);
  });
});

describe("整场进度检查点", () => {
  it("JSON跨局/重摆保存身份、开球序列、出杆序号与唯一结果", () => {
    let match = new MatchProgress({ matchId: "saved", bestOf: 3, firstOpeningPlayer: 1 });
    match.rerack();
    const shotId = match.reserveShotId()!;
    expect(() => match.exportCheckpoint()).toThrow();
    match.recordStrike(shotId);
    match = MatchProgress.fromCheckpoint(json(match.exportCheckpoint()));
    expect(match.reserveShotId()).toBe("saved/frame-1/attempt-2/shot-2");
    match.recordStrike("saved/frame-1/attempt-2/shot-2");
    match.finishFrame(0, [70, 30], "played");
    match.readyNextFrame(0);
    match = MatchProgress.fromCheckpoint(json(match.exportCheckpoint()));
    expect(match.readyNextFrame(1)).toBe(true);
    expect(match.view.openingPlayer).toBe(0);
    match.finishFrame(0, [20, 0], "conceded");
    const result = match.view.result;
    match = MatchProgress.fromCheckpoint(json(match.exportCheckpoint()));
    expect(match.finishFrame(0, [20, 0], "conceded")).toBeNull();
    expect(match.view.result).toEqual(result);
    expect(() => MatchProgress.fromCheckpoint({ ...match.exportCheckpoint(), shotSequence: -1 })).toThrow();
  });

  it("随机游标JSON恢复后继续相同序列，非法输入不改游标", () => {
    const random = new SeededRandom(123);
    for (let n = 0; n < 100; n++) random.next();
    const restored = new SeededRandom(0);
    restored.restoreState(json(random.exportState()));
    expect(() => restored.restoreState(-1)).toThrow();
    expect(Array.from({ length: 20 }, () => restored.next())).toEqual(Array.from({ length: 20 }, () => random.next()));
  });
});
