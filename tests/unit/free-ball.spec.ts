import { describe, expect, it, vi } from "vitest";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { SnookerRef, type RulesContext } from "../../src/core/rules/snooker.js";
import { snookerView } from "../../src/core/rules/snookered.js";
import { hasOpenInHand } from "../../src/core/rules/in-hand-visibility.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { makePocketTable } from "../fixtures/table.js";

function simulator(balls: number[]) {
  return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: balls });
}

function judge(ballOn: number, first: number[], potted: number[], onNumber = 1, extra: number[] = []) {
  const sim = simulator([0, -.5, .2, onNumber, .5, .2, 7, .2, .2, ...extra]);
  const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
  vi.spyOn(sim, "getContactEvidence").mockReturnValue({ touchingIndices: [], firstContactIndices: first, pushedIndices: [] });
  for (const index of potted) sim.resetBallPosition(sim.getBallAtIndex(index), null);
  sim.result.pottedIndices.push(...potted);
  const context: RulesContext = { ballOn, inHand: 0, freeBallIndex: 2 };
  const result = { score: 0, foulCode: 0 };
  ref.checkResult(context, sim, result);
  return { sim, context, result };
}

describe("自由球几何资格", () => {
  it("看得到中心但有一侧极边被遮挡也算斯诺克，库边不参与遮挡", () => {
    const sim = simulator([0, 0, 0, 1, 1, 0, 7, .5, .07]);
    expect(snookerView(sim, 2)).toEqual({ snookered: true, effectiveBlockers: [2] });
    sim.respotIndexXYZ(2, .5, sim.spotY, .15);
    expect(snookerView(sim, 2).snookered).toBe(false);
  });

  it("红球不能遮挡红球；任一红两侧完整可达即无资格", () => {
    expect(snookerView(simulator([0, 0, 0, 1, 1, 0, 1, .2, 0]), 2).snookered).toBe(false);
    expect(snookerView(simulator([0, 0, 0, 1, 1, 0, 7, .2, 0, 1, .5, .6]), 2).snookered).toBe(false);
  });

  it("不同红被不同彩球遮挡时没有单一有效障碍球", () => {
    const sim = simulator([0, 0, 0, 1, .8, .3, 1, .8, -.3, 7, .15, .05625, 2, .15, -.05625]);
    expect(snookerView(sim, 2)).toEqual({ snookered: true, effectiveBlockers: [] });
  });

  it("D区当前落点被挡但其他合法点可完整打到时不授予自由球", () => {
    const sim = simulator([0, -1.2, 0, 1, 0, 0, 7, -.9, 0]);
    const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
    expect(snookerView(sim, 2).snookered).toBe(true);
    expect(hasOpenInHand(sim, 2, ref.dArea)).toBe(true);
  });

  it("目标前紧邻彩球从整个D区均遮住至少一侧，确认无完整可达点", () => {
    const sim = simulator([0, -1.2, 0, 1, 0, 0, 7, -.0525, 0]);
    const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
    expect(hasOpenInHand(sim, 2, ref.dArea)).toBe(false);
  });

  it("D区三个常用采样点均受阻，仍能找到间隙中的完整可达位置", () => {
    const sim = simulator([0, -1.2, 0, 1, 0, 0,
      2, -.9, -.264, 3, -.9, -.132, 4, -.9, 0, 5, -.9, .132, 7, -.9, .264]);
    const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
    for (const point of [{ x: -1.185, z: 0 }, { x: -1.04, z: .29 }, { x: -1.04, z: -.29 }]) {
      expect(snookerView(sim, 2, point).snookered).toBe(true);
    }
    expect(hasOpenInHand(sim, 2, ref.dArea)).toBe(true);
  });
});

