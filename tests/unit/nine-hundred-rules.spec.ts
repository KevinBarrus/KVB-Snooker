import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { FOUL } from "../../src/core/rules/foul.js";
import { BALL_ON, type BallRefLike, type RefSimulator, type RulesContext } from "../../src/core/rules/snooker.js";
import { NineHundredRef, canPlaceOnTable, targetPenalty } from "../../src/core/rules/nine-hundred.js";

class FakeBall implements BallRefLike {
  position: Vec3;
  spot: Vec3;
  constructor(public number: number, public index: number, public active: boolean, x: number, z: number) {
    this.spot = new Vec3(x, 0.88, z);
    this.position = this.spot.clone();
  }
}

interface FakeSim extends RefSimulator {
  balls: FakeBall[];
  cushions: { ballIndex: number; kind: "cushion" | "jaw"; x: number; z: number }[];
}

function makeSim(): FakeSim {
  const balls = [new FakeBall(0, 0, true, -1.04, 0), new FakeBall(1, 1, true, 0, 0), new FakeBall(5, 2, true, 0, 1)];
  const ground = {
    edges: [new Vec3(-2, 0.88, -1), new Vec3(2, 0.88, -1), new Vec3(2, 0.88, 1), new Vec3(-2, 0.88, 1)]
      .map(va => ({ va })),
    edgeXNormals: [new Vec3(0, 0, -1), new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0)],
    normal: new Vec3(0, 1, 0),
    centerPosition: new Vec3(0, 0.88, 0),
    size: { x: 4, y: 0, z: 2 }
  };
  const sim: FakeSim = {
    balls,
    cushions: [],
    sceneId: "tigerClubSno",
    ground,
    ballRadius: 0.02625,
    spotY: 0.88,
    result: { firstKissIndex: 0, pottedIndices: [] as number[], outOfBoundsIndices: [] as number[] },
    getBallAtIndex: (index: number) => balls[index],
    getBalls: () => balls,
    touchBalls: (index: number, spot: Vec3, distance?: number) => {
      const gap = (distance ?? 1.02 * 0.02625) + 0.02625;
      return balls.some((ball, i) => i !== index && ball.active && ball.position.distanceToSq(spot) < gap * gap - Vec3.EPSILON);
    },
    respotIndexDefault: (index: number) => { balls[index].position.copy(balls[index].spot); balls[index].active = true; },
    resetBallPosition: (ball: BallRefLike, spot: Vec3) => { ball.position.copy(spot); ball.active = true; },
    resetBallXYZ: (ball: BallRefLike, x: number, y: number, z: number) => { ball.position.set(x, y, z); ball.active = true; },
    getContactEvidence: () => ({ touchingIndices: [] as number[], firstContactIndices: [] as number[], pushedIndices: [] as number[] }),
    getCushionEvidence: () => ({ contacts: sim.cushions })
  } satisfies FakeSim;
  return sim;
}

class ExposedRef extends NineHundredRef {
  adjudicateNow(ctx: RulesContext, sim: RefSimulator) { return this.adjudicate(ctx, sim); }
}

function ctx(ballOn: number, nominatedBallIndex?: number): RulesContext {
  return { inHand: 0, ballOn, nominatedBallIndex };
}

describe("900 罚值（snooker-900-design.md §11）", () => {
  it("普通目标球按分值，最低 4 分", () => {
    const sim = makeSim();
    expect(targetPenalty(ctx(BALL_ON.RED), sim)).toBe(4);
    expect(targetPenalty(ctx(32), sim)).toBe(5);
    expect(targetPenalty(ctx(BALL_ON.BLACK), sim)).toBe(7);
    expect(targetPenalty(ctx(0), sim)).toBe(4);
  });

  it("待提名彩球按 7 分，已提名按实际球值", () => {
    const sim = makeSim();
    expect(targetPenalty(ctx(BALL_ON.COLOR_ALL), sim)).toBe(7);
    expect(targetPenalty(ctx(BALL_ON.COLOR_ALL, 1), sim)).toBe(4);
    expect(targetPenalty(ctx(BALL_ON.COLOR_ALL, 2), sim)).toBe(5);
  });
});

