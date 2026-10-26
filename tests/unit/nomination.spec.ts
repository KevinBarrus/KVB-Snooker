import { describe, expect, it } from "vitest";
import { inferColour } from "../../src/core/rules/nomination.js";
import { SnookerRef } from "../../src/core/rules/snooker.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

function makeSim(ballSet: number[]) {
  return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet });
}

describe("彩球意图在出杆前确定", () => {
  it("全台远球和薄球均可自动提名，前方红球遮挡时不提名", () => {
    const sim = makeSim([0, -1.5, 0, 7, 1.4, .05]);
    expect(inferColour(sim, 1, 0)).toBe(1);
    expect(inferColour(sim, -1, 0)).toBeNull();
    expect(inferColour(makeSim([0, -1.5, 0, 1, 0, 0, 7, 1.4, 0]), 1, 0)).toBeNull();
  });

  it("前后彩球按首次接触距离选择；同时擦到两球时不猜", () => {
    expect(inferColour(makeSim([0, -1, 0, 2, 0, 0, 7, 1, 0]), 1, 0)).toBe(1);
    expect(inferColour(makeSim([0, -1, 0, 2, 0, .04, 7, 0, -.04]), 1, 0)).toBeNull();
  });

  it("贴住彩球时必须显式提名，离开接触范围恢复自动", () => {
    const sim = makeSim([0, 0, 0, 2, -.0525, 0, 7, 1, 0]);
    expect(inferColour(sim, 1, 0)).toBeNull();
    sim.respotIndexXYZ(1, -.06, sim.spotY, 0);
    expect(inferColour(sim, 1, 0)).toBe(2);
  });

  it.each([[0, 0], [NaN, 0], [1, Infinity]])("无效方向%d/%d不会产生提名", (dx, dz) => {
    expect(inferColour(makeSim([0, 0, 0, 7, 1, 0]), dx, dz)).toBeNull();
  });

  it("目标不明确时拒绝开始且不计杆数、不罚分；手选可打翻库", () => {
    const sim = makeSim([0, -.3, 0, 2, .3, 0, 7, 1.42, 0]);
    const game = new GameSession(sim); game.context.ballOn = 252;
    const vars = makeStrokeVars(sim, { dx: 0, dy: 0, dz: 1, fbSpin: 0, powerFactor: .1, priority: 1 });
    expect(game.prepareStroke(0, vars)).toBe(false);
    expect(game.stroke(0, vars)).toBe(false);
    expect(game.state).toBe(GAME_STATE.READY);
    expect(game.players[0].shootingCount).toBe(0);
    expect(game.result.score).toBe(0);
    expect(game.nominate(1, 1)).toBe(false);
    expect(game.nominate(0, 0)).toBe(false);
    expect(game.nominate(0, 22)).toBe(false);
    expect(game.nominate(0, 1)).toBe(true);
    expect(game.getNomination(0, 1)).toEqual({ required: true, ballIndex: 1, manual: true });
    expect(game.prepareStroke(0, vars)).toBe(true);
    expect(game.nominate(0, 2)).toBe(false);
    expect(game.context.nominatedBallIndex).toBe(1);
    game.reset();
    expect(game.context.nominatedBallIndex).toBeUndefined();
    expect(game.getNomination(1, 0).required).toBe(false);
  });

  it("提名黑球却实际先碰并打进黄球，按黑球罚7分，不能倒推目标", () => {
    const sim = makeSim([0, 0, -.25, 2, 0, -.55, 7, 1.42, 0]);
    const game = new GameSession(sim); game.context.ballOn = 252;
    expect(game.nominate(0, 2)).toBe(true);
    const vars = makeStrokeVars(sim, { dx: 0, dy: 0, dz: -1, fbSpin: -.99, powerFactor: .1, priority: 1 });
    expect(game.prepareStroke(0, vars)).toBe(true);
    expect(game.stroke(0, vars)).toBe(true);
    for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
    expect(sim.result.firstKissIndex).toBe(1);
    expect(sim.result.pottedIndices).toContain(1);
    expect(game.result).toEqual({ score: -7, foulCode: 6 });
    expect(game.getScore(1)).toBe(7);
    expect(sim.getBallAtIndex(1).active).toBe(true);
    expect(game.context.nominatedBallIndex).toBeUndefined();
  });

  it("已提名黄球后未碰球罚4，先碰黑罚7；自由练习仍不限制", () => {
    const sim = makeSim([0, 0, 0, 2, .3, 0, 7, 1.42, 0]);
    const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
    const result = { score: 0, foulCode: 0 };
    ref.checkResult({ ballOn: 252, inHand: 0, nominatedBallIndex: 1 }, sim, result);
    expect(result).toEqual({ score: -4, foulCode: 1 });
    sim.result.firstKissIndex = 2;
    ref.checkResult({ ballOn: 252, inHand: 0, nominatedBallIndex: 1 }, sim, result);
    expect(result).toEqual({ score: -7, foulCode: 2 });
    const practice = new GameSession(sim, "practice");
    expect(practice.prepareStroke(0, new Float32Array(8))).toBe(true);
  });
});
