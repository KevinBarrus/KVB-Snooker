import { describe, expect, it } from "vitest";
import type { CuePoseMessage } from "../../src/net/protocol.js";
import { joinSeats, makeTestRoom, makeStrokeVarsFor, prepareCommand } from "./helpers.js";
import { startHarness } from "./harness.js";

const message = (sequence = 1): CuePoseMessage => ({ type: "cue-pose", sequence, expectedVersion: 0,
  pose: { x: -2, y: 1.7, z: 0, yaw: 0, pitch: Math.PI / 2 } });

describe("瞄准姿态转发", () => {
  it("持球权ready席位才可发送；姿态不改变物理、比赛版本或规则事件", () => {
    const room = makeTestRoom();
    const { c0, c1 } = joinSeats(room);
    room.tick(0);
    const before = room.simulator.serialize();
    const version = room.stateVersion, seq = room.eventSequence;
    expect(room.receiveCuePose(c1, message(), 10)).toBeNull();
    expect(room.receiveCuePose("unknown", message(), 10)).toBeNull();
    expect(room.receiveCuePose(c0, { ...message(), expectedVersion: 1 }, 10)).toBeNull();
    expect(room.receiveCuePose(c0, message(), 10)?.seat).toBe(0);
    expect(room.stateVersion).toBe(version);
    expect(room.eventSequence).toBe(seq);
    expect(room.simulator.serialize()).toEqual(before);
    room.command(c0, prepareCommand("shot", 0, makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 8 })), 20);
    expect(room.receiveCuePose(c0, { ...message(2), expectedVersion: room.stateVersion }, 30)).toBeNull();
    expect(room.cuePose).toBeNull();
  });

  it("非法值、重复和突发超限不转发，缓存随原连接断开清除", () => {
    const room = makeTestRoom();
    const { c0, c1 } = joinSeats(room);
    expect(room.receiveCuePose(c0, { ...message(), pose: { ...message().pose!, x: NaN } }, 0)).toBeNull();
    expect(room.receiveCuePose(c0, message(), 0)).not.toBeNull();
    expect(room.receiveCuePose(c0, message(), 0)).toBeNull();
    for (let seq = 2; seq <= 4; seq++) expect(room.receiveCuePose(c0, message(seq), 0)).not.toBeNull();
    expect(room.receiveCuePose(c0, message(5), 0)).toBeNull();
    expect(room.receiveCuePose(c0, message(6), 50)).not.toBeNull();
    room.release(c1);
    expect(room.cuePose).not.toBeNull();
    room.release(c0);
    expect(room.cuePose).toBeNull();
    expect(room.receiveCuePose(c0, message(7), 100)).toBeNull();
  });

  it("真实WebSocket广播，晚加入收到缓存，房间之间不共享姿态", async () => {
    const harness = await startHarness();
    try {
      const a = await harness.join("pose-a", 0);
      a.client.send(message());
      const reflected = await a.client.waitFor(m => m.type === "cue-pose");
      if (reflected.type !== "cue-pose") throw new Error("missing pose");
      expect(reflected.pose).toEqual(message().pose);
      const b = await harness.join("pose-a", 1);
      expect(await b.client.waitFor(m => m.type === "cue-pose")).toEqual(reflected);
      const c = await harness.join("pose-b", 0);
      c.client.send({ ...message(), pose: null });
      const independent = await c.client.waitFor(m => m.type === "cue-pose");
      expect(independent.type === "cue-pose" && independent.pose).toBeNull();
      expect(b.client.all(m => m.type === "cue-pose")).toHaveLength(1);
    } finally { await harness.close(); }
  });
});
