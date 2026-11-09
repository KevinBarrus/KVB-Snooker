import { describe, expect, it } from "vitest";
import { RemoteView } from "../../src/net/remote-view.js";
import { validMotionSamples } from "../../src/net/protocol.js";
import { defaultFrameSetup, joinSeats, makeStrokeVarsFor, makeTestRoom, prepareCommand } from "./helpers.js";

function collisionRoom(speed: number, offset: number) {
  const setup = defaultFrameSetup(index => index < 2);
  const room = makeTestRoom({ tickHz: 60, prepareLeadMs: 0, frameSetup: {
    ...setup, inHand: 0, balls: setup.balls.map(ball => ({ ...ball,
      x: ball.index === 0 ? -.6 : .2, z: ball.index === 1 ? offset : 0 }))
  } });
  const { c0 } = joinSeats(room);
  const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed });
  expect(room.command(c0, prepareCommand("motion", 0, vars), 0).ack?.accepted).toBe(true);
  room.tick(0);
  return room;
}

describe("联机碰撞采样", () => {
  it.each([[15, 0], [60, .025], [100, .035]])("力度 %s 的碰撞按推进步播放真实球位，不广播外推高度", (speed, offset) => {
    const room = collisionRoom(speed, offset);
    let batchSeen = false;
    let extrapolationSeen = false;
    let maximumPhysicalHeight = -Infinity;
    let comparisons = 0;
    for (let now = 16; now <= 2000; now += 16) {
      const packet = room.tick(now).snapshot;
      const actual = room.simulator.getBallView(0);
      maximumPhysicalHeight = Math.max(maximumPhysicalHeight, actual.position.y);
      extrapolationSeen ||= Math.abs(actual.renderPosition.x - actual.position.x) > .001;
      if (!packet) continue;
      expect(packet.balls[0].x).toBe(actual.position.x);
      expect(packet.balls[0].y).toBe(actual.position.y);
      expect(validMotionSamples(packet.motion, now, 22)).toBe(true);
      batchSeen ||= (packet.motion?.length ?? 0) >= 3;
      for (const sample of packet.motion ?? []) {
        if (sample.serverTimeMs + 100 < now || packet.phase !== "simulating") continue;
        const view = new RemoteView();
        view.pushSnapshot(packet, now);
        view.update(sample.serverTimeMs + 100);
        const shown = view.getBallView(0).renderPosition;
        expect(shown.x).toBeCloseTo(sample.balls[0].x, 10);
        expect(shown.y).toBeCloseTo(sample.balls[0].y, 10);
        expect(shown.z).toBeCloseTo(sample.balls[0].z, 10);
        expect(shown.y).toBeLessThanOrEqual(maximumPhysicalHeight + 1e-10);
        comparisons++;
      }
    }
    expect(room.simulator.getResult().nKissed).toBeGreaterThan(0);
    expect(batchSeen && extrapolationSeen).toBe(true);
    expect(comparisons).toBeGreaterThan(50);
  });

  it("长帧补算仍有界，采样不早于杆头触球，非法采样拒绝", () => {
    const room = makeTestRoom({ tickHz: 60, prepareLeadMs: 700 });
    const { c0 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 30 });
    room.command(c0, prepareCommand("late", 0, vars), 0);
    room.tick(690);
    const fired = room.tick(704).snapshot!;
    expect(fired.motion?.length).toBe(0);
    const packet = room.tick(900).snapshot!;
    expect(validMotionSamples(packet.motion, 900, 22)).toBe(true);
    expect(packet.motion!.length).toBeLessThanOrEqual(8);
    expect(packet.motion!.every(sample => sample.serverTimeMs >= 700)).toBe(true);
    const sample = packet.motion![0];
    expect(validMotionSamples([sample, sample], 900, 22)).toBe(false);
    expect(validMotionSamples([{ ...sample, serverTimeMs: NaN }], 900, 22)).toBe(false);
    expect(validMotionSamples([{ ...sample, serverTimeMs: 901 }], 900, 22)).toBe(false);
    expect(validMotionSamples(Array(9).fill(sample), 900, 22)).toBe(false);
    expect(validMotionSamples([{ ...sample, balls: [] }], 900, 22)).toBe(false);
  });
});
