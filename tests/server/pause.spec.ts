import { describe, expect, it } from "vitest";
import type { PauseAction, CommandMessage } from "../../src/net/protocol.js";
import { RoomSession } from "../../src/server/room.js";
import { makePocketTable } from "../fixtures/table.js";
import { joinSeats, makeTestRoom, makeStrokeVarsFor, prepareCommand, runTicks } from "./helpers.js";

function command(room: RoomSession, type: PauseAction["type"], id: string = type): CommandMessage {
  return { type: "command", commandId: id, expectedVersion: room.stateVersion,
    action: { type, attemptId: room.snapshot(0).match.attemptId } };
}

describe("联机暂停与恢复", () => {
  it("双方同意才冻结；重复请求不重复消费，冻结后禁止击球/选择/认输/姿态", () => {
    const room = makeTestRoom(); joinSeats(room);
    const request = command(room, "pause-request");
    const original = room.command("connection-0", request, 10);
    expect(original.ack?.accepted).toBe(true);
    expect(original.snapshot?.pause.phase).toBe("requested");
    expect(room.command("connection-0", request, 11).ack).toMatchObject({ accepted: true, duplicate: true });
    expect(room.command("connection-0", command(room, "pause-accept"), 12).ack?.accepted).toBe(false);
    expect(room.command("connection-1", command(room, "pause-accept"), 13).snapshot?.pause.phase).toBe("paused");
    const saved = room.session.exportCheckpoint();
    room.tick(10000);
    expect(room.session.exportCheckpoint()).toEqual(saved);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 30 });
    expect(room.command("connection-0", prepareCommand("blocked", room.stateVersion, vars), 10001).ack?.reason).toBe("wrong-phase");
    expect(room.command("connection-0", { type: "command", commandId: "concede", expectedVersion: room.stateVersion,
      action: { type: "concede-frame", attemptId: room.snapshot(10002).match.attemptId } }, 10002).ack?.accepted).toBe(false);
    expect(room.receiveCuePose("connection-0", { type: "cue-pose", expectedVersion: room.stateVersion, sequence: 1,
      pose: { x: 0, y: 1, z: 0, yaw: 0, pitch: 0 } }, 10003)).toBeNull();
    room.command("connection-0", command(room, "pause-ready"), 10004);
    expect(room.tick(20000).snapshot?.pause.phase).toBe("paused");
    const ready = command(room, "pause-ready");
    expect(room.command("connection-1", ready, 20001).snapshot?.pause.phase).toBe("resuming");
    expect(room.tick(22999).snapshot?.pause.phase).toBe("resuming");
    const retry = room.command("connection-1", ready, 23001);
    expect(retry.ack?.duplicate).toBe(true);
    expect(retry.snapshot?.pause.phase).toBe("running");
    expect(room.session.exportCheckpoint()).toEqual(saved);
    expect(room.command("connection-0", prepareCommand("after", room.stateVersion, vars), 23002).ack?.accepted).toBe(true);
  });

  it("出杆已确认后申请暂停，保留唯一触球，完成结算才生效", () => {
    const room = makeTestRoom(); joinSeats(room);
    room.command("connection-0", prepareCommand("shot", room.stateVersion,
      makeStrokeVarsFor(room.simulator, { dx: -1, dz: 0, speed: 1 })), 0);
    room.command("connection-0", command(room, "pause-request"), 100);
    const accepted = room.command("connection-1", command(room, "pause-accept"), 101);
    expect(accepted.snapshot?.pause.phase).toBe("waiting");
    expect(accepted.snapshot?.pendingShot).not.toBeNull();
    const fired = room.tick(700);
    expect(fired.events.filter(e => e.event.type === "shot-fired")).toHaveLength(1);
    expect(fired.snapshot?.pause.phase).toBe("waiting");
    const settled = runTicks(room, 700);
    expect(settled.finalSnapshot.pause.phase).toBe("paused");
    expect(room.session.players[0].shootingCount).toBe(1);
    expect(room.snapshot(20000).match.shotCount).toBe(1);
    expect(room.session.decision).not.toBeNull();
  });

  it("请求跨终局失效，不逆转认输；下一局不继承请求", () => {
    const room = makeTestRoom(); joinSeats(room);
    room.command("connection-0", command(room, "pause-request"), 1);
    room.command("connection-0", { type: "command", commandId: "concede", expectedVersion: room.stateVersion,
      action: { type: "concede-frame", attemptId: room.snapshot(1).match.attemptId } }, 2);
    expect(room.snapshot(3).pause.phase).toBe("running");
    expect(room.command("connection-1", command(room, "pause-accept"), 4).ack?.accepted).toBe(false);
    expect(room.snapshot(4).match.frameWins).toEqual([0, 1]);
  });

  it("暂停检查点往返不重新结算，旧准备作废；损坏数据拒绝", () => {
    const room = makeTestRoom(); joinSeats(room);
    room.command("connection-0", command(room, "pause-request"), 1);
    room.command("connection-1", command(room, "pause-accept"), 2);
    room.command("connection-0", command(room, "pause-ready"), 3);
    const saved = JSON.parse(JSON.stringify(room.exportCheckpoint()));
    const restored = RoomSession.fromCheckpoint(saved, makePocketTable());
    expect(restored.snapshot(1000).pause).toMatchObject({ phase: "paused", used: [1, 0], ready: [false, false] });
    expect(restored.session.exportCheckpoint()).toEqual(room.session.exportCheckpoint());
    expect(() => RoomSession.fromCheckpoint({ ...saved, format: 1 }, makePocketTable())).toThrow();
    expect(() => RoomSession.fromCheckpoint({ ...saved, pause: null }, makePocketTable())).toThrow();
    restored.join("connection-0", 0, 1001);
    expect(restored.command("connection-0", command(restored, "pause-ready", "new-ready"), 1002).ack?.accepted).toBe(false);
  });
});
