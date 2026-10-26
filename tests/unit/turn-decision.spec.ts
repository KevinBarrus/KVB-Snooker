import { afterEach, describe, expect, it } from "vitest";
import { GAME_STATE, GameSession } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { setCoreRandom } from "../../src/core/rng.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

function create(black = false) {
  const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE,
    ballSet: [0, -1.2, 0, black ? 7 : 1, 1.42, 0] });
  const game = new GameSession(sim, "single-play", { players: ["USER", "USER"] });
  game.context.ballOn = black ? 128 : 2;
  return game;
}

function shoot(game: GameSession, pot = false): void {
  const sim = game.simulator;
  if (pot) {
    sim.respotIndexXYZ(0, 0, sim.spotY, -.25);
    sim.respotIndexXYZ(1, 0, sim.spotY, -.55);
    sim.reset(false, true);
  }
  const vars = makeStrokeVars(sim, { dx: 0, dy: 0, dz: -1, fbSpin: -.99, powerFactor: .1, priority: 1 });
  if (!pot) vars[6] = 0;
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
  expect(game.simulator.nAwakened).toBe(0);
}

afterEach(() => setCoreRandom(null));

describe("普通犯规选择与最后黑球", () => {
  it.each([0, 1])("普通犯规只计一次罚分，可选择玩家%d从当前位置打", next => {
    const game = create();
    shoot(game);
    expect(game.decision).toEqual({ kind: "foul", playerIndex: 1 });
    expect(game.getScore(1)).toBe(4);
    expect(game.state).toBe(GAME_STATE.DECIDING);
    const before = game.simulator.serialize();
    expect(game.stroke(1, new Float32Array(8))).toBe(false);
    expect(game.placeCueBall(-1.2, game.simulator.spotY, 0)).toBe(false);
    expect(game.chooseNextPlayer(0, 0)).toBe(false);
    expect(game.chooseNextPlayer(1, 2)).toBe(false);
    expect(game.chooseNextPlayer(1, .5)).toBe(false);
    expect(game.chooseNextPlayer(1, next)).toBe(true);
    expect(game.chooseNextPlayer(1, 1 - next)).toBe(false);
    game.step(1);
    expect(game.getScore(1)).toBe(4);
    expect(game.context.nRounds).toBe(1);
    expect(game.context.playerIndex).toBe(next);
    expect(game.simulator.serialize()).toEqual(before);
    expect(game.decision).toBeNull();
    expect(game.placeCueBall(-1.15, game.simulator.spotY, 0)).toBe(false);
  });

  it.each([false, true])("最后黑球%s：首次罚分或进袋结束，按含罚分的总分判胜", pot => {
    const game = create(true);
    shoot(game, pot);
    expect(game.finished).toBe(true);
    expect(game.winnerIndex).toBe(pot ? 0 : 1);
    expect(game.getScore(pot ? 0 : 1)).toBe(7);
    expect(game.decision).toBeNull();
    expect(game.stroke(0, new Float32Array(8))).toBe(false);
  });

  it.each([false, true])("黑球%s后平分：重新摆黑、抽签选先手、D区手中球、下一次得失分决胜", pot => {
    setCoreRandom({ next: () => .75 });
    const game = create(true);
    game.players[pot ? 1 : 0].pts = 7;
    shoot(game, pot);
    expect(game.getScore(0)).toBe(7);
    expect(game.getScore(1)).toBe(7);
    expect(game.finished).toBe(false);
    expect(game.winnerIndex).toBeNull();
    expect(game.decision).toEqual({ kind: "black", playerIndex: 1 });
    expect(game.context.inHand).toBe(2);
    expect(game.context.ballOn).toBe(128);
    expect(game.players.every(player => player.brk === 0)).toBe(true);
    for (const ball of game.simulator.getBalls()) {
      expect(ball.active).toBe(true);
      expect(ball.position).toEqual(ball.spot);
    }
    expect(game.chooseNextPlayer(1, 0)).toBe(true);
    expect(game.placeCueBall(-1.2, game.simulator.spotY, .1)).toBe(true);
    shoot(game);
    expect(game.finished).toBe(true);
    expect(game.getScore(1)).toBe(14);
    expect(game.winnerIndex).toBe(1);
    expect(game.decision).toBeNull();
  });

  it("reset清空未决定选择，不能用旧选择改变新局", () => {
    const game = create();
    shoot(game);
    game.reset();
    expect(game.decision).toBeNull();
    expect(game.chooseNextPlayer(1, 1)).toBe(false);
    expect(game.getScore(1)).toBe(0);
    expect(game.state).toBe(GAME_STATE.READY);
  });
});
