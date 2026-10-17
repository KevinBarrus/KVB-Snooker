import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { MeshBody, type CollisionMeshData } from "../../src/core/physics/mesh-body.js";
import { SnookerRef, type RefSimulator } from "../../src/core/rules/snooker.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { Simulator } from "../../src/core/simulator/simulator.js";

function makeTable(end = false): MeshBody {
  const data: CollisionMeshData = { ground: {
    p: [0, 0.88, 0, 10, 0.88, 0, 10, 0.88, 10, 0, 0.88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } };
  if (end) data.tunnel = {
    p: [0, 0.5, 0, 15, 0.5, 0, 15, 0.5, 15, 0, 0.5, 15],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["end", "tunnel"] }]
  };
  const mesh = new MeshBody(data);
  mesh.id = "test-table";
  return mesh;
}

function makeSim(end = false): Simulator {
  return new Simulator(makeTable(end), {
    ...DEFAULT_SCENE, ballSet: [0, 5, 5, 1, 5.2, 5, 2, 6, 6]
  });
}

function stroke(sim: Simulator, speed = 10): Float32Array {
  const p = sim.getCueBallPosition();
  return new Float32Array([p.x - sim.ballRadius, p.y, p.z, 1, 0, 0, speed, 0.005]);
}

function settle(sim: Simulator): void {
  for (let i = 0; i < 200 && sim.nAwakened !== 0; ++i) sim.step(0.1);
  expect(sim.nAwakened).toBe(0);
}

