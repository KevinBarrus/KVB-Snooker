import { describe, expect, it } from "vitest";
import { Vec3 } from "../../core/math/vec3.js";
import { ShotReplay } from "../shot-replay.js";
import { captureReplayFrame, interpolateReplayFrame, type ReplayCapture } from "../replay-frame.js";

function frame(x = 0, struck = false): ReplayCapture {
  return { balls: [{ index: 0, number: 0, active: true, async: struck, position: new Vec3(x, .90625, 0),
    renderPosition: { x, y: .90625, z: 0 }, renderOrientation: { x: 0, y: 0, z: 0, w: 1 } }],
    eye: { x: -3, y: 1.7, z: 0 }, target: { x: 0, y: .93625, z: 0 }, aimRatio: 0,
    firstKissIndex: struck ? 1 : 0, struck, cue: { visible: !struck, position: { x: -1, y: 1, z: 0 }, yaw: 0, pitch: 0 } };
}
function completed(): ShotReplay {
  const replay = new ShotReplay(); replay.begin(frame());
  for (let i = 1; i <= 20; ++i) replay.record(.05, frame(i / 20, i >= 10));
  replay.finish(frame(1, true)); return replay;
}

describe("Last shot replay", () => {
  it("完整记录才开放入口，下一杆立即清除旧片段", () => {
    const replay = new ShotReplay(); expect(replay.open()).toBe(false);
    replay.begin(frame());
    for (let i = 0; i < 10; ++i) replay.record(.1, frame(.1 * i));
    expect(replay.available).toBe(false);
    replay.finish(frame(1)); expect(replay.available).toBe(true);
    expect(replay.open()).toBe(true); expect(replay.open()).toBe(false);
    replay.close(); replay.begin(frame(2));
    expect(replay.available).toBe(false); expect(replay.open()).toBe(false);
  });

  it("记录和输出均复制姿态，不持有可改写核心的引用", () => {
    const replay = new ShotReplay(), first = frame(); replay.begin(first);
    first.balls[0].position.x = 99;
    for (let i = 0; i < 12; ++i) replay.record(.05, frame(1));
    replay.finish(frame(1)); replay.open();
    expect(replay.getBallView(0).position.x).toBe(0);
    const copy = replay.getBallView(0); copy.position.x = -99;
    expect(replay.getBallView(0).position.x).toBe(0);
    expect(first.balls[0].position.x).toBe(99);
  });

  it("播放暂停、四分之一慢放、进度定位、到尾暂停及重播", () => {
    const replay = completed(); replay.open(); replay.update(.2);
    expect(replay.playHead).toBeCloseTo(.2);
    replay.toggle(); replay.update(1); expect(replay.playHead).toBeCloseTo(.2);
    replay.rate = .25; replay.toggle(); replay.update(.4);
    expect(replay.playHead).toBeCloseTo(.3);
    expect(replay.getResult().firstKissIndex).toBe(0);
    replay.seek(.75); expect(replay.paused).toBe(true);
    expect(replay.getBallView(0).position.x).toBeCloseTo(.75);
    expect(replay.getResult().firstKissIndex).toBe(1);
    replay.toggle(); replay.update(10);
    expect(replay.paused).toBe(true); expect(replay.playHead).toBe(replay.duration);
    replay.toggle(); expect(replay.playHead).toBe(0); expect(replay.paused).toBe(false);
    replay.close(); replay.update(10); expect(replay.playHead).toBe(0);
  });

  it("姿态插值保持四元数单位长度、球杆最短转角及离散显隐时刻", () => {
    const a = frame(), b = { ...frame(1, true), balls: frame(1, true).balls.map(ball => ({ ...ball,
      active: false, renderOrientation: { x: 0, y: 1, z: 0, w: 0 } })) };
    a.cue.yaw = Math.PI - .1; b.cue.yaw = -Math.PI + .1;
    const first = captureReplayFrame(0, a), last = captureReplayFrame(1, b);
    const middle = interpolateReplayFrame(first, last, .5);
    const q = middle.balls[0].renderOrientation;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 10);
    expect(middle.cue.yaw).toBeCloseTo(Math.PI);
    expect(middle.balls[0].active).toBe(true);
    expect(middle.firstKissIndex).toBe(0);
    expect(interpolateReplayFrame(first, last, 1).balls[0].active).toBe(false);
  });

  it("记录超限或长帧失真时不提供截断回放", () => {
    const limited = new ShotReplay(3); limited.begin(frame());
    for (let i = 0; i < 10; ++i) limited.record(.1, frame(i));
    limited.finish(frame()); expect(limited.available).toBe(false);
    const stalled = completed(); stalled.begin(frame()); stalled.record(.11, frame()); stalled.finish(frame());
    expect(stalled.available).toBe(false);
    const short = new ShotReplay(); short.begin(frame()); short.record(.1, frame()); short.finish(frame());
    expect(short.available).toBe(false);
  });
});
