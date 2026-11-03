import { describe, expect, it } from "vitest";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { BALL_ON } from "../../src/core/rules/snooker.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

describe("末黑犯规的规则集隔离", () => {
  it.each(["classic", "snooker-900"] as const)("%s：60:64领先方漏黑后罚7分", ruleset => {
    const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: [0, -1, .4, 7, 1.42, 0] });
    const game = new GameSession(sim, "single-play", { ruleset, players: ["USER", "USER"], setup: {
      balls: sim.getBalls().map(ball => ({ index: ball.index, x: ball.position.x, z: ball.position.z, active: true })),
      scores: [60, 64], playerIndex: 1, ballOn: BALL_ON.BLACK, inHand: 0
    } });
    expect(game.stroke(1, makeStrokeVars(sim, { dx: -1, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 1 }))).toBe(true);
    game.advanceTime(498);
    for (let i = 0; i < 3000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(1 / 60);
    expect(game.state).toBe(GAME_STATE.READY);
    expect(game.result.foulCode & FOUL.MISS_TARGET).toBe(FOUL.MISS_TARGET);
    expect(game.result.score).toBe(-7);
    expect([game.getScore(0), game.getScore(1)]).toEqual([67, 64]);
    if (ruleset === "classic") {
      expect(game.finished).toBe(true);
      expect(game.winnerIndex).toBe(0);
    } else {
      expect(game.finished).toBe(false);
      expect(game.winnerIndex).toBeNull();
      expect(game.decision).toBeNull();
      expect(game.context).toMatchObject({ ballOn: BALL_ON.BLACK, playerIndex: 0, inHand: 2 });
      expect(game.clock).toMatchObject({ frameSeconds: 402, shotSeconds: 20, phase: "placement" });
      expect(sim.getBallView(1).active).toBe(true);
      expect(game.placeCueBall(1.2, sim.spotY, .5)).toBe(true);
      expect(game.confirmPlacement(0)).toBe(true);
      expect(game.stroke(0, makeStrokeVars(sim, { dx: -1, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 1 }))).toBe(true);
      game.advanceTime(402);
      for (let i = 0; i < 3000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(1 / 60);
      expect(game.finished).toBe(true);
      expect(game.clock?.phase).toBe("finished");
    }
  });
});
