import { describe, expect, it } from "vitest";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makeRuleTestSetup, type RuleTestPreset } from "../../src/devtools/presets.js";
import { makePocketTable } from "../fixtures/table.js";

function makeGame(preset: RuleTestPreset) {
  const simulator = new Simulator(makePocketTable());
  return new GameSession(simulator, "single-play", { players: ["USER", "USER"], setup: makeRuleTestSetup(preset) });
}

function finish(game: GameSession): void {
  for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
  expect(game.state).toBe(GAME_STATE.READY);
}

function shoot(game: GameSession, speed?: number): void {
  const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: -.99, powerFactor: .1, priority: 1 });
  if (speed !== undefined) vars[6] = speed;
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  finish(game);
}

describe("开发预设消费正式双人规则", () => {
  it.each([["standard", 22, 15, 2, 2], ["last-red", 8, 1, 2, 0], ["colours", 7, 0, 4, 0]] as const)(
    "%s提供完整球集、阶段和两个USER席位", (preset, count, reds, ballOn, inHand) => {
      const game = makeGame(preset);
      const active = game.simulator.getBalls().filter(ball => ball.active);
      expect(active).toHaveLength(count);
      expect(active.filter(ball => ball.number === 1)).toHaveLength(reds);
      expect(game.context).toEqual({ ballOn, inHand, playerIndex: 0, nRounds: 0 });
      expect(game.players.map(player => player.type)).toEqual(["USER", "USER"]);
      expect(game.simulator.nAwakened).toBe(0);
    });

  it("最后一红真实进袋后仍可打一颗彩球，再进入清彩", () => {
    const game = makeGame("last-red"), sim = game.simulator;
    shoot(game);
    expect(game.result).toEqual({ score: 1, foulCode: 0 });
    expect(game.context.ballOn).toBe(252);
    expect(game.players[0].brk).toBe(1);
    sim.respotIndexXYZ(0, 0, sim.spotY, -.25);
    sim.respotIndexXYZ(16, 0, sim.spotY, -.55);
    sim.reset(false, true);
    shoot(game);
    expect(game.result).toEqual({ score: 2, foulCode: 0 });
    expect(game.context.ballOn).toBe(4);
    expect(sim.getBallView(16).active).toBe(true);
    expect(game.players[0].pts).toBe(3);
    expect(game.players[0].brk).toBe(3);
  });

  it("清彩合法进黄不复位，失机转给第二个本地玩家且罚分计给对方", () => {
    const game = makeGame("colours"), sim = game.simulator;
    sim.respotIndexXYZ(0, 0, sim.spotY, -.25);
    sim.respotIndexXYZ(16, 0, sim.spotY, -.55);
    sim.reset(false, true);
    shoot(game);
    expect(sim.getBallView(16).active).toBe(false);
    expect(game.context.ballOn).toBe(8);
    expect(game.players[0].pts).toBe(2);
    shoot(game, 0);
    expect(game.context.playerIndex).toBe(1);
    expect(game.players[0].penalty).toBe(-4);
    expect(game.players[1].pts - game.players[0].penalty).toBe(4);
    shoot(game, 0);
    expect(game.context.playerIndex).toBe(0);
    expect(game.players[1].shootingCount).toBe(1);
  });

  it("完整重置恢复球位姿态、比分、统计、球权和本杆结果", () => {
    const game = makeGame("last-red"), sim = game.simulator;
    const initial = Array.from({ length: sim.getBallCount() }, (_, index) => sim.getBallView(index));
    shoot(game); shoot(game, 0);
    expect(game.players[0].maxbrk).toBeGreaterThan(0);
    game.reset();
    expect(game.context).toEqual({ ballOn: 2, inHand: 0, playerIndex: 0, nRounds: 0 });
    expect(game.players.map(player => [player.pts, player.penalty, player.brk, player.maxbrk, player.shootingCount])).toEqual(
      [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);
    expect(sim.getResult()).toEqual({ nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] });
    expect(Array.from({ length: sim.getBallCount() }, (_, index) => sim.getBallView(index))).toEqual(initial);
  });

  it("拒绝损坏预设且不改动当前世界，复制输入避免外部修改影响重置", () => {
    const sim = new Simulator(makePocketTable());
    const setup = makeRuleTestSetup("last-red");
    const before = sim.serialize();
    for (const invalid of [{ ...setup, balls: setup.balls.slice(1) }, { ...setup, playerIndex: 2 },
      { ...setup, scores: [NaN, 0] }, { ...setup, balls: setup.balls.map(ball => ({ ...ball, x: Infinity })) }]) {
      expect(() => new GameSession(sim, "single-play", { setup: invalid })).toThrow("Invalid frame setup");
      expect(sim.serialize()).toEqual(before);
    }
    const balls = setup.balls.map(ball => ({ ...ball }));
    const game = new GameSession(sim, "single-play", { setup: { ...setup, balls } });
    balls[0].x = 9;
    game.reset();
    expect(sim.getCueBallPosition().x).toBe(0);
  });
});
