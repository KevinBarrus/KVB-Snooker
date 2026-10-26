import { describe, expect, it } from "vitest";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { availablePoints, isMiss } from "../../src/core/rules/miss.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { makeRuleTestSetup } from "../../src/devtools/presets.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

function create(scores: readonly number[] = [0, 0], preset: "colours" | "last-red" = "colours") {
  const sim = new Simulator(makePocketTable());
  return new GameSession(sim, "single-play", { players: ["USER", "USER"], setup: { ...makeRuleTestSetup(preset), scores } });
}

function vars(game: GameSession, speed = 0) {
  const stroke = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: -1, fbSpin: -.99, powerFactor: .1, priority: 1 });
  stroke[6] = speed;
  return stroke;
}

function finish(game: GameSession) {
  for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
  expect(game.state).not.toBe(GAME_STATE.SIMULATING);
}

function miss(game: GameSession, speed = 0) {
  expect(game.stroke(game.context.playerIndex, vars(game, speed))).toBe(true);
  finish(game);
}

describe("简化Miss与台面剩余分", () => {
  it("计入每颗红后的彩球及最后一红后的彩球机会", () => {
    const game = create(), sim = game.simulator;
    expect(availablePoints(sim, 4)).toBe(27);
    expect(availablePoints(sim, 252)).toBe(34);
    expect(availablePoints(sim, 128)).toBe(7);
    expect(availablePoints(sim, 0)).toBe(0);
    const last = create([0, 0], "last-red");
    expect(availablePoints(last.simulator, 2)).toBe(35);
    expect(availablePoints(last.simulator, 252)).toBe(42);
    sim.reset(true, true);
    expect(availablePoints(sim, 2)).toBe(147);
    expect(availablePoints(sim, 65535)).toBe(0);
  });

  it.each([
    { scores: [25, 0], expected: true }, { scores: [30, 0], expected: false },
    { scores: [27, 0], expected: true }, { scores: [0, 25], expected: false },
    { scores: [0, 23], expected: true }
  ])("27分台面、杆前$scores：判罚后也检查是否需要罚分", ({ scores, expected }) => {
    const game = create(scores);
    miss(game);
    expect(game.decision).toEqual({ kind: "foul", playerIndex: 1, canReplace: expected });
    expect(game.getScore(1)).toBe(scores[1] + 4);
    expect(game.restorePreviousShot(1)).toBe(expected);
  });

  it("只对首碰义务失败判Miss；合法首碰后摔袋/非法进球/推杆不授予复位", () => {
    for (const foul of [FOUL.POTTING_CUE_BALL, FOUL.ILLEGAL_POTTING, FOUL.PUSH_STROKE]) {
      expect(isMiss(foul, 0, 27, -4, 27)).toBe(false);
    }
    expect(isMiss(FOUL.ILLEGAL_FIRST_HIT | FOUL.POTTING_CUE_BALL, 25, 27, 21, 27)).toBe(true);
    expect(isMiss(FOUL.MISS_TARGET, 0, 35, -4, 0)).toBe(false);
  });

  it("未解到兼母球摔袋仍可复位，也可选择D区接手或让对方D区继续", () => {
    for (const next of ["restore", "self", "other"] as const) {
      const game = create([0, 0], "last-red"), sim = game.simulator;
      sim.respotIndexXYZ(0, 0, sim.spotY, .25);
      sim.respotIndexXYZ(1, .8, sim.spotY, .4);
      sim.reset(false, true);
      while (sim.nAwakened) sim.step(.1);
      const before = sim.serialize();
      const stroke = makeStrokeVars(sim, { dx: 0, dy: 0, dz: 1, fbSpin: 0, powerFactor: .3, priority: 1 });
      expect(game.stroke(0, stroke)).toBe(true); finish(game);
      expect(game.result.foulCode & FOUL.POTTING_CUE_BALL).toBe(FOUL.POTTING_CUE_BALL);
      expect(game.decision).toEqual({ kind: "foul", playerIndex: 1, canReplace: true });
      expect(game.result.score).toBe(-4);
      expect(game.context.inHand).toBe(2);
      if (next === "restore") {
        expect(game.restorePreviousShot(1)).toBe(true);
        expect(sim.serialize()).toEqual(before);
        expect(game.context.inHand).toBe(0);
      } else {
        expect(game.chooseNextPlayer(1, next === "self" ? 1 : 0)).toBe(true);
        expect(game.context.inHand).toBe(2);
        expect(game.restorePreviousShot(game.context.playerIndex)).toBe(false);
      }
    }
  });

  it("合法贴球打离无新首碰也不判Miss", () => {
    const game = create([0, 0], "last-red"), sim = game.simulator;
    sim.respotIndexXYZ(0, .5, sim.spotY, .2);
    sim.respotIndexXYZ(1, .5, sim.spotY, .2525);
    sim.reset(false, true);
    miss(game, 2);
    expect(sim.getContactEvidence()?.touchingIndices).toContain(1);
    expect(game.result.foulCode).toBe(0);
    expect(game.decision).toBeNull();
    expect(game.restorePreviousShot(1)).toBe(false);
  });
});