describe("Simulator（PCOL L12273-12510）", () => {
  it("默认 22 球，number/spot/index 与 ground 高度装配", () => {
    const sim = new Simulator(makeTable());
    expect(sim.getBallCount()).toBe(22);
    expect(sim.getBalls().filter(ball => ball.number === 1)).toHaveLength(15);
    expect(sim.spotY).toBeCloseTo(0.90625, 10);
    expect(sim.getBallAtIndex(0).spot).toEqual(new Vec3(-1.04, sim.spotY, -0.145));
    expect(sim.getBallAtIndex(21).number).toBe(7);
    expect(sim.getBallAtIndex(21).index).toBe(21);
    expect(sim.getBallAtIndex(21).position).toEqual(sim.getBallAtIndex(21).spot);
  });

  it("stroke 清除上一杆结果，真实 CCD 首触统计仅记录母球接触", () => {
    const sim = makeSim();
    settle(sim);
    sim.result.nKissed = 12;
    sim.result.firstKissIndex = 2;
    sim.result.pottedIndices.push(2);
    sim.result.outOfBoundsIndices.push(0);
    sim.stroke(stroke(sim, 20));
    expect(sim.getResult()).toEqual({ nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] });
    settle(sim);
    expect(sim.getResult().firstKissIndex).toBe(1);
    expect(sim.getResult().nKissed).toBeGreaterThanOrEqual(1);
    const refSim: RefSimulator = sim;
    const ref = new SnookerRef();
    ref.syncAreaWithSimulator(refSim);
    const out = { score: 0, foulCode: 0 };
    ref.checkResult({ inHand: 0, ballOn: 2 }, refSim, out);
    expect(out).toEqual({ score: 0, foulCode: 0 });
  });

  it("end 面接触立即失活并登记进袋，不记出界", () => {
    const sim = makeSim(true);
    sim.respotIndexXYZ(1, 12, 1, 5);
    sim.reset(false, true);
    settle(sim);
    expect(sim.getBallAtIndex(1).active).toBe(false);
    expect(sim.getResult().pottedIndices).toEqual([1]);
    expect(sim.getResult().outOfBoundsIndices).toEqual([]);
  });

  it("没有 end 面的跌出台面登记出界", () => {
    const sim = makeSim();
    sim.respotIndexXYZ(1, 12, 1, 5);
    sim.reset(false, true);
    settle(sim);
    expect(sim.getBallAtIndex(1).active).toBe(false);
    expect(sim.getResult().outOfBoundsIndices).toEqual([1]);
    expect(sim.getResult().pottedIndices).toEqual([]);
  });

  it("touchBalls 1.02r 与规则 1.05r 两档阈值及 EPSILON", () => {
    const sim = makeSim();
    const r = sim.ballRadius;
    const target = sim.getBallAtIndex(1);
    const between = target.position.clone().add(new Vec3(2.035 * r, 0, 0));
    expect(sim.touchBalls(0, between)).toBe(false);
    expect(sim.touchBalls(0, between, 1.05 * r)).toBe(true);
    const boundary = target.position.clone().add(new Vec3(Math.sqrt((2.02 * r) ** 2 - Vec3.EPSILON) + 1e-10, 0, 0));
    expect(sim.touchBalls(0, boundary)).toBe(false);
    expect(sim.touchBalls(1, target.position)).toBe(false);
    target.active = false;
    expect(sim.touchBalls(0, target.position)).toBe(false);
  });

  it("respot 默认/XYZ、null 失活、hard 与 clearResult 互不混淆", () => {
    const sim = makeSim();
    const ball = sim.getBallAtIndex(1);
    sim.resetBallPosition(ball, null);
    expect(ball.active).toBe(false);
    sim.respotIndexXYZ(1, 7, sim.spotY, 7);
    expect(ball.active).toBe(true);
    expect(ball.position.x).toBe(7);
    sim.result.firstKissIndex = 2;
    sim.reset(false, true);
    expect(ball.position.x).toBe(7);
    expect(sim.result.firstKissIndex).toBe(0);
    sim.respotIndexDefault(1);
    expect(ball.position).toEqual(ball.spot);
    sim.respotIndexXYZ(1, 7, sim.spotY, 7);
    sim.result.firstKissIndex = 2;
    sim.reset(true, false);
    expect(ball.position).toEqual(ball.spot);
    expect(sim.result.firstKissIndex).toBe(2);
  });

  it("真实规则彩球进袋后归位，母球手中球路径结构兼容", () => {
    const sim = makeSim();
    const ref = new SnookerRef();
    ref.syncAreaWithSimulator(sim);
    sim.resetBallPosition(sim.getBallAtIndex(2), null);
    sim.result.firstKissIndex = 2;
    sim.result.pottedIndices.push(2);
    const out = { score: 0, foulCode: 0 };
    ref.checkResult({ inHand: 0, ballOn: 252 }, sim, out);
    expect(out).toEqual({ score: 2, foulCode: 0 });
    expect(sim.getBallAtIndex(2).active).toBe(true);
    expect(sim.getBallAtIndex(2).position).toEqual(sim.getBallAtIndex(2).spot);
    sim.result.pottedIndices.length = 0;
    sim.result.pottedIndices.push(0);
    sim.resetBallPosition(sim.getBallAtIndex(0), null);
    const ctx = { inHand: 0 as 0 | 1 | 2, ballOn: 2 };
    ref.checkResult(ctx, sim, out);
    expect(ctx.inHand).toBe(2);
    expect(sim.getBallAtIndex(0).active).toBe(true);
  });

  it("serialize/restore 逐位往返，并重放相同一杆", () => {
    const sim = makeSim();
    settle(sim);
    const data = sim.serialize();
    const vars = stroke(sim, 20);
    sim.stroke(vars);
    settle(sim);
    const first = sim.serialize();
    const result = sim.getResult();
    sim.restore(data);
    expect(sim.serialize()).toEqual(data);
    sim.stroke(vars);
    settle(sim);
    expect(sim.serialize()).toEqual(first);
    expect(sim.getResult()).toEqual(result);
  });

  it("predict 从当前状态存档还原，不改杆结果和活跃计数", () => {
    const sim = makeSim();
    settle(sim);
    const data = sim.serialize();
    const result = sim.getResult();
    const context = sim.predict(stroke(sim, 20), 5);
    expect(context.impactOccured).toBe(true);
    expect(Number.isFinite(context.impactV1.x)).toBe(true);
    expect(sim.serialize()).toEqual(data);
    expect(sim.getResult()).toEqual(result);
    expect(sim.nAwakened).toBe(0);
  });

  it("表现层视图为拷贝，无法改写球心及结果列表", () => {
    const sim = makeSim();
    sim.getBallView(0).position.setZero();
    sim.getCueBallPosition().setZero();
    sim.getResult().pottedIndices.push(1);
    expect(sim.getBallAtIndex(0).position.x).toBe(5);
    expect(sim.result.pottedIndices).toEqual([]);
  });

  it.each([
    { ballRadius: 0 }, { ballMass: NaN }, { ballSet: [] }, { ballSet: [0, 1] }, { ballSet: [0, NaN, 0] }
  ])("拒绝非法场景参数 %j", parameters => {
    expect(() => new Simulator(makeTable(), { ...DEFAULT_SCENE, ...parameters })).toThrow("invalid simulator sync opts");
  });
});
