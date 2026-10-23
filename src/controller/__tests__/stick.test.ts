import { describe, expect, it } from "vitest";
import * as B from "babylonjs/es6.js";
import { Vec3 } from "../../core/math/vec3.js";
import type { BallView } from "../../core/simulator/shot-result.js";
import { StickController } from "../stick-controller.js";
import { sphereRayDistance } from "../stick-obstacles.js";
import { TipMotion } from "../tip-motion.js";

const radius = 0.02625;
const azimuth = { forward: { x: 1, y: 0, z: 0 }, side: { x: 0, y: 0, z: 1 }, angle: 0 };

function setup(x = 0, z = 0, other?: { x: number; z: number; number?: number; active?: boolean }) {
  const views: BallView[] = [{ index: 0, number: 0, active: true, async: false,
    position: new Vec3(x, 0.90625, z), renderPosition: { x, y: 0.90625, z },
    renderOrientation: { x: 0, y: 0, z: 0, w: 1 } }];
  if (other) views.push({ ...views[0], index: 1, number: other.number ?? 1, active: other.active ?? true,
    position: new Vec3(other.x, 0.90625, other.z) });
  const source = { getBallCount: () => views.length, getBallView: (index: number) => views[index] };
  const stick = new StickController(source, radius);
  stick.resetAimPoint(views[0].position);
  stick.leadingSpace = -0.015;
  stick.syncPerson({ x: x - 0.38, y: 1.7, z }, azimuth, 1);
  for (let i = 0; i < 30; ++i) stick.update();
  return { stick, views };
}

describe("StickController", () => {
  it("无障碍触点位于球+皮头球面，支持点高度令正中杆仍略向下", () => {
    const { stick, views } = setup();
    expect(stick.isReadyToStroke()).toBe(true);
    expect(stick.kissDir.length()).toBeCloseTo(1, 12);
    expect(B.Vector3.Distance(stick.kissPoint, new B.Vector3(0, 0.90625, 0))).toBeCloseTo(radius + 0.005, 12);
    expect(stick.kissDir.y).toBeCloseTo(-0.023125 / Math.hypot(0.66, 0.023125), 7);
    expect(stick.worldMatrix.m[12]).toBeCloseTo(stick.position.x, 7);
    expect(views[0].position).toEqual(new Vec3(0, 0.90625, 0));
  });

  it("力度端点1.6/105.8，八字段按Float32输出", () => {
    const { stick } = setup();
    expect(stick.getStrokeVars(0)[6]).toBe(Math.fround(1.6));
    expect(stick.getStrokeVars(1)[6]).toBe(Math.fround(105.8));
    expect(stick.getStrokeVars(0.5)).toHaveLength(8);
    expect(stick.getStrokeVars(0.5)[7]).toBe(Math.fround(0.005));
  });

  it("spin按圆限幅，鼠标主轴吸附，动画结束前不可出杆", () => {
    const a = setup().stick, b = setup().stick;
    a.setTipPercent(20, 20);
    b.setTipPercent(Math.SQRT1_2, Math.SQRT1_2);
    a.update(); b.update();
    expect(Array.from(a.getStrokeVars(0.5))).toEqual(Array.from(b.getStrokeVars(0.5)));
    a.clearTip(); a.update();
    a.moveLocTip(100, 20);
    a.update();
    expect(a.isReadyToStroke()).toBe(false);
    b.setTipPercent(0.008 / 0.01575, 0); b.update();
    expect(Array.from(a.getStrokeVars(0.5))).toEqual(Array.from(b.getStrokeVars(0.5)));
    for (let i = 0; i < 20; ++i) a.update();
    expect(a.isReadyToStroke()).toBe(true);
  });

  it("抬杆角上下界夹取，球杆瞄准姿态只在ratio=1时可出杆", () => {
    const a = setup().stick, b = setup().stick;
    a.setAngleV(100); b.setAngleV(Math.PI / 4);
    a.update(); b.update();
    expect(Array.from(a.getStrokeVars(0.5))).toEqual(Array.from(b.getStrokeVars(0.5)));
    a.setAngleV(-1); b.setAngleV(0); a.update(); b.update();
    expect(Array.from(a.getStrokeVars(0.5))).toEqual(Array.from(b.getStrokeVars(0.5)));
    a.syncPerson({ x: -0.38, y: 1.7, z: 0 }, azimuth, 0.5); a.update();
    expect(a.isReadyToStroke()).toBe(false);
  });

  it("球挡杆与库边自动抬杆；非活跃球及number0不挡杆", () => {
    const clear = setup().stick.kissDir.y;
    expect(setup(0, 0, { x: -0.12, z: 0 }).stick.kissDir.y).toBeLessThan(clear);
    expect(setup(-1.75, 0).stick.kissDir.y).toBeLessThan(clear);
    expect(setup(0, 0, { x: -0.12, z: 0, active: false }).stick.kissDir.y).toBe(clear);
    expect(setup(0, 0, { x: -0.12, z: 0, number: 0 }).stick.kissDir.y).toBe(clear);
  });

  it("反向相同斜率保留旧水平角，预测脏标记消费后清零", () => {
    const { stick } = setup();
    const direction = stick.kissDir.clone();
    expect(stick.consumePredictionChanged()).toBe(true);
    expect(stick.consumePredictionChanged()).toBe(false);
    stick.syncPerson({ x: 0.38, y: 1.7, z: 0 }, azimuth, 1); stick.update();
    expect(stick.kissDir.asArray()).toEqual(direction.asArray());
    expect(stick.consumePredictionChanged()).toBe(false);
  });

  it("射线切线无命中，起点内侧最近根按原作夹0", () => {
    expect(sphereRayDistance({ x: 1, y: 0, z: 0 }, { x: -1, y: 1, z: 0 }, 1)).toBe(Number.MAX_VALUE);
    expect(sphereRayDistance({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1)).toBe(0);
  });
});

describe("TipMotion", () => {
  it("按原三段时长触球，tick最多20ms，回退可切到精确触球点", () => {
    const { stick, views } = setup();
    const motion = new TipMotion();
    const delay = motion.launch(stick, 0.5);
    expect(delay).toBeCloseTo(0.525 + 2 * (0.1875 + 0.015) / 6, 12);
    expect(motion.tick(1)).toBe(0.02);
    motion.rewind(0.005);
    let elapsed = 0.015;
    while (elapsed < delay - 1e-8) elapsed += motion.tick(Math.min(0.02, delay - elapsed));
    motion.updateLength(views[0].position, radius);
    expect(motion.length).toBeCloseTo(0, 10);
    expect(motion.pullbackProgress).toBe(1);
    expect(motion.isReady()).toBe(false);
  });

  it("完成跟杆后仍不能二次发射，reset恢复初始gap和ready", () => {
    const { stick } = setup();
    const motion = new TipMotion();
    motion.launch(stick, 0.5);
    let elapsed = 0;
    while (motion.needsUpdate) { elapsed += motion.tick(0.02); motion.updateLength({ x: 5, y: 0.90625, z: 0 }, radius); }
    expect(elapsed).toBeGreaterThan(0.5925);
    expect(motion.length).toBeCloseTo(stick.getSlowDownDistance(0.5, 0.25), 12);
    expect(motion.isReady()).toBe(false);
    motion.reset();
    expect(motion.isReady()).toBe(true);
    expect(motion.length).toBe(-0.015);
  });
});
