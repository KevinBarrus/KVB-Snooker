import { describe, expect, it } from "vitest";
import { CuePosePublisher, CuePoseBuffer } from "../cue-pose.js";
import { isCuePose, type CuePose, type CuePoseState } from "../protocol.js";

const upright: CuePose = { x: -2, y: 1.7, z: 0, yaw: 0, pitch: Math.PI / 2 };
const aiming: CuePose = { x: -1, y: .9, z: 0, yaw: .2, pitch: -.03 };
const state = (sequence: number, pose: CuePose | null, version = 0): CuePoseState =>
  ({ type: "cue-pose", seat: 0, version, sequence, serverTimeMs: 1000, pose });

describe("非权威瞄准姿态", () => {
  it("只在允许操作时发布，入位和隐藏及时发送，变化限10Hz，静止每秒保活", () => {
    const publisher = new CuePosePublisher();
    expect(publisher.update(0, 0, false, upright)).toBeNull();
    expect(publisher.update(0, 0, true, null)?.pose).toBeNull();
    expect(publisher.update(20, 0, true, upright)?.pose).toEqual(upright);
    expect(publisher.update(60, 0, true, aiming)).toBeNull();
    expect(publisher.update(120, 0, true, aiming)?.sequence).toBe(3);
    expect(publisher.update(250, 0, true, aiming)).toBeNull();
    expect(publisher.update(1120, 0, true, aiming)?.sequence).toBe(4);
    expect(publisher.update(1130, 0, true, null)?.sequence).toBe(5);
    expect(publisher.update(1131, 1, true, aiming)?.expectedVersion).toBe(1);
  });

  it("到达时间插值连续旋转，不依赖服务器墙钟；yaw穿越π时走最短方向", () => {
    const buffer = new CuePoseBuffer();
    buffer.push(state(1, { ...upright, yaw: Math.PI - .1 }), 0);
    buffer.push({ ...state(2, { ...aiming, yaw: -Math.PI + .1 }), serverTimeMs: -90000 }, 100);
    const middle = buffer.sample(150)!;
    expect(middle.x).toBe(-1.5);
    expect(middle.pitch).toBeCloseTo((upright.pitch + aiming.pitch) / 2);
    expect(middle.yaw).toBeCloseTo(Math.PI);
    expect(buffer.sample(200)?.pitch).toBeCloseTo(aiming.pitch, 12);
  });

  it("隐藏和版本交接清除旧姿态，旧序号或旧回合不复活球杆", () => {
    const buffer = new CuePoseBuffer();
    buffer.push(state(2, upright), 0);
    buffer.push(state(1, aiming), 100);
    expect(buffer.sample(200)).toEqual(upright);
    buffer.push(state(3, null), 200);
    expect(buffer.sample(200)).toBeNull();
    buffer.advanceVersion(1);
    buffer.push(state(4, upright, 0), 300);
    expect(buffer.sample(400)).toBeNull();
    buffer.push(state(5, aiming, 1), 400);
    expect(buffer.sample(400)).toEqual(aiming);
    buffer.clear();
    expect(buffer.sample(500)).toBeNull();
  });

  it("拒绝缺失、非有限及越界姿态，隐藏值合法", () => {
    expect(isCuePose(upright)).toBe(true);
    expect(isCuePose(null)).toBe(true);
    for (const bad of [undefined, [], {}, { ...upright, x: NaN }, { ...upright, pitch: Infinity },
      { ...upright, y: -1 }, { ...upright, z: 100 }]) expect(isCuePose(bad)).toBe(false);
  });
});