describe("NineHundredRef 碰库义务", () => {
  it.each(["cue", "both", "black-off-table"])("末黑犯规继续归位：%s", cause => {
    const sim = makeSim(), ref = new NineHundredRef();
    sim.balls[1].number = 7;
    sim.balls[1].spot.set(1.42, sim.spotY, 0);
    sim.balls[2].active = false;
    sim.getContactEvidence = () => ({ touchingIndices: [], firstContactIndices: [1], pushedIndices: [] });
    sim.cushions = [{ ballIndex: 0, kind: "cushion", x: 1, z: 1 }];
    sim.result.pottedIndices = cause === "cue" ? [0] : cause === "both" ? [0, 1] : [];
    sim.result.outOfBoundsIndices = cause === "black-off-table" ? [1] : [];
    for (const index of [...sim.result.pottedIndices, ...sim.result.outOfBoundsIndices]) {
      sim.balls[index].active = false;
      sim.balls[index].position.set(3, 0, 2);
    }
    ref.syncAreaWithSimulator(sim);
    const context = ctx(BALL_ON.BLACK), result = { score: 0, foulCode: 0 };
    ref.checkResult(context, sim, result);
    expect(result.score).toBe(-7);
    expect(result.foulCode).not.toBe(0);
    expect(context.ballOn).toBe(BALL_ON.BLACK);
    expect(sim.balls[0].active).toBe(true);
    expect(sim.balls[1].active).toBe(true);
    if (cause !== "cue") expect(sim.balls[1].position).toEqual(sim.balls[1].spot);
  });

  it("合法首碰但未碰库且未进球：NO_CUSHION 且罚目标球值", () => {
    const sim = makeSim(), ref = new ExposedRef();
    sim.result.firstKissIndex = 1;
    sim.getContactEvidence = () => ({ touchingIndices: [], firstContactIndices: [1], pushedIndices: [] });
    const out = ref.adjudicateNow(ctx(BALL_ON.RED), sim);
    expect(out.foulCode).toBe(FOUL.NO_CUSHION);
    expect(out.score).toBe(-4);
  });

  it("有真实碰库或已进球时不追加 NO_CUSHION", () => {
    const sim = makeSim(), ref = new ExposedRef();
    sim.result.firstKissIndex = 1;
    sim.getContactEvidence = () => ({ touchingIndices: [], firstContactIndices: [1], pushedIndices: [] });
    sim.cushions = [{ ballIndex: 1, kind: "cushion", x: 1, z: 1 }];
    expect(ref.adjudicateNow(ctx(BALL_ON.RED), sim).foulCode).toBe(0);
    sim.cushions = [];
    sim.result.pottedIndices = [1];
    expect(ref.adjudicateNow(ctx(BALL_ON.RED), sim)).toEqual({ score: 1, foulCode: 0 });
  });

  it("NO_CUSHION 与空杆合并时只按最大罚值计一次", () => {
    const sim = makeSim(), ref = new ExposedRef();
    sim.result.firstKissIndex = 0;
    sim.getContactEvidence = () => ({ touchingIndices: [], firstContactIndices: [], pushedIndices: [] });
    const out = ref.adjudicateNow(ctx(BALL_ON.BLACK), sim);
    expect(out.foulCode).toBe(FOUL.MISS_TARGET | FOUL.NO_CUSHION);
    expect(out.score).toBe(-7);
  });

  it("彩球待提名未进球时按 7 分罚", () => {
    const sim = makeSim(), ref = new ExposedRef();
    sim.result.firstKissIndex = 2;
    sim.getContactEvidence = () => ({ touchingIndices: [], firstContactIndices: [2], pushedIndices: [] });
    expect(ref.adjudicateNow(ctx(BALL_ON.COLOR_ALL), sim)).toEqual({ score: -7, foulCode: FOUL.NO_CUSHION });
  });
});

describe("canPlaceOnTable 全台摆放校验", () => {
  it("台面内合法点可放置", () => {
    expect(canPlaceOnTable(makeSim(), 0.5, 0.88, 0.3)).toBe(true);
  });

  it("高度、非有限值与球重叠被拒绝", () => {
    const sim = makeSim();
    expect(canPlaceOnTable(sim, 0.5, 0.9, 0.3)).toBe(false);
    expect(canPlaceOnTable(sim, Number.NaN, 0.88, 0.3)).toBe(false);
    expect(canPlaceOnTable(sim, 0, 0.88, 0)).toBe(false);
  });

  it("库面边界与袋口库面按球半径拒绝", () => {
    const sim = makeSim();
    expect(canPlaceOnTable(sim, 1.99, 0.88, 0.5)).toBe(false);
    const jawbed = { ...sim, sidePolyGroups: { polys: [{ sidehard: true, sidesoft: false,
      edges: [{ va: new Vec3(0.4, 0.88, 0.25), vb: new Vec3(0.6, 0.88, 0.25) }] }] } };
    expect(canPlaceOnTable(jawbed, 0.5, 0.88, 0.26)).toBe(false);
    expect(canPlaceOnTable(jawbed, 0.5, 0.88, 0.35)).toBe(true);
  });

  it("台面外点被拒绝", () => {
    expect(canPlaceOnTable(makeSim(), 3, 0.88, 0)).toBe(false);
  });
});
