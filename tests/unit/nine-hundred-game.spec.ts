import { describe, expect, it } from "vitest";
import { GAME_STATE, GameSession } from "../../src/core/game.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { BALL_ON } from "../../src/core/rules/snooker.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

function makeGame(ruleset?: "classic" | "snooker-900"): GameSession {
  const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE,
    ballSet: [0, 0, 0.15, 1, 0, -0.55, 5, 1.6, 0]
  });
  return new GameSession(sim, "single-play", ruleset ? { ruleset } : {});
}

function runOut(game: GameSession): void {
  for (let frame = 0; game.state === GAME_STATE.SIMULATING && frame < 2000; ++frame) game.step(0.1);
  expect(game.state).toBe(GAME_STATE.READY);
  expect(game.simulator.nAwakened).toBe(0);
}

function begin(game: GameSession): void {
  expect(game.confirmPlacement(game.context.playerIndex)).toBe(true);
  expect(game.clock?.phase).toBe("aiming");
}

function stroke(game: GameSession, options: { dx?: number; dz?: number; fbSpin?: number; powerFactor?: number } = {}): void {
  const vars = makeStrokeVars(game.simulator, { dx: options.dx ?? 0, dy: 0, dz: options.dz ?? -1,
    fbSpin: options.fbSpin ?? 0, powerFactor: options.powerFactor ?? 0.1, priority: 1 });
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
}

describe("900 规则配置", () => {
  it("默认经典且不暴露计时", () => {
    const game = makeGame();
    expect(game.ruleset).toBe("classic");
    expect(game.clock).toBeNull();
    expect(game.shootout).toBeNull();
  });

  it("900 提供双表初始快照；练习模式拒绝 900", () => {
    const game = makeGame("snooker-900");
    expect(game.ruleset).toBe("snooker-900");
    expect(game.clock).toEqual({ frameSeconds: 900, shotSeconds: 20, phase: "placement", shootout: false });
    const sim = new Simulator(makePocketTable(), DEFAULT_SCENE);
    expect(() => new GameSession(sim, "practice", { ruleset: "snooker-900" })).toThrow();
  });
});

describe("900 计时与摆球", () => {
  it("摆球阶段两表暂停，确认后开始消耗", () => {
    const game = makeGame("snooker-900");
    game.advanceTime(60);
    expect(game.clock).toMatchObject({ frameSeconds: 900, shotSeconds: 20 });
    expect(game.beginPlacement(0)).toBe(true);
    game.advanceTime(60);
    expect(game.clock).toMatchObject({ frameSeconds: 900, shotSeconds: 20 });
    begin(game);
    game.advanceTime(3);
    expect(game.clock).toMatchObject({ frameSeconds: 897, shotSeconds: 17 });
  });

  it("超时未触球按目标球值罚分并给对手全台手中球", () => {
    const game = makeGame("snooker-900");
    begin(game);
    expect(game.advanceTime(20)).toBe("shot");
    expect(game.result).toEqual({ score: -4, foulCode: FOUL.SHOT_TIMEOUT });
    expect(game.players[0].penalty).toBe(-4);
    expect(game.context.playerIndex).toBe(1);
    expect(game.context.inHand).toBe(2);
    expect(game.clock).toMatchObject({ frameSeconds: 880, shotSeconds: 20, phase: "placement" });
    expect(game.canPlaceCueBall(1.6, game.simulator.spotY, 0.5)).toBe(true);
  });

  it("摆球未确认时拒绝预备出杆，确认后恢复", () => {
    const game = makeGame("snooker-900");
    const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: 0, powerFactor: 0.1, priority: 1 });
    expect(game.prepareStroke(0, vars)).toBe(false);
    begin(game);
    expect(game.prepareStroke(0, vars)).toBe(true);
  });

  it("开局仍在 D 区摆球，犯规后才放开全台", () => {
    const game = makeGame("snooker-900");
    expect(game.canPlaceCueBall(1.6, game.simulator.spotY, 0.5)).toBe(false);
    expect(game.canPlaceCueBall(-1.04, game.simulator.spotY, 0)).toBe(true);
  });

  it("合法进球保持球权并重置出杆表，局时继续消耗", () => {
    const game = makeGame("snooker-900");
    begin(game);
    game.advanceTime(2);
    const sim = game.simulator;
    sim.respotIndexXYZ(0, 0, sim.spotY, 0.15);
    sim.respotIndexXYZ(1, 0, sim.spotY, -0.55);
    sim.reset(false, true);
    if (game.context.inHand > 0) game.context.inHand = 0;
    stroke(game, { fbSpin: -0.99 });
    expect(game.clock?.phase).toBe("rolling");
    runOut(game);
    expect(game.result).toEqual({ score: 1, foulCode: 0 });
    expect(game.context.playerIndex).toBe(0);
    expect(game.context.ballOn).toBe(BALL_ON.COLOR_ALL);
    expect(game.clock).toMatchObject({ frameSeconds: 898, shotSeconds: 20, phase: "aiming" });
  });
});

describe("900 压哨与决胜", () => {
  it("已触球的杆在局时归零后完整结算，平分进入蓝球决胜", () => {
    const game = makeGame("snooker-900");
    begin(game);
    const sim = game.simulator;
    sim.respotIndexXYZ(0, -0.2, sim.spotY, -0.55);
    sim.respotIndexXYZ(1, 0.2, sim.spotY, -0.55);
    if (game.context.inHand > 0) game.context.inHand = 0;
    stroke(game, { dx: 1, dz: 0, powerFactor: 0.35 });
    expect(game.clock?.phase).toBe("rolling");
    game.advanceTime(100);
    expect(game.clock).toMatchObject({ frameSeconds: 800, shotSeconds: 20 });
    expect(game.advanceTime(900)).toBe("frame");
    expect(game.clock?.phase).toBe("frame-expired");
    runOut(game);
    expect(game.result.foulCode).toBe(0);
    expect(game.shootout).toEqual({ attempts: [0, 0], potted: [0, 0] });
    expect(game.context).toMatchObject({ ballOn: 32, inHand: 2, playerIndex: 1 });
    expect(game.clock).toMatchObject({ frameSeconds: 0, shotSeconds: 20, phase: "placement", shootout: true });
    expect(game.finished).toBe(false);
  });

  it("压哨前进球按原力度完整结算，终局不再产生超时罚分", () => {
    const game = makeGame("snooker-900");
    begin(game);
    stroke(game, { powerFactor: 0 });
    expect(game.advanceTime(900)).toBe("frame");
    expect(game.clock?.phase).toBe("frame-expired");
    runOut(game);
    expect(game.result).toEqual({ score: 1, foulCode: 0 });
    expect(game.result.foulCode).not.toBe(FOUL.SHOT_TIMEOUT);
    expect(game.players[0].pts).toBe(1);
    expect(game.finished).toBe(true);
    expect(game.winnerIndex).toBe(0);
    expect(game.clock?.phase).toBe("finished");
  });
});