describe("自由球提名、分值与复位", () => {
  it.each([{ potted: [2] }, { potted: [1, 2] }])("红球阶段进袋$potted：替代球计1并复位，真红移除", ({ potted }) => {
    const { sim, context, result } = judge(2, [2], potted);
    expect(result).toEqual({ score: potted.length, foulCode: 0 });
    expect(sim.getBallAtIndex(2).active).toBe(true);
    expect(sim.getBallAtIndex(1).active).toBe(!potted.includes(1));
    expect(context.ballOn).toBe(252);
  });

  it("清彩只进自由球：计目标分值并复位，目标阶段不推进", () => {
    const { sim, context, result } = judge(64, [2], [2], 6);
    expect(result).toEqual({ score: 6, foulCode: 0 });
    expect(context.ballOn).toBe(64);
    expect(sim.getBallAtIndex(1).active && sim.getBallAtIndex(2).active).toBe(true);
  });

  it("目标与自由球同进只计一次彩球分，真目标移除并推进", () => {
    const { sim, context, result } = judge(4, [2, 1], [1, 2], 2);
    expect(result).toEqual({ score: 2, foulCode: 0 });
    expect(context.ballOn).toBe(8);
    expect(sim.getBallAtIndex(1).active).toBe(false);
    expect(sim.getBallAtIndex(2).active).toBe(true);
  });

  it("必须先碰自由球；自由球与目标同时首碰允许，与其他球同时首碰不允许", () => {
    expect(judge(2, [1], []).result).toEqual({ score: -4, foulCode: FOUL.ILLEGAL_FIRST_HIT });
    expect(judge(2, [2, 1], [1]).result).toEqual({ score: 1, foulCode: 0 });
    expect(judge(2, [2, 3], [], 1, [6, .8, .5]).result).toEqual({ score: -6, foulCode: FOUL.ILLEGAL_FIRST_HIT });
  });

  it("黑球作为红球的自由球时母球落袋罚4，不按黑球罚7", () => {
    expect(judge(2, [2], [0]).result).toEqual({ score: -4, foulCode: FOUL.POTTING_CUE_BALL });
  });

  it("不得用自由球再次做斯诺克；仅剩粉黑例外，红黑不能套用例外", () => {
    expect(judge(2, [2], []).result).toEqual({ score: -4, foulCode: FOUL.FREE_BALL_SNOOKER });
    expect(judge(64, [2], [], 6).result).toEqual({ score: 0, foulCode: 0 });
  });

  it("黑球与额外彩球仍在台上时，不能套用仅剩黑球一次犯规即结束", () => {
    const sim = simulator([0, -.5, .2, 7, .5, .2, 2, .2, .2]);
    const ref = new SnookerRef(); ref.syncAreaWithSimulator(sim);
    const context: RulesContext = { ballOn: 128, inHand: 0, freeBallIndex: 2 };
    const result = { score: 0, foulCode: 0 };
    ref.checkResult(context, sim, result);
    expect(result).toEqual({ score: -7, foulCode: FOUL.MISS_TARGET });
    expect(context.ballOn).toBe(128);
  });

  it.each([false, true])("普通犯规可授予自由球且无需Miss；让对方继续=%s时撤销资格", again => {
    const sim = simulator([0, 0, .2, 1, .6, .2, 7, .15, .2]);
    const game = new GameSession(sim, "single-play", { players: ["USER", "USER"] });
    const cue = sim.getCueBallPosition();
    const vars = new Float32Array([cue.x - .03125, cue.y, cue.z, 1, 0, 0, 0, .005]);
    expect(game.stroke(0, vars)).toBe(true);
    for (let i = 0; i < 2000 && game.state === GAME_STATE.SIMULATING; ++i) game.step(.1);
    expect(game.decision?.kind).toBe("foul");
    expect(game.freeBallAvailable).toBe(true);
    expect(game.chooseNextPlayer(1, again ? 0 : 1)).toBe(true);
    expect(game.freeBallAvailable).toBe(!again);
    expect(game.nominate(again ? 0 : 1, 1)).toBe(false);
    expect(game.nominate(again ? 0 : 1, 2)).toBe(!again);
    if (!again) {
      expect(game.prepareStroke(1, vars)).toBe(true);
      expect(game.context.freeBallIndex).toBe(2);
      expect(game.context.ballOn).toBe(2);
    }
    game.reset();
    expect(game.freeBallAvailable).toBe(false);
    expect(game.context.freeBallIndex).toBeUndefined();
  });
});
