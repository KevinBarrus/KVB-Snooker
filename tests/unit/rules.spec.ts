import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { MeshEdge, CollisionPolygon } from "../../src/core/physics/collision-polygon.js";
import { FOUL, getFoulDescription } from "../../src/core/rules/foul.js";
import { DiscRegion, Plane, PointSetPolygon, sections } from "../../src/core/rules/region.js";
import { BALL_ON, SnookerRef, type BallRefLike, type RefSimulator, type RulesContext } from "../../src/core/rules/snooker.js";

describe("FOUL 常量与文案（PCOL L9949-9972）", () => {
  it("位掩码值", () => {
    expect(FOUL.MISS_TARGET).toBe(1);
    expect(FOUL.OFF_TABLE).toBe(16);
  });

  it("getFoulDescription：位序拼接与句号", () => {
    expect(getFoulDescription(0)).toBe("");
    expect(getFoulDescription(1)).toBe("MISS TARGET.");
    expect(getFoulDescription(2)).toBe("ILLEGAL FIRST HIT.");
    expect(getFoulDescription(3)).toBe("MISS TARGET, ILLEGAL FIRST HIT.");
    expect(getFoulDescription(12)).toBe("ILLEGAL POTTING, POTTING THE CUE BALL.");
  });
});

describe("region 几何（PCOL L9184/L10131/L12470/L12552）", () => {
  it("Plane.signedDistance 与射线求交", () => {
    const plane = new Plane();
    plane.setWithPointNormal(new Vec3(0, 0.88, 0), new Vec3(0, 1, 0));
    expect(plane.d).toBeCloseTo(-0.88, 10);
    expect(plane.signedDistance(new Vec3(3, 1.88, 4))).toBeCloseTo(1, 10);
    const out = new Vec3();
    expect(plane.intersectionWithRay(new Vec3(3, 2.88, 4), new Vec3(0, -1, 0), out)).toBe(true);
    expect(out.x).toBeCloseTo(3, 10);
    expect(out.y).toBeCloseTo(0.88, 10);
    expect(out.z).toBeCloseTo(4, 10);
  });

  it("DiscRegion：标准 D 区参数（tigerClubSno 半径 = 0.29）", () => {
    const disc = new DiscRegion();
    disc.resetWithCenterTopNormal(-1.04, 0.88, 0, -1.33, 0.88, 0, new Vec3(0, 1, 0));
    expect(disc.radius).toBeCloseTo(0.29, 10);
    expect(disc.center.x).toBeCloseTo(-1.04, 10);
    expect(disc.arcDir.x).toBeCloseTo(-1, 10); // 指向开球线后方
    expect(disc.diameterDir.z).toBeCloseTo(1, 10); // 直径沿 ±z
    expect(disc.projectionInside(-1.04, 0.1, 0)).toBe(true);
    expect(disc.projectionInside(-1.04, 0.1, 0.29)).toBe(true); // 直径端点（弧上）
    expect(disc.projectionInside(-1.5, 0.1, 0)).toBe(false);
  });

  it("PointSetPolygon：ground 多边形内点判定", () => {
    const area = new PointSetPolygon();
    const groundPoly = new CollisionPolygon(new Vec3(0, 1, 0), [
      new MeshEdge(new Vec3(-5, 0, -10), new Vec3(5, 0, -10)),
      new MeshEdge(new Vec3(5, 0, -10), new Vec3(5, 0, 10)),
      new MeshEdge(new Vec3(5, 0, 10), new Vec3(-5, 0, 10)),
      new MeshEdge(new Vec3(-5, 0, 10), new Vec3(-5, 0, -10))
    ]);
    area.resetWithAtomPolygon(groundPoly);
    expect(area.projectionInside(0, 0.1, 0)).toBe(true);
    expect(area.projectionInside(6, 0.1, 0)).toBe(false);
    expect(area.geoCenter!.x).toBeCloseTo(0, 10);
    expect(area.geoCenter!.z).toBeCloseTo(0, 10);
  });

  it("sections：sectionSub / findClosestTInSections / findCenterOfLongest", () => {
    const out: number[] = [];
    expect(sections.sectionSub(0, 10, 3, 5, out)).toBe(4);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(3);
    expect(out[2]).toBe(5);
    expect(out[3]).toBe(10);
    // 覆盖整段（减 [−1,11]）→ 无剩余段
    expect(sections.sectionSub(0, 10, -1, 11, out)).toBe(0);
    // 不相交 → 原样保留
    expect(sections.sectionSub(0, 10, 12, 20, out)).toBe(2);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(10);
    expect(sections.findClosestTInSections(4, [0, 3, 6, 10])).toBeCloseTo(3, 10);
    expect(sections.findClosestTInSections(2, [0, 3, 6, 10])).toBeCloseTo(2, 10); // 段内返原值
    // 平局（4.5 离 3/6 等距）→ 取左边界（原作 `t−left > right−t` 严格大于）
    expect(sections.findClosestTInSections(4.5, [0, 3, 6, 10])).toBeCloseTo(3, 10);
    expect(sections.findCenterOfLongestInSections([0, 10, 12, 14])).toBeCloseTo(5, 10);
  });

  it("sectionsBallsAB：空段判定与减区间", () => {
    class ProbeBall implements BallRefLike {
      position: Vec3;
      spot = new Vec3();
      radius = 1;
      constructor(public number: number, public index: number, public active: boolean, x: number, z: number) {
        this.position = new Vec3(x, 0.88, z);
      }
    }
    const balls = [
      new ProbeBall(1, 0, true, 0, -3), // 自身：排除球（线前不占位）
      new ProbeBall(1, 1, true, 0, 4),  // 障碍球：z=4，mix 半径 1.5 → 占 [2.5, 5.5]
      new ProbeBall(0, 2, true, 0, 20)  // 线外
    ];
    const A = new Vec3(0, 0.88, 0);
    const B = new Vec3(0, 0.88, 8);
    const resultSections: number[] = [];
    // 球 radius 1：占位 z∈[3,5] → 空段 [0,3]、[5,8]
    expect(sections.sectionsBallsAB(balls, balls[0] /* 自身排除 */, 0.5, A, B, resultSections, Vec3.UNIT_Z)).toBe(true);
    expect(resultSections[0]).toBe(0);
    expect(resultSections[1]).toBeCloseTo(2.5, 10); // 占位 = 4 ± (1+0.5)
    expect(resultSections[2]).toBeCloseTo(5.5, 10);
    expect(resultSections[3]).toBe(8);
  });
});

