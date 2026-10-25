import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import { CameraRig } from "../camera-rig.js";
import { ShotView, isShotViewMode } from "../shot-view.js";
import { FocusSmoothing } from "../focus-smoothing.js";
import { Vec3 } from "../../core/math/vec3.js";

const cue = { x: -1.04, y: .90625, z: -.145 };
function ready(): CameraRig {
  const rig = new CameraRig(new EventBus(), cue);
  rig.setState(1, true);
  tick(rig, 0);
  return rig;
}
function tick(rig: CameraRig, dt = 1 / 60): void { rig.update(dt); rig.updateHead(0, 0, dt); }

describe("Shot observation", () => {
  function source() {
    const balls = [0, 1, 2].map(index => ({ index, number: index, active: true, async: true,
      position: new Vec3(index * .4, .90625, .2), renderPosition: { x: index * .4, y: .90625, z: .2 },
      renderOrientation: { x: 0, y: 0, z: 0, w: 1 } }));
    const result = { firstKissIndex: 0, nKissed: 0, pottedIndices: [], outOfBoundsIndices: [] };
    return { balls, result, getBallCount: () => balls.length, getBallView: (index: number) => balls[index], getResult: () => result };
  }

  it("首碰前不读上一杆目标，子球首碰后锁定且落袋冻结", () => {
    const data = source(), view = new ShotView();
    view.mode = "object"; view.begin({ x: 0, y: .93625, z: 0 });
    data.result.firstKissIndex = 1;
    view.track(data); view.update(1 / 60, 0, { x: -3, y: 1.7, z: 0 });
    expect(view.target.x).toBe(0);
    view.struck = true;
    for (let i = 0; i < 240; ++i) { view.track(data); view.update(1 / 60, 0, { x: -3, y: 1.7, z: 0 }); }
    expect(view.target.x).toBeCloseTo(.4, 4);
    data.result.firstKissIndex = 2;
    data.balls[1].position.y = -.2;
    data.balls[1].renderPosition.x = 1.8;
    for (let i = 0; i < 240; ++i) { view.track(data); view.update(1 / 60, 0, { x: -3, y: 1.7, z: 0 }); }
    expect(view.target.x).toBeCloseTo(.4, 4);
    expect(view.target.y).toBeCloseTo(.93625, 6);
  });

  it("三模式共享逐帧起身位置，运动中切换不瞬移视线", () => {
    const data = source(); data.result.firstKissIndex = 1;
    const rigs = [ready(), ready(), ready()];
    for (const [index, mode] of (["natural", "cue", "object"] as const).entries()) {
      rigs[index].shotView.mode = mode; rigs[index].beginShotView(); rigs[index].shotView.struck = true; rigs[index].setState(0);
    }
    for (let frame = 0; frame < 180; ++frame) {
      data.balls[0].renderPosition.z = .8 * Math.sin(frame / 15);
      for (const rig of rigs) { rig.shotView.track(data); tick(rig); }
      expect(rigs[1].position.asArray()).toEqual(rigs[0].position.asArray());
      expect(rigs[2].position.asArray()).toEqual(rigs[0].position.asArray());
    }
    const before = rigs[1].target.clone();
    rigs[1].shotView.setMode("object", before); tick(rigs[1], 0);
    expect(rigs[1].target.asArray()).toEqual(before.asArray());
  });

  it("高速变向限制每帧转动并能追上，跨帧率结果接近", () => {
    const results: number[] = [];
    for (const fps of [30, 60, 144]) {
      const smoothing = new FocusSmoothing(), point = { x: 0, y: .93625, z: 0 };
      const eye = { x: -2, y: 1.7, z: 0 }, goal = { x: -.5, y: .93625, z: .85 };
      let previous = 0;
      for (let frame = 0; frame < fps * 2; ++frame) {
        smoothing.update(point, goal, eye, 1 / fps);
        const angle = Math.atan2(point.z, point.x + 2);
        expect(Math.abs(angle - previous)).toBeLessThanOrEqual(3.4 / fps + 1e-8);
        previous = angle;
      }
      expect(Math.abs(previous - Math.atan2(.85, 1.5))).toBeLessThan(.02);
      results.push(previous);
    }
    expect(Math.max(...results) - Math.min(...results)).toBeLessThan(.003);
    expect(isShotViewMode("cue")).toBe(true);
    expect(isShotViewMode("invalid")).toBe(false);
  });

  it("尚未起身时切回自然模式也限制转向速度", () => {
    const view = new ShotView(); view.begin({ x: 0, y: .93625, z: 0 });
    const eye = { x: -.38, y: 1.02, z: 0 };
    view.setMode("natural", { x: 0, y: .93625, z: .9 });
    const before = Math.atan2(view.target.z, view.target.x - eye.x);
    view.update(1 / 60, 1, eye);
    const after = Math.atan2(view.target.z, view.target.x - eye.x);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3.4 / 60);
    expect(after).toBeLessThan(before);
  });

  it("子球首碰从近焦点接入远球时不突抬视线，反向运动同时约束俯仰和水平转动", () => {
    for (const fps of [30, 60, 144]) {
      const data = source(), view = new ShotView(), eye = { x: -.38, y: 1.04, z: 0 };
      view.mode = "object"; view.begin({ x: 0, y: .93625, z: 0 }); view.struck = true;
      const angles = () => [Math.atan2(view.target.z, view.target.x - eye.x),
        Math.atan2(view.target.y - eye.y, Math.hypot(view.target.x - eye.x, view.target.z))];
      const before = angles();
      view.track(data); view.update(1 / fps, 1, eye);
      data.result.firstKissIndex = 1;
      let previous = angles(), speed = previous.map((value, axis) => (value - before[axis]) * fps);
      for (let frame = 0; frame < fps * 3; ++frame) {
        const x = frame < fps ? 1.8 : .1, z = frame < fps ? 0 : -.4;
        data.balls[1].position.set(x, .90625, z);
        data.balls[1].renderPosition = { x, y: .90625, z };
        view.track(data); view.update(1 / fps, 1, eye);
        const current = angles(), nextSpeed = current.map((value, axis) => (value - previous[axis]) * fps);
        for (let axis = 0; axis < 2; ++axis) {
          expect(Number.isFinite(current[axis])).toBe(true);
          expect(Math.abs(nextSpeed[axis])).toBeLessThanOrEqual(3.4 + 1e-8);
          expect(Math.abs(nextSpeed[axis] - speed[axis]) * fps).toBeLessThan(12.001);
        }
        if (frame === 0) expect(Math.abs(nextSpeed[1])).toBeLessThan(.5);
        previous = current; speed = nextSpeed;
      }
      expect(previous[0]).toBeCloseTo(Math.atan2(-.4, .48), 2);
      expect(previous[1]).toBeCloseTo(Math.atan2(.93625 - eye.y, Math.hypot(.48, .4)), 2);
    }
  });

  it("自然焦点与站直同时到位，之后不再拖尾且不改变起身时长", () => {
    for (const fps of [30, 60, 144]) {
      const rig = ready(), reference = ready();
      rig.beginShotView(); rig.setState(0); reference.setState(0);
      let frames = 0;
      do {
        tick(rig, 1 / fps); tick(reference, 1 / fps); ++frames;
        expect(rig.stateRatio).toBe(reference.stateRatio);
        expect(rig.position.asArray()).toEqual(reference.position.asArray());
      } while (rig.stateRatio > 0 && frames < fps * 2);
      expect(rig.stateRatio).toBe(0);
      expect(Math.hypot(rig.target.x, rig.target.z)).toBe(0);
      expect(rig.target.y).toBe(.93625);
      const target = rig.target.clone();
      for (let frame = 0; frame < fps; ++frame) tick(rig, 1 / fps);
      expect(rig.target.asArray()).toEqual(target.asArray());
    }
  });

  it("首碰缓动中接管观察不会因焦点离开台面高度而再次抖动", () => {
    const data = source(), rig = ready();
    rig.shotView.mode = "object"; rig.beginShotView(); rig.shotView.struck = true;
    data.result.firstKissIndex = 1;
    data.balls[1].position.set(1.8, .90625, 0);
    data.balls[1].renderPosition = { x: 1.8, y: .90625, z: 0 };
    for (let i = 0; i < 3; ++i) { rig.shotView.track(data); tick(rig); }
    const before = rig.target.subtract(rig.position).normalize();
    rig.moveLookAt(.001, 0); tick(rig, 0);
    const after = rig.target.subtract(rig.position).normalize();
    expect(rig.shotView.manual).toBe(true);
    expect(Math.acos(Math.min(1, before.x * after.x + before.y * after.y + before.z * after.z))).toBeLessThan(.01);
  });

  it("自然起身保持原位置轨迹，焦点稳定移向台面中央", () => {
    const original = ready(), natural = ready();
    natural.beginShotView();
    original.setState(0); natural.setState(0);
    let last = natural.target.clone();
    for (let i = 0; i < 240; ++i) {
      tick(original); tick(natural);
      expect(natural.position.asArray()).toEqual(original.position.asArray());
      expect(natural.target.subtract(last).length()).toBeLessThan(.04);
      last = natural.target.clone();
    }
    expect(natural.position.y).toBe(1.7);
    expect(natural.target.x).toBeCloseTo(0, 3);
    expect(natural.target.z).toBeCloseTo(0, 3);
    expect(natural.isFollowing).toBe(false);
  });

  it("拖动接管后不自动抢回，下一杆恢复自动观察", () => {
    const rig = ready();
    rig.beginShotView(); rig.setState(0);
    for (let i = 0; i < 120; ++i) tick(rig);
    const before = rig.target.clone();
    rig.moveLookAt(.05, .02); tick(rig);
    expect(rig.target.subtract(before).length()).toBeLessThan(.03);
    expect(rig.shotView.manual).toBe(true);
    for (let i = 0; i < 180; ++i) tick(rig);
    expect(rig.shotView.manual).toBe(true);
    rig.endShotView();
    const held = rig.target.clone(); tick(rig);
    expect(rig.target.asArray()).toEqual(held.asArray());
    rig.beginShotView(); expect(rig.shotView.manual).toBe(false);
  });
});
