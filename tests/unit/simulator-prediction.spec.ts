import { describe, expect, it } from "vitest";
import { MeshBody, type CollisionMeshData } from "../../src/core/physics/mesh-body.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";

function setup(wall = false) {
  const data: CollisionMeshData = { ground: {
    p: [-5, .88, -5, 5, .88, -5, 5, .88, 5, -5, .88, 5],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } };
  if (wall) data.side = {
    p: [1, .88, -3, 1, 2, -3, 1, 2, 3, 1, .88, 3],
    q: [{ i: [0, 1, 2, 3], n: [-1, 0, 0], f: ["side"] }]
  };
  const sim = new Simulator(new MeshBody(data), {
    ...DEFAULT_SCENE, ballSet: wall ? [0, 0, 0] : [0, 0, 0, 2, .3, 0]
  });
  for (let i = 0; i < 200 && sim.nAwakened; ++i) sim.step(.1);
  expect(sim.nAwakened).toBe(0);
  return sim;
}

function stroke(sim: Simulator, dx = 1): Float32Array {
  const p = sim.getCueBallPosition();
  return new Float32Array([p.x - dx * sim.ballRadius, p.y, p.z, dx, 0, 0, 20, .005]);
}

// PCOL L14626-14741
describe("辅助线预测快照", () => {
  it("球球碰撞返回起点、碰撞点及双方运动快照，预测不改世界或显示状态", () => {
    const sim = setup();
    const saved = sim.serialize(), result = sim.getResult();
    const views = Array.from({ length: sim.getBallCount() }, (_, i) => sim.getBallView(i));
    const prediction = sim.predict(stroke(sim), 1.6);
    expect(prediction.impactOccured && prediction.hasImpactTarget).toBe(true);
    expect(prediction.targetNumber).toBe(2);
    expect(prediction.p0.x).toBe(0);
    expect(prediction.p1.x).toBeCloseTo(.3 - 2 * sim.ballRadius, 5);
    expect(prediction.p2.x).toBeCloseTo(.3, 5);
    expect(prediction.target.x).toBeGreaterThan(prediction.p2.x);
    expect(prediction.targetVSq).toBeGreaterThan(0);
    expect(prediction.cueVSq).toBeGreaterThanOrEqual(0);
    expect(sim.serialize()).toEqual(saved);
    expect(sim.getResult()).toEqual(result);
    expect(sim.nAwakened).toBe(0);
    expect(views).toEqual(Array.from({ length: sim.getBallCount() }, (_, i) => sim.getBallView(i)));
    expect(Object.keys(prediction)).not.toContain("b1");
    expect(Object.keys(prediction)).not.toContain("b2");
  });

  it("未撞击仅更新母球路径，保留但不启用旧目标字段", () => {
    const sim = setup();
    const hit = sim.predict(stroke(sim), 1.6);
    const saved = structuredClone(hit);
    const miss = sim.predict(stroke(sim, -1), .5);
    expect(miss.impactOccured || miss.hasImpactTarget).toBe(false);
    expect(miss.cue.x).toBeLessThan(-.4);
    expect(miss.p2).toEqual(hit.p2);
    expect(miss.target).toEqual(hit.target);
    expect(miss.targetNumber).toBe(hit.targetNumber);
    expect(hit).toEqual(saved);
  });

  it("库边首次碰撞有母球撞点，没有目标球", () => {
    const sim = setup(true);
    const saved = sim.serialize();
    const prediction = sim.predict(stroke(sim), 1.6);
    expect(prediction.impactOccured).toBe(true);
    expect(prediction.hasImpactTarget).toBe(false);
    expect(prediction.p1.x).toBeCloseTo(1 - sim.ballRadius, 5);
    expect(prediction.cue.x).toBeLessThan(prediction.p1.x);
    expect(sim.serialize()).toEqual(saved);
  });

  it("位置对象为独立副本，外部写入不会污染下一次预测或物理球", () => {
    const sim = setup();
    const expected = sim.predict(stroke(sim), 1.6);
    const actual = sim.predict(stroke(sim), 1.6);
    for (const key of ["p0", "p1", "cue", "p2", "target"] as const) {
      expect(Object.getPrototypeOf(actual[key])).toBe(Object.prototype);
      Object.assign(actual[key], { x: 999, y: 999, z: 999 });
    }
    actual.impactV1.setZero();
    expect(sim.predict(stroke(sim), 1.6)).toEqual(expected);
    expect(sim.getCueBallPosition().x).toBe(0);
  });
});