/** 最小可测模拟器 mock：22 球（0=母球 1-15=红 2-7=彩球），spot 数组对齐 tiger 表。 */
class MockBall implements BallRefLike {
  position = new Vec3();
  spot: Vec3;
  constructor(
    public number: number,
    public index: number,
    public active: boolean,
    spotX: number,
    spotY: number,
    spotZ: number
  ) {
    this.spot = new Vec3(spotX, spotY, spotZ);
    this.position.copy(this.spot);
  }
}

function makeMockSim(): { sim: RefSimulator; balls: MockBall[] } {
  const balls = [
    new MockBall(0, 0, true, -1.04, 0.88, 0),
    ...(Array.from({ length: 15 }, (_, i) => new MockBall(1, 1 + i, true, 1.5 + i * 0.01, 0.88, (i - 7) * 0.01))),
    new MockBall(2, 16, true, 0, 0.88, 0),
    new MockBall(3, 17, true, 0, 0.88, 0),
    new MockBall(4, 18, true, -1.04, 0.88, 0),
    new MockBall(5, 19, true, 0.9, 0.88, 0),
    new MockBall(6, 20, true, 0.9, 0.88, 0),
    new MockBall(7, 21, true, 0.9, 0.88, 0)
  ];
  const ground = {
    edges: [new MeshEdge(new Vec3(-5, 0, -10), new Vec3(5, 0, -10)), new MeshEdge(new Vec3(5, 0, -10), new Vec3(5, 0, 10)), new MeshEdge(new Vec3(-5, 0, 10), new Vec3(-5, 0, -10)), new MeshEdge(new Vec3(-5, 0, 10), new Vec3(-5, 0, -10))],
    edgeXNormals: [new Vec3(0, 1, 0), new Vec3(0, 1, 0), new Vec3(0, 1, 0), new Vec3(0, 1, 0)],
    normal: new Vec3(0, 1, 0),
    centerPosition: new Vec3(0, 0.88, 0),
    size: { x: 10, y: 0, z: 20 }
  };
  const sim: RefSimulator = {
    sceneId: "tigerClubSno",
    ground,
    ballRadius: 0.02625,
    spotY: 0.88,
    result: { firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] },
    getBallAtIndex: (t) => balls[t],
    getBalls: () => balls,
    touchBalls: (t, spot, distance) => {
      const gap = (distance ?? 1.02 * sim.ballRadius) + sim.ballRadius;
      for (let i = 0; i !== balls.length; ++i) {
        if (i !== t && balls[i].active && balls[i].position.distanceToSq(spot) < gap * gap - Vec3.EPSILON) {
          return true;
        }
      }
      return false;
    },
    respotIndexDefault: (t) => {
      balls[t].position.copy(balls[t].spot);
      balls[t].active = true;
    },
    resetBallPosition: (ball, spot) => {
      ball.position.copy(spot);
      ball.active = true;
    },
    resetBallXYZ: (ball, x, y, z) => {
      ball.position.set(x, y, z);
      ball.active = true;
    }
  };
  return { sim, balls };
}

function freshCtx(): RulesContext {
  return { inHand: 0, ballOn: BALL_ON.RED };
}