describe("共用杆前台面恢复与比赛权限", () => {
  it("保留罚分、杆数、历史单杆，恢复球位姿态和目标，重复请求不能撤分", () => {
    const game = create(), sim = game.simulator;
    game.players[0].brk = 12;
    const before = sim.serialize();
    expect(game.restorePreviousShot(0)).toBe(false);
    expect(game.prepareStroke(0, vars(game))).toBe(true);
    expect(game.restorePreviousShot(0)).toBe(false);
    miss(game);
    expect(game.restorePreviousShot(0)).toBe(false);
    expect(game.restorePreviousShot(1)).toBe(true);
    expect(sim.serialize()).toEqual(before);
    expect(game.context).toEqual({ ballOn: 4, inHand: 0, playerIndex: 0, nRounds: 1 });
    expect(game.players[0].brk).toBe(0); expect(game.players[0].maxbrk).toBe(12);
    expect(game.players[0].shootingCount).toBe(1); expect(game.getScore(1)).toBe(4);
    expect(game.restorePreviousShot(1)).toBe(false);
    expect(sim.getContactEvidence()).toBeNull();
    expect(sim.getResult()).toEqual({ nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] });
    miss(game); expect(game.restorePreviousShot(1)).toBe(true);
    expect(game.getScore(1)).toBe(8); expect(game.context.nRounds).toBe(2);
  });

  it("复位取消自由球，红后彩球机会恢复并允许重新提名", () => {
    const game = create(), sim = game.simulator;
    game.context.ballOn = 252;
    expect(game.nominate(0, 21)).toBe(true);
    miss(game);
    expect(game.context.ballOn).toBe(4);
    expect(game.restorePreviousShot(1)).toBe(true);
    expect(game.context.ballOn).toBe(252);
    expect(game.context.nominatedBallIndex).toBeUndefined();
    expect(game.freeBallAvailable).toBe(false);
    expect(game.nominate(0, 16)).toBe(true);
    expect(game.prepareStroke(0, vars(game))).toBe(true);
    expect(game.context.nominatedBallIndex).toBe(16);
    expect(sim.getContactEvidence()).toBeNull();
  });

  it("D区摆球后保存，复位恢复摆后的原位；reset使旧快照失效", () => {
    const game = new GameSession(new Simulator(makePocketTable()));
    expect(game.placeCueBall(-1.2, game.simulator.spotY, -.1)).toBe(true);
    const before = game.simulator.serialize();
    miss(game);
    expect(game.restorePreviousShot(1)).toBe(true);
    expect(game.simulator.serialize()).toEqual(before);
    expect(game.context.inHand).toBe(1);
    game.reset(); expect(game.restorePreviousShot(1)).toBe(false);
  });

  it("练习复用恢复命令，可连续调整力度重试，不能在准备/运动期间恢复", () => {
    const game = new GameSession(new Simulator(makePocketTable()), "practice"), sim = game.simulator;
    const before = sim.serialize();
    for (const speed of [1, 3]) {
      expect(game.stroke(0, vars(game, speed))).toBe(true);
      expect(game.restorePreviousShot(0)).toBe(false);
      finish(game);
      expect(game.restorePreviousShot(1)).toBe(false);
      expect(game.restorePreviousShot(0)).toBe(true);
      expect(sim.serialize()).toEqual(before);
      expect(game.restorePreviousShot(0)).toBe(true);
    }
    expect(game.players[0].shootingCount).toBe(2);
    game.reset(); expect(game.restorePreviousShot(0)).toBe(false);
  });
});
