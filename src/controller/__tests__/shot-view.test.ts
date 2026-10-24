import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import { CameraRig } from "../camera-rig.js";

const cue = { x: -1.04, y: .90625, z: -.145 };
function ready(): CameraRig {
  const rig = new CameraRig(new EventBus(), cue);
  rig.setState(1, true);
  tick(rig, 0);
  return rig;
}
function tick(rig: CameraRig, dt = 1 / 60): void { rig.update(dt); rig.updateHead(0, 0, dt); }

describe("Shot observation", () => {
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
