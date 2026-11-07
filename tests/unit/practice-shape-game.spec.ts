import { describe, expect, it } from "vitest";
import { makePocketTable } from "../fixtures/table.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import type { FrameSetup } from "../../src/core/frame-setup.js";
import { makePracticeShapeConfig } from "../../src/core/practice/shapes.js";

function makeSimulator(): Simulator {
  return new Simulator(makePocketTable(), DEFAULT_SCENE);
}

function finish(game: GameSession): void {
  for (let step = 0; step < 2000 && game.state === GAME_STATE.SIMULATING; step++) game.step(.1);
  expect(game.state).not.toBe(GAME_STATE.SIMULATING);
}

function shot(game: GameSession, dx: number, dz: number, speed: number): void {
  const vars = makeStrokeVars(game.simulator, { dx, dy: 0, dz, fbSpin: 0, powerFactor: 1, priority: 1 });
  vars[6] = speed;
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  finish(game);
}

function makeCueAndBlue(): Simulator {
  return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: [0, -1, 0, 5, 0, 0] });
}

function cueAndBlueSetup(): FrameSetup {
  return {
    balls: [{ index: 0, x: -1, z: 0, active: true }, { index: 1, x: 0, z: 0, active: true }],
    ballOn: 32, inHand: 0, playerIndex: 0, scores: [0]
  };
}

describe("practice shape session", () => {
  it("accepts a practice frame setup and keeps the layout after reset", () => {
    const simulator = makeSimulator();
    const config = makePracticeShapeConfig("snake", simulator);
    const game = new GameSession(simulator, "practice", { setup: config.setup, practice: config.practice });
    expect(game.state).toBe(GAME_STATE.READY);
    expect(game.context.inHand).toBe(2);
    expect(game.context.ballOn).toBe(2);
    const active = config.setup.balls.filter(ball => ball.active);
    expect(active).toHaveLength(simulator.getBallCount());
    for (const ball of active) {
      const view = simulator.getBallView(ball.index);
      expect(view.active).toBe(true);
      expect(view.position.x).toBeCloseTo(ball.x, 9);
      expect(view.position.z).toBeCloseTo(ball.z, 9);
    }
    game.players[0].pts = 12;
    game.reset();
    expect(game.players[0].pts).toBe(0);
    expect(game.context.inHand).toBe(2);
  });

  it("allows full-table cue placement only when the practice option says anywhere", () => {
    const simulator = makeSimulator();
    const anywhere = new GameSession(simulator, "practice", {
      setup: makePracticeShapeConfig("snake", simulator).setup,
      practice: { cuePlacement: "anywhere" }
    });
    expect(anywhere.canPlaceCueBall(0, simulator.spotY, -.6)).toBe(true);
    expect(anywhere.placeCueBall(0, simulator.spotY, -.6)).toBe(true);
    expect(anywhere.context.inHand).toBe(1);

    const dArea = new GameSession(simulator, "practice", {
      setup: makePracticeShapeConfig("x-shape", simulator).setup,
      practice: { cuePlacement: "d-area" }
    });
    expect(dArea.canPlaceCueBall(0, simulator.spotY, -.6)).toBe(false);
    expect(dArea.canPlaceCueBall(-1.15, simulator.spotY, 0)).toBe(true);
  });

  it("restores the full player snapshot when the practice resets a shot", () => {
    const simulator = makeSimulator();
    const config = makePracticeShapeConfig("snake", simulator);
    const game = new GameSession(simulator, "practice", { setup: config.setup, practice: config.practice });
    game.players[0].pts = 12;
    game.players[0].penalty = -4;
    game.players[0].brk = 12;
    expect(game.canRestorePreviousShot).toBe(false);
    shot(game, 0, 1, 1);
    expect(game.canRestorePreviousShot).toBe(true);
    expect(game.players[0].shootingCount).toBe(1);
    expect(game.restorePreviousShot(0)).toBe(true);
    expect(game.players[0].pts).toBe(12);
    expect(game.players[0].penalty).toBe(-4);
    expect(game.players[0].brk).toBe(12);
    expect(game.players[0].shootingCount).toBe(0);
    expect(game.state).toBe(GAME_STATE.READY);
  });

  it("respots the repeat target and keeps its ballOn without scoring", () => {
    const simulator = makeCueAndBlue();
    const game = new GameSession(simulator, "practice", {
      setup: cueAndBlueSetup(),
      practice: { cuePlacement: "anywhere", respotTargetBallNumber: 5, targetBallOn: 32, score: false }
    });
    simulator.resetBallPosition(simulator.getBallAtIndex(1), null);
    shot(game, 0, 1, 4);
    const blue = simulator.getBallView(1);
    expect(blue.active).toBe(true);
    expect(blue.position.x).toBeCloseTo(0, 6);
    expect(blue.position.z).toBeCloseTo(0, 6);
    expect(game.context.ballOn).toBe(32);
    expect(game.players[0].pts).toBe(0);
    expect(game.players[0].penalty).toBe(0);
    expect(game.players[0].shootingCount).toBe(1);
  });

  it("rejects practice-only options outside practice and invalid values", () => {
    const simulator = makeSimulator();
    expect(() => new GameSession(simulator, "single-play", { practice: { cuePlacement: "anywhere" } }))
      .toThrow("Invalid game options");
    expect(() => new GameSession(simulator, "practice", { practice: { respotTargetBallNumber: 99 } }))
      .toThrow("Invalid practice options");
    expect(() => new GameSession(simulator, "practice", { practice: { targetBallOn: 3 } }))
      .toThrow("Invalid practice options");
  });
});
