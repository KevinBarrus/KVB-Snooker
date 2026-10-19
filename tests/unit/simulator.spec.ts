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

function spinStroke(sim: Simulator): Float32Array {
  const vars = stroke(sim, 20);
  vars[2] += sim.ballRadius / 3;
  return vars;
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

  it("首次 step 前全部 22 球已有摆位与单位旋转快照", () => {
    const sim = new Simulator(makeTable());
    for (let index = 0; index < sim.getBallCount(); ++index) {
      const view = sim.getBallView(index);
      expect(view.renderPosition).toEqual({ x: view.position.x, y: view.position.y, z: view.position.z });
      expect(view.renderOrientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });

  it("不足一个物理步时按剩余时间外推显示位置和旋转，物理姿态不动", () => {
    const sim = makeSim();
    sim.stroke(spinStroke(sim));
    const cue = sim.getBallAtIndex(0);
    const physical = sim.serialize();
    const dt = 0.005;
    expect(cue.w.length()).toBeGreaterThan(0);
    expect(sim.step(dt)).toBe(0);
    const view = sim.getBallView(0);
    expect(view.renderPosition.x).toBeCloseTo(view.position.x + cue.v.x * dt, 12);
    expect(view.renderPosition.y).toBeCloseTo(view.position.y + cue.v.y * dt, 12);
    expect(view.renderPosition.z).toBeCloseTo(view.position.z + cue.v.z * dt, 12);
    expect(view.renderPosition.x).not.toBe(view.position.x);
    const half = dt / 2;
    const norm = Math.hypot(cue.w.x * half, cue.w.y * half, cue.w.z * half, 1);
    expect(view.renderOrientation.x).toBeCloseTo(cue.w.x * half / norm, 12);
    expect(view.renderOrientation.y).toBeCloseTo(cue.w.y * half / norm, 12);
    expect(view.renderOrientation.z).toBeCloseTo(cue.w.z * half / norm, 12);
    expect(view.renderOrientation.w).toBeCloseTo(1 / norm, 12);
    expect(sim.serialize()).toEqual(physical);
  });

  it("完整物理步后的快照只外推余量，position 保持物理坐标", () => {
    const sim = makeSim();
    sim.stroke(spinStroke(sim));
    expect(sim.step(0.02)).toBeCloseTo(0.0167, 12);
    const cue = sim.getBallAtIndex(0);
    const view = sim.getBallView(0);
    expect(view.position).toEqual(cue.position);
    expect(view.renderPosition.x).toBeCloseTo(cue.position.x + cue.v.x * 0.0033, 12);
    expect(view.renderPosition.y).toBeCloseTo(cue.position.y + cue.v.y * 0.0033, 12);
    expect(view.renderPosition.z).toBeCloseTo(cue.position.z + cue.v.z * 0.0033, 12);
    expect(view.renderOrientation).toEqual(cue.states.orientation);
  });

  it("超过十步追赶上限后沿用原作零外推分支", () => {
    const sim = makeSim();
    sim.respotIndexXYZ(0, 5, 20, 5);
    sim.reset(false, true);
    sim.stroke(spinStroke(sim));
    expect(sim.step(0.3)).toBeCloseTo(0.167, 12);
    const cue = sim.getBallAtIndex(0);
    const view = sim.getBallView(0);
    expect(cue.v.length()).toBeGreaterThan(0);
    expect(view.renderPosition).toEqual(view.position);
    for (const axis of ["x", "y", "z", "w"] as const) {
      expect(view.renderOrientation[axis]).toBeCloseTo(cue.orientation[axis], 12);
    }
  });

  it.each(["default", "xyz", "position", "ballXYZ", "hardReset"] as const)(
    "%s 重摆在下一步前同步快照，并保留原作球体朝向", path => {
      const sim = makeSim();
      sim.stroke(spinStroke(sim));
      sim.step(0.02);
      const cue = sim.getBallAtIndex(0);
      const orientation = cue.orientation.clone();
      expect(Math.abs(orientation.y)).toBeGreaterThan(0);
      const target = new Vec3(7, sim.spotY, 7);
      switch (path) {
        case "default": sim.respotIndexDefault(0); break;
        case "xyz": sim.respotIndexXYZ(0, target.x, target.y, target.z); break;
        case "position": sim.resetBallPosition(cue, target); break;
        case "ballXYZ": sim.resetBallXYZ(cue, target.x, target.y, target.z); break;
        case "hardReset": sim.reset(true, true); break;
      }
      const view = sim.getBallView(0);
      expect(view.renderPosition).toEqual(path === "default" || path === "hardReset" ? cue.spot : target);
      expect(cue.orientation).toEqual(orientation);
      for (const axis of ["x", "y", "z", "w"] as const) {
        expect(view.renderOrientation[axis]).toBeCloseTo(orientation[axis], 12);
      }
      sim.resetBallPosition(cue, null);
      expect(sim.getBallView(0).active).toBe(false);
      expect(sim.getBallView(0).async).toBe(false);
    }
  );

  it("restore 后立即显示存档姿态，不沿用读档前的显示位置", () => {
    const sim = makeSim();
    sim.stroke(spinStroke(sim));
    sim.step(0.02);
    const saved = sim.serialize();
    const position = sim.getBallAtIndex(0).position.clone();
    const orientation = sim.getBallAtIndex(0).orientation.clone();
    sim.respotIndexXYZ(0, 7, sim.spotY, 7);
    sim.restore(saved);
    const view = sim.getBallView(0);
    expect(view.position).toEqual(position);
    expect(view.renderPosition).toEqual(position);
    for (const axis of ["x", "y", "z", "w"] as const) {
      expect(view.renderOrientation[axis]).toBeCloseTo(orientation[axis], 12);
    }
    expect(sim.serialize()).toEqual(saved);
  });

  it("反复预测保留全部显示快照，包括非零剩余时间的偏移", () => {
    const sim = makeSim();
    sim.stroke(spinStroke(sim));
    sim.step(0.005);
    const views = Array.from({ length: sim.getBallCount() }, (_, index) => sim.getBallView(index));
    expect(views[0].renderPosition.x).not.toBe(views[0].position.x);
    for (let repeat = 0; repeat < 2; ++repeat) {
      sim.predict(stroke(sim, 20), 5);
      for (let index = 0; index < views.length; ++index) {
        expect(sim.getBallView(index)).toEqual(views[index]);
      }
    }
  });

  it("stroke 和软 reset 不立即改变显示姿态", () => {
    const sim = makeSim();
    sim.stroke(spinStroke(sim));
    sim.step(0.005);
    const view = sim.getBallView(0);
    sim.stroke(stroke(sim));
    sim.reset(false, true);
    expect(sim.getBallView(0)).toEqual(view);
  });

  it("显示数值快照与核心及其他快照隔离，旧快照不随步进改变", () => {
    const sim = makeSim();
    const first = sim.getBallView(0);
    const second = sim.getBallView(0);
    const physical = sim.serialize();
    Reflect.set(first.renderPosition, "x", -999);
    Reflect.set(first.renderOrientation, "w", -999);
    expect(sim.getBallView(0)).toEqual(second);
    expect(sim.serialize()).toEqual(physical);
    sim.stroke(spinStroke(sim));
    sim.step(0.005);
    expect(second.renderPosition).toEqual({ x: 5, y: sim.spotY, z: 5 });
    expect(second.renderOrientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(sim.getBallView(0).renderPosition.x).not.toBe(second.renderPosition.x);
  });

  it.each([
    { ballRadius: 0 }, { ballMass: NaN }, { ballSet: [] }, { ballSet: [0, 1] }, { ballSet: [0, NaN, 0] }
  ])("拒绝非法场景参数 %j", parameters => {
    expect(() => new Simulator(makeTable(), { ...DEFAULT_SCENE, ...parameters })).toThrow("invalid simulator sync opts");
  });
});
