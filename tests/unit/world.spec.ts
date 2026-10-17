import { describe, expect, it } from "vitest";
import { BodySphere } from "../../src/core/physics/ball.js";
import { MeshBody, type CollisionMeshData } from "../../src/core/physics/mesh-body.js";
import { World, WorldClient } from "../../src/core/physics/index.js";
import { Body } from "../../src/core/physics/body.js";

// 测试球台：10×10 平地面（y=0.88），仅 ground 分区（台面数据的最小可测构型）。
function makeTable(): MeshBody {
  const p = (x: number, z: number) => [x, 0.88, z];
  const data: CollisionMeshData = {
    ground: {
      p: [...p(0, 0), ...p(10, 0), ...p(10, 10), ...p(0, 10)],
      q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
    }
  };
  return new MeshBody(data);
}

const BALL_RADIUS = 1;
const GROUND_Y = 0.88;

/** 手工 set 速度后的必置脏路径（原作数据流必经 predVelocities/applyImpulse）。 */
function markDirty(ball: Body): void {
  ball.vProp_dirty = true;
  ball.wProp_dirty = true;
  ball.__vStateDirty = true;
}

describe("World（PCOL L11776-12105）", () => {
  it("生命周期：ready 前 addBall/setMeshBody 合法，ready 后抛错", () => {
    const world = new World();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    const ball = new BodySphere(BALL_RADIUS, 1.5, 5, 5, 5);
    world.addBall(ball);
    world.reset();
    expect(world.environmentReady).toBe(true);
    expect(() => world.addBall(new BodySphere(1, 1))).toThrow();
    expect(() => world.setMeshBody(makeTable())).toThrow();
    expect(ball.uid).toBe(1); // nPolygons=1 → 球 uid 从 1 起
    expect(ball.restitution).toBeCloseTo(0.985, 10); // setBallFrictionAndRestitution
    expect(ball.friction).toBeCloseTo(0.01, 10);
  });

  it("stepSize setter 推导睡眠能量阈值与 gt 阈值向量", () => {
    const world = new World();
    world.stepSize = 0.0167;
    const bias = Math.pow(Body.baseSleepBias, 0.0167);
    const expected = Math.round(19 * 0.0167 * (1 - bias) * 0.5 * 1e3) / 1e3;
    expect(Body.minEnergy).toBeCloseTo(expected, 3);
    expect(Body.maxEnergy).toBeCloseTo(4.5 * expected, 5);
    expect(Body.wakeUpEnergy).toBeCloseTo(1.4 * expected, 5);
  });

  it("自由落体：CCD 精确触桌贴合 → 全员入睡 → 快进（accumulator 清零）", () => {
    const world = new WorldClient();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    world.addBall(new BodySphere(BALL_RADIUS, 1.5, 5, 5, 5));
    world.reset();
    world.save();
    let frames = 0;
    for (; frames < 200; ++frames) {
      world.step(0.0167);
      if (world.nAwakened === 0) break;
    }
    expect(frames).toBeGreaterThan(10);
    const ball = world.balls[0];
    expect(ball.asleep).toBe(true);
    expect(ball.position.y).toBeCloseTo(GROUND_Y + BALL_RADIUS, 1); // CCD 顶点贴合
    expect(world.accumulator).toBe(0); // 睡眠快进
  });

  it("出界：重心跌穿 lowestBound → inactivateBall + outOfBoundsHandler", () => {
    const world = new World();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    world.addBall(new BodySphere(BALL_RADIUS, 1.5, 15, 5, 5)); // 台外：球-桌 CCD 无解
    world.reset();
    const fallen: number[] = [];
    world.onOutOfBounds((ball) => fallen.push(ball.uid));
    for (let i = 0; i < 200 && world.balls[0].active; ++i) world.step(0.0167);
    expect(world.balls[0].active).toBe(false);
    expect(fallen.length).toBe(1);
  });

  it("shoot：击球接触冲量赋予母球速度并唤醒", () => {
    const world = new World();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    world.addBall(new BodySphere(BALL_RADIUS, 1.5, 5, GROUND_Y + BALL_RADIUS, 5));
    world.reset();
    const cue = world.balls[0];
    cue.setSleep();
    // e = [触点(球面 −x 侧), 方向 +x, 力度 2, 皮头半径 0.005]
    const center = cue.position;
    world.shoot(cue, [
      center.x - 0.02, center.y, center.z,
      1, 0, 0,
      2,
      0.005
    ]);
    // 0.15kg 皮头对 1.5kg 球：J = 2/(1/1.5+1/0.15)·/1.5 ≈ 0.18 m/s——量级保真
    expect(cue.v.x).toBeGreaterThan(0.1);
    expect(cue.asleep).toBe(false);
  });

  it("球-球 CCD：撞击瞬间精确求解（两球心距不穿透）", () => {
    const world = new WorldClient();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    const a = new BodySphere(BALL_RADIUS, 1.5, 5, GROUND_Y + BALL_RADIUS, 5);
    const b = new BodySphere(BALL_RADIUS, 1.5, 5, GROUND_Y + BALL_RADIUS, 5 + 2 * BALL_RADIUS + 0.1);
    world.addBall(a);
    world.addBall(b);
    world.reset();
    world.save();
    // 母球沿 +z 直线 2 m/s
    a.predVelocities(0.0167);
    a.v.set(0, 0, 2);
    markDirty(a);
    let impacted = false;
    for (let i = 0; i < 100 && !(impacted = b.v.z !== 0); ++i) world.step(0.0167);
    expect(impacted).toBe(true);
    expect(a.position.distanceTo(b.position)).toBeGreaterThanOrEqual(2 * BALL_RADIUS - 1e-3);
  });
});

describe("WorldClient.predict（PCOL L14609-14745）", () => {
  it("预测：第一撞击锁定目标球、restore 还原初始状态", () => {
    const world = new WorldClient();
    world.stepSize = 0.0167;
    world.setMeshBody(makeTable());
    const cue = new BodySphere(BALL_RADIUS, 1.5, 5, GROUND_Y + BALL_RADIUS, 5);
    const target = new BodySphere(BALL_RADIUS, 1.5, 7, GROUND_Y + BALL_RADIUS, 5);
    (target as unknown as { number: number }).number = 12;
    world.addBall(cue);
    world.addBall(target);
    world.reset();
    world.save();
    expect(world.evolution).toBeGreaterThan(0);

    const ctx = world.predict(
      cue,
      [cue.position.x - 0.02, cue.position.y, cue.position.z, 1, 0, 0, 2, 0.005],
      10
    );
    expect(ctx.impactOccured).toBe(true);
    expect(ctx.hasImpactTarget).toBe(true);
    expect(ctx.targetNumber).toBe(12);
    // restore 还原：双球归位
    expect(world.balls[0].position.x).toBeCloseTo(5, 5);
    expect(world.balls[1].position.x).toBeCloseTo(7, 5);
  });
});