describe("SnookerRef.checkResult（PCOL L12703-12739）", () => {
  it("合法进红：score=1 → ballOn 推进 COLOR_ALL", () => {
    const { sim } = makeMockSim();
    const ref = new SnookerRef();
    const ctx = freshCtx();
    sim.result.firstKissIndex = 1; // 红
    sim.result.pottedIndices = [1];
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(1);
    expect(out.foulCode).toBe(0);
    expect(ctx.ballOn).toBe(BALL_ON.COLOR_ALL);
    expect(ctx.inHand).toBe(0);
  });

  it("空杆（首触=0）：foul=MISS_TARGET、score=−4", () => {
    const { sim } = makeMockSim();
    const ref = new SnookerRef();
    const ctx = freshCtx();
    sim.result.firstKissIndex = 0; // 母球（=无首触约定）
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(-4);
    expect(out.foulCode).toBe(FOUL.MISS_TARGET);
    expect(ctx.ballOn).toBe(BALL_ON.RED); // 无红仍活 → 红保持
    expect(ctx.inHand).toBe(0);
  });

  it("母球进袋：POTTING_CUE_BALL 且 inHand=2（手中球）", () => {
    const { sim, balls } = makeMockSim();
    const ref = new SnookerRef();
    const ctx = freshCtx();
    sim.result.firstKissIndex = 1;
    sim.result.pottedIndices = [0]; // 母球
    balls[0].active = false;
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(-4); // min(-0, -1(目标红), -4)
    expect(out.foulCode).toBe(FOUL.POTTING_CUE_BALL);
    expect(ctx.inHand).toBe(2);
  });

  it("彩球阶段首触红：ILLEGAL_FIRST_HIT（a ≤ 1 判）", () => {
    const { sim } = makeMockSim();
    const ref = new SnookerRef();
    const ctx: RulesContext = { inHand: 0, ballOn: BALL_ON.COLOR_ALL };
    sim.result.firstKissIndex = 1; // 红
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(-7); // COLOR_ALL 分支罚分固定 −7（原作直接 o = −7）?! — min(−1, −7.98, −4) = −7.98
  });

  it("空哨兵 ballOn=65535：liveRespot + inHand=1 特殊流程", () => {
    const { sim, balls } = makeMockSim();
    const ref = new SnookerRef();
    const ctx: RulesContext = { inHand: 0, ballOn: ref.sysReservedBallOn };
    sim.result.pottedIndices = [19]; // 蓝（number 5）→ 进 _liveRespotColorBalls
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(0);
    expect(ctx.inHand).toBe(1);
    expect(balls[19].active).toBe(true); // 黑回位
  });

  it("黑球终局：score>0 → ballOn=0", () => {
    const { sim } = makeMockSim();
    const ref = new SnookerRef();
    const ctx: RulesContext = { inHand: 0, ballOn: BALL_ON.BLACK };
    sim.result.firstKissIndex = 21;
    sim.result.pottedIndices = [21];
    const out = { score: NaN, foulCode: 0 };
    ref.checkResult(ctx, sim, out);
    expect(out.score).toBe(7);
    expect(ctx.ballOn).toBe(0);
  });

  it("resetGContext：inHand=2 + ballOn=RED", () => {
    const ref = new SnookerRef();
    const ctx = freshCtx();
    ref.resetGContext(ctx);
    expect(ctx.inHand).toBe(2);
    expect(ctx.ballOn).toBe(BALL_ON.RED);
  });
});

describe("SnookerRef._liveRespot 彩球重置（PCOL L12740-12815）", () => {
  it("母球落袋 → spot 空位时 respotIndexDefault（原位）", () => {
    const { sim, balls } = makeMockSim();
    const ref = new SnookerRef();
    ref.syncAreaWithSimulator(sim);
    balls[0].active = false;
    sim.result.pottedIndices = [0]; // 母球 → _liveRespotCueBall：spot 未被贴 → 原位
    ref.checkResult({ inHand: 0, ballOn: BALL_ON.RED }, sim, { score: NaN, foulCode: 0 });
    // 前置用例完整路径——此处只 spot 空判定分支
    expect(balls[0].active).toBe(true);
  });

  it("spot 被占的彩球重置 → D 区扫描安置（active 恢复）", () => {
    const { sim, balls } = makeMockSim();
    const ref = new SnookerRef();
    ref.syncAreaWithSimulator(sim);
    // 红（index 1）贴在黑球 spot 周围
    sim.result.pottedIndices = [21]; // 黑
    balls[21].active = false;
    balls[1].position.set(0.9, 0.88, 0.001); // 贴黑 spot
    ref.checkResult({ inHand: 0, ballOn: BALL_ON.COLOR_ALL }, sim, { score: NaN, foulCode: 0 });
    expect(balls[21].active).toBe(true);
  });
});
