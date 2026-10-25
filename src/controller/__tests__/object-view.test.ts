import { describe, expect, it } from "vitest";
import { Vec3 } from "../../core/math/vec3.js";
import { ShotView } from "../shot-view.js";

const eye = { x: -3, y: 1.7, z: 0 };
function setup() {
  const balls = [0, 1, 2].map(index => ({ index, number: index, active: true, async: true,
    position: new Vec3(index * .5, .90625, 0), renderPosition: { x: index * .5, y: .90625, z: 0 },
    renderOrientation: { x: 0, y: 0, z: 0, w: 1 } }));
  const result = { firstKissIndex: 0, nKissed: 0, pottedIndices: [], outOfBoundsIndices: [] };
  const source = { getBallCount: () => balls.length, getBallView: (index: number) => balls[index], getResult: () => result };
  const move = (index: number, x: number, z: number) => {
    balls[index].position.set(x, .90625, z); balls[index].renderPosition = { x, y: .90625, z };
  };
  const object = new ShotView(), cue = new ShotView();
  object.mode = "object"; cue.mode = "cue";
  for (const view of [object, cue]) { view.begin({ x: 0, y: .93625, z: 0 }); view.struck = true; }
  const tick = (view: ShotView, dt = 1 / 60) => { view.track(source); view.update(dt, 1, eye); };
  return { balls, result, object, cue, move, tick };
}

describe("Object observation handoff", () => {
  it("长台首碰前连续轻随母球，首碰当帧保持视线与转速，随后锁定子球", () => {
    for (const fps of [30, 60, 144]) {
      const { object, cue, move, tick, result } = setup();
      for (let frame = 0; frame < fps / 2; ++frame) {
        move(0, frame / fps, frame / fps);
        tick(object, 1 / fps); tick(cue, 1 / fps);
        expect(object.target.asArray()).toEqual(cue.target.asArray());
      }
      expect(object.target.x).toBeGreaterThan(.1);
      expect(object.target.z).toBeGreaterThan(.1);
      move(1, .8, -.6); result.firstKissIndex = 1;
      const before = object.target.clone();
      tick(object, 1 / fps); tick(cue, 1 / fps);
      expect(object.target.asArray()).toEqual(cue.target.asArray());
      expect(object.target.subtract(before).length()).toBeGreaterThan(1e-5);
      for (let frame = 0; frame < fps * 3; ++frame) {
        move(0, -1, .8);
        if (frame > fps / 2) result.firstKissIndex = 2;
        tick(object, 1 / fps);
      }
      expect(object.target.x).toBeCloseTo(.8, 3);
      expect(object.target.z).toBeCloseTo(-.6, 3);
    }
  });

  it("贴球立即首碰也从母球观察点接续，不跳到远处子球", () => {
    const { object, cue, move, tick, result } = setup();
    move(0, .03, 0); move(1, .08, .02); result.firstKissIndex = 1;
    tick(object); tick(cue);
    expect(object.target.asArray()).toEqual(cue.target.asArray());
    for (let frame = 0; frame < 240; ++frame) { move(1, 1.5, -.8); tick(object); }
    expect(object.target.x).toBeCloseTo(1.5, 3);
    expect(object.target.z).toBeCloseTo(-.8, 3);
  });

  it("未命中时持续观察母球，母球出界后保留最后有效焦点", () => {
    const { object, cue, balls, move, tick } = setup();
    move(0, .7, .3);
    for (let frame = 0; frame < 180; ++frame) { tick(object); tick(cue); }
    expect(object.target.asArray()).toEqual(cue.target.asArray());
    balls[0].active = false; move(0, 3, 2);
    for (let frame = 0; frame < 180; ++frame) tick(object);
    expect(object.target.x).toBeCloseTo(.7, 4);
    expect(object.target.z).toBeCloseTo(.3, 4);
  });

  it("交接中任一球落袋不追袋底，也不切换到其他子球", () => {
    for (const lost of [0, 1]) {
      const { object, balls, result, move, tick } = setup();
      move(0, .4, .1); move(1, .5, .2);
      for (let frame = 0; frame < 30; ++frame) tick(object);
      result.firstKissIndex = 1;
      for (let frame = 0; frame < 6; ++frame) tick(object);
      balls[lost].active = false; balls[lost].position.y = -.5;
      balls[lost].renderPosition = { x: 3, y: -.5, z: 2 };
      result.firstKissIndex = 2;
      for (let frame = 0; frame < 240; ++frame) tick(object);
      expect(object.target.x).toBeCloseTo(.5, 4);
      expect(object.target.z).toBeCloseTo(.2, 4);
      expect(object.target.y).toBeCloseTo(.93625, 6);
    }
  });

  it("交接中手动观察不被抢回，下一杆重新从母球开始", () => {
    const { object, cue, result, move, tick } = setup();
    result.firstKissIndex = 1; tick(object);
    object.takeManual(); const held = object.target.clone();
    move(1, 1.5, -.6);
    for (let frame = 0; frame < 60; ++frame) tick(object);
    expect(object.target.asArray()).toEqual(held.asArray());
    result.firstKissIndex = 0;
    for (const view of [object, cue]) { view.begin(held); view.struck = true; }
    move(0, -.5, .2);
    for (let frame = 0; frame < 60; ++frame) { tick(object); tick(cue); }
    expect(object.manual).toBe(false);
    expect(object.target.asArray()).toEqual(cue.target.asArray());
  });
});
