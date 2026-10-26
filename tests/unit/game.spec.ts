import { describe, expect, it } from "vitest";
import { GAME_STATE, GameSession } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

function makeGame(mode: "practice" | "single-play" = "single-play"): GameSession {
  const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE,
    ballSet: [0, 0, 0.15, 1, 0, -0.55, 1, 1, 0, 2, -1.04, -0.29, 7, 1.42, 0]
  });
  return new GameSession(sim, mode);
}

function settle(game: GameSession): void {
  for (let frame = 0; game.state === GAME_STATE.SIMULATING && frame < 2000; ++frame) game.step(0.1);
  if (game.decision) game.chooseNextPlayer(game.decision.playerIndex, game.decision.playerIndex);
  expect(game.state).toBe(GAME_STATE.READY);
  expect(game.simulator.nAwakened).toBe(0);
}

function pot(game: GameSession, index: number): void {
  const sim = game.simulator;
  sim.respotIndexXYZ(0, 0, sim.spotY, 0.15);
  sim.respotIndexXYZ(index, 0, sim.spotY, -0.55);
  sim.reset(false, true);
  const vars = makeStrokeVars(sim, { dx: 0, dy: 0, dz: -1, fbSpin: -0.99, powerFactor: 0.1, priority: 1 });
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  settle(game);
}

describe("M1 回合权机（PCOL L3660-3772）", () => {
  it("single play 装配 USER/AI，只有当前玩家且 READY 时能击球", () => {
    const game = makeGame();
    expect(game.players.map(player => player.type)).toEqual(["USER", "AI"]);
    expect(game.context).toEqual({ playerIndex: 0, nRounds: 0, inHand: 2, ballOn: 2 });
    expect(game.state).toBe(GAME_STATE.READY);
    const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: 0, powerFactor: 0.1, priority: 1 });
    expect(game.stroke(1, vars)).toBe(false);
    expect(game.players[1].shootingCount).toBe(0);
    expect(game.stroke(0, vars)).toBe(true);
    expect(game.state).toBe(GAME_STATE.SIMULATING);
    expect(game.stroke(0, vars)).toBe(false);
    expect(game.players[0].shootingCount).toBe(1);
    settle(game);
  });

  it("真实红→彩连续得分累积 break，失机后轮换并清零当前 break", () => {
    const game = makeGame();
    game.context.inHand = 0;
    pot(game, 1);
    expect(game.result).toEqual({ score: 1, foulCode: 0 });
    expect(game.context.ballOn).toBe(252);
    expect(game.context.playerIndex).toBe(0);
    expect(game.players[0].brk).toBe(1);
    pot(game, 3);
    expect(game.result).toEqual({ score: 2, foulCode: 0 });
    expect(game.context.ballOn).toBe(2);
    expect(game.context.playerIndex).toBe(0);
    expect(game.players[0].pts).toBe(3);
    expect(game.players[0].brk).toBe(3);
    expect(game.players[0].maxbrk).toBe(3);
    const sim = game.simulator;
    const vars = makeStrokeVars(sim, { dx: 1, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 0 });
    vars[6] = 0;
    expect(game.stroke(0, vars)).toBe(true);
    settle(game);
    expect(game.result).toEqual({ score: -4, foulCode: 1 });
    expect(game.context.nRounds).toBe(3);
    expect(game.context.playerIndex).toBe(1);
    expect(game.players[0].brk).toBe(0);
    expect(game.players[0].maxbrk).toBe(3);
    expect(game.players[0].penalty).toBe(-4);
    expect(game.players[0].accuracy).toBeCloseTo(2 / 3, 12);
    expect(game.snapshot).toEqual(sim.serialize());
  });

  it("practice 只有 USER，65535 哨兵归位彩球，同人继续", () => {
    const game = makeGame("practice");
    expect(game.players.map(player => player.type)).toEqual(["USER"]);
    expect(game.context.inHand).toBe(1);
    expect(game.context.ballOn).toBe(65535);
    pot(game, 3);
    expect(game.context.playerIndex).toBe(0);
    expect(game.result.score).toBe(0);
    expect(game.simulator.getBallAtIndex(3).active).toBe(true);
    expect(game.simulator.getBallAtIndex(3).position).toEqual(game.simulator.getBallAtIndex(3).spot);
    expect(game.finished).toBe(false);
  });

  it("D 区摆球需合法且不贴球，拒绝模拟过程改位", () => {
    const game = makeGame();
    expect(game.placeCueBall(0, game.simulator.spotY, 0)).toBe(false);
    expect(game.placeCueBall(-1.18, game.simulator.spotY, 0)).toBe(true);
    expect(game.context.inHand).toBe(1);
    const vars = makeStrokeVars(game.simulator, { dx: 1, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 0 });
    vars[6] = 0;
    game.stroke(0, vars);
    expect(game.placeCueBall(-1.2, game.simulator.spotY, 0)).toBe(false);
    settle(game);
  });

  it("黑球终局 ballOn=0，禁止再击；reset 清空分数与历史 break", () => {
    const game = makeGame();
    game.simulator.resetBallPosition(game.simulator.getBallAtIndex(1), null);
    game.context.ballOn = 128;
    game.context.inHand = 0;
    pot(game, 4);
    expect(game.result).toEqual({ score: 7, foulCode: 0 });
    expect(game.finished).toBe(true);
    expect(game.context.ballOn).toBe(0);
    expect(game.stroke(0, new Float32Array(8))).toBe(false);
    expect(game.players[0].maxbrk).toBe(7);
    const snapshot = game.snapshot!;
    snapshot.balls.length = 0;
    expect(game.snapshot!.balls.length).toBeGreaterThan(0);
    game.reset();
    expect(game.finished).toBe(false);
    expect(game.players[0].maxbrk).toBe(0);
    expect(game.players[0].pts).toBe(0);
    expect(game.context.nRounds).toBe(0);
    expect(game.context.ballOn).toBe(2);
  });
});
