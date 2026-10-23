import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import { CameraRig } from "../camera-rig.js";
import { CameraAzimuth, CameraSpring } from "../camera-smoothing.js";
import { CameraTween } from "../camera-tween.js";

const cue = { x: -1.04, y: 0.90625, z: -0.145 };
function advance(rig: CameraRig, frames = 180, dt = 1 / 60, elevation = 0): void {
  for (let i = 0; i < frames; ++i) { rig.update(dt); rig.updateHead(0, elevation); }
}

describe("PCOL camera rig", () => {
  it("站姿位于椭圆外轨，瞄准内轨以母球为中心且半径0.38", () => {
    const rig = new CameraRig(new EventBus(), cue);
    expect(rig.bodyPosition.x).toBeCloseTo(-2.05 * 1.55, 12);
    expect(rig.position.y).toBe(1.7);
    rig.setState(1);
    advance(rig);
    expect(rig.stateRatio).toBe(1);
    expect(Math.hypot(rig.bodyPosition.x - cue.x, rig.bodyPosition.z - cue.z)).toBeCloseTo(0.38, 12);
    expect(rig.position.y).toBeCloseTo(cue.y + 0.12, 7);
  });

  it("过渡区分线性phase与缓动ratio，并保留距离自适应时长", () => {
    const rig = new CameraRig(new EventBus(), cue, 0);
    rig.setState(1);
    rig.update(0.3);
    expect(rig.stateRatio).toBe(0.25);
    expect(rig.renderedRatio).toBe(0.125);
    rig.update(0.3);
    expect(rig.stateRatio).toBeLessThan(0.5);
    expect(rig.stateRatio).toBeGreaterThanOrEqual(0.25 + 0.25 * 0.85);
  });

  it("过渡反向沿当前时间返回，不重复发start，结束载荷为最终状态", () => {
    const bus = new EventBus(), starts: number[][] = [], ends: number[][] = [];
    bus.on("ctrl/state-change-start", ({ from, to }) => starts.push([from, to]));
    bus.on("ctrl/state-change-end", ({ from, to }) => ends.push([from, to]));
    const rig = new CameraRig(bus, cue);
    rig.setState(1); rig.update(0.3); rig.setState(0); advance(rig);
    expect(starts).toEqual([[0, 1]]);
    expect(ends).toEqual([[0, 0]]);
    expect(rig.stateRatio).toBe(0);
  });

  it("蹲下站姿眼高降到1.0，瞄准时不将头部再降低0.7", () => {
    const rig = new CameraRig(new EventBus(), cue);
    rig.squatDown(); advance(rig);
    expect(rig.position.y).toBeCloseTo(1, 12);
    rig.setState(1, true); advance(rig);
    expect(rig.bodyPosition.y).toBe(1.7);
    expect(rig.position.y).toBeCloseTo(cue.y + 0.12, 7);
    rig.standUp(); advance(rig); rig.setState(0, true); advance(rig);
    expect(rig.position.y).toBe(1.7);
  });

  it("走位速度按帧累加，短按首帧的惯性阈值与长轴系数保持原值", () => {
    const rig = new CameraRig(new EventBus(), cue, 0);
    rig.orbit(undefined, 1); rig.update(0.001);
    expect(rig.bodyPosition.z).toBe(0);
    rig.update(0.001);
    const angular = (0.0018 / 15 + (0.0018 - 0.0018 / 15) / 15) * 0.82;
    expect(rig.bodyPosition.z).toBeCloseTo(Math.sin(1.55 * angular * 0.8) * 2.05, 12);
    const slow = new CameraRig(new EventBus(), cue, 0);
    slow.orbit(undefined, 1); slow.update(0.1); slow.update(0.1);
    expect(slow.bodyPosition.asArray()).toEqual(rig.bodyPosition.asArray());
    rig.orbit(undefined, 0); advance(rig, 200);
    const stopped = rig.bodyPosition.clone(); advance(rig, 20);
    expect(rig.bodyPosition.asArray()).toEqual(stopped.asArray());
  });

  it("跟球仅更新xz，落袋不会令注视高度下降", () => {
    const rig = new CameraRig(new EventBus(), cue);
    const moving = { x: 1, y: -4, z: 0.4 };
    rig.follow(() => moving); advance(rig, 500);
    expect(rig.target.x).toBeCloseTo(1, 12);
    expect(rig.target.z).toBeCloseTo(0.4, 12);
    expect(rig.target.y).toBeCloseTo(0.93625, 12);
    rig.moveLookAt(0.1, 0);
    expect(rig.isFollowing).toBe(false);
  });

  it("平杆头位保留Float32变换，加大抬杆角会后退并提高视点", () => {
    const rig = new CameraRig(new EventBus(), cue);
    rig.setState(1, true); advance(rig);
    expect(rig.position.x).toBeCloseTo(Math.fround(cue.x) - 0.38, 12);
    const flat = rig.position.clone();
    rig.updateHead(0, -Math.PI / 4);
    expect(rig.position.x).toBeLessThan(flat.x);
    expect(rig.position.y).toBeGreaterThan(flat.y);
    expect(rig.target.y).toBeGreaterThan(0.93625);
  });

  it("瞄准侧看有角度/距离限幅，重置后回到原注视点", () => {
    const rig = new CameraRig(new EventBus(), cue);
    rig.setState(1, true); advance(rig);
    rig.moveLookAt(100, 100); advance(rig, 200);
    expect(rig.target.x).toBeCloseTo(cue.x + Math.cos(0.7 * Math.PI) - 0.38, 6);
    expect(rig.target.z).toBeCloseTo(cue.z + Math.sin(0.7 * Math.PI), 6);
    rig.resetLookAt(); advance(rig, 200);
    expect(rig.target.x).toBeCloseTo(cue.x, 8);
    expect(rig.target.z).toBeCloseTo(cue.z, 8);
  });

  it("重摆更新内轨/头部原点，指定击球方向重置轨道朝向", () => {
    const rig = new CameraRig(new EventBus(), cue);
    rig.resetCue({ x: 0.5, y: cue.y, z: 0.25 });
    rig.resetWithKissDir(1, 0); rig.update(0);
    rig.setState(1, true); advance(rig);
    expect(rig.bodyPosition.x).toBeCloseTo(0.5 - 0.38, 12);
    expect(rig.bodyPosition.z).toBeCloseTo(0.25, 12);
  });

  it("斜率相同的反向向量保留旧朝向", () => {
    const azimuth = new CameraAzimuth();
    azimuth.setSlope(1, 1);
    expect(azimuth.angle).toBe(Math.PI / 4);
    azimuth.setSlope(-1, -1);
    expect(azimuth.angle).toBe(Math.PI / 4);
  });

  it("弹簧按离散速度递推，达到阈值时吸附并清除旧速度", () => {
    const spring = new CameraSpring(0.5, 0.25, 0.5, 0.0003);
    spring.to(1); spring.update();
    expect(spring.current).toBe(0.0625);
    spring.update(); expect(spring.current).toBe(0.15234375);
    spring.reset(0); spring.update(); spring.to(1); spring.update();
    expect(spring.current).toBe(0.0625);
  });

  it("tween端点按1e-6吸附，不产生超界phase", () => {
    const tween = new CameraTween(1.2);
    tween.play(); tween.update(1.2 - 5e-7);
    expect(tween.ratio).toBe(1);
    tween.reverse(); tween.update(1.2 - 5e-7);
    expect(tween.ratio).toBe(0);
  });
});
