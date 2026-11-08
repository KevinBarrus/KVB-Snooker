import { describe, expect, it } from "vitest";
import type { FrameSetup } from "../../src/core/frame-setup.js";
import type { CommandMessage, MatchAction } from "../../src/net/protocol.js";
import type { RoomSession } from "../../src/server/room.js";
import { joinSeats, makeTestRoom, makeStrokeVarsFor, prepareCommand, runTicks } from "./helpers.js";

function action(room: RoomSession, type: MatchAction["type"], id: string): CommandMessage {
  return { type: "command", commandId: id, expectedVersion: room.stateVersion,
    action: { type, attemptId: room.snapshot(0).match.attemptId } };
}

function blackSetup(scores = [0, 0]): FrameSetup {
  return { balls: Array.from({ length: 22 }, (_, index) => ({ index, x: 0,
    z: index === 21 ? 0.86 : index === 0 ? 0.3 : 0, active: index === 0 || index === 21 })),
    ballOn: 128, inHand: 0, playerIndex: 0, scores };
}

describe("权威整场换局", () => {
  it("真实末黑入袋记一局，双方准备恢复标准球台，轮换开球，2:0仅一次结果", () => {
    const room = makeTestRoom({ bestOf: 3, frameSetup: blackSetup() });
    const { c0, c1 } = joinSeats(room);
    const shot = prepareCommand("pot", 0, makeStrokeVarsFor(room.simulator, { dx: 0, dz: 1, speed: 6 }));
    const prepare = room.command(c0, shot, 1000);
    expect(prepare.ack?.accepted).toBe(true);
    expect(prepare.snapshot?.match.shotCount).toBe(0);
    expect(prepare.ack?.shotId).toBe("test-match/frame-1/attempt-1/shot-1");
    expect(room.tick(1700).snapshot?.match.shotCount).toBe(1);
    const run = runTicks(room, 1700);
    expect(run.finalSnapshot).toMatchObject({ phase: "between-frames", match: { frameWins: [1, 0], result: null } });
    expect(run.events.filter(e => e.event.type === "frame-ended")).toHaveLength(1);
    const oldGame = room.session;
    const ready0 = action(room, "ready-next-frame", "ready-0");
    const ready1 = action(room, "ready-next-frame", "ready-1");
    expect(room.command(c0, ready0, 5000).ack?.accepted).toBe(true);
    expect(room.session).toBe(oldGame);
    expect(room.command(c0, ready0, 5001).ack?.duplicate).toBe(true);
    expect(room.command(c1, ready1, 5002).ack?.reason).toBe("stale-version");
    const next = room.command(c1, action(room, "ready-next-frame", "ready-1-fresh"), 5003);
    expect(next.events.filter(e => e.event.type === "frame-started")).toHaveLength(1);
    expect(room.session).not.toBe(oldGame);
    expect(next.snapshot).toMatchObject({ phase: "ready", context: { scores: [0, 0], playerIndex: 1 },
      match: { frameNumber: 2, openingPlayer: 1, frameWins: [1, 0], shotCount: 0 } });
    expect(next.snapshot?.balls.every(ball => ball.active)).toBe(true);
    expect(room.command(c0, prepareCommand("old-shot", 0, shot.action.type === "prepare-shot" ? [...shot.action.vars] : []), 5004).ack?.reason).toBe("stale-version");
    const concession = action(room, "concede-frame", "finish");
    const end = room.command(c1, concession, 5100);
    expect(end.snapshot).toMatchObject({ phase: "finished", match: { frameWins: [2, 0], result: { winner: 0 } } });
    expect(end.events.filter(e => e.event.type === "match-ended")).toHaveLength(1);
    expect(room.command(c1, concession, 5101).events).toHaveLength(0);
    expect(room.tick(5200).events).toHaveLength(0);
    expect(room.command(c0, action(room, "ready-next-frame", "too-late"), 5201).ack?.accepted).toBe(false);
    expect(room.command(c0, prepareCommand("end-shot", room.stateVersion, makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0 })), 5202).ack?.reason).toBe("wrong-phase");
  });

  it("平分末黑进入争黑，不计局分或产生整场结果", () => {
    const room = makeTestRoom({ bestOf: 3, frameSetup: blackSetup([0, 7]) });
    const { c0 } = joinSeats(room);
    room.command(c0, prepareCommand("tie", 0, makeStrokeVarsFor(room.simulator, { dx: 0, dz: 1, speed: 6 })), 0);
    room.tick(700);
    const run = runTicks(room, 700);
    expect(run.finalSnapshot).toMatchObject({ phase: "ready", context: { scores: [7, 7], ballOn: 128 },
      match: { frameWins: [0, 0], phase: "active", frames: [], result: null } });
    expect(run.events.some(e => e.event.type === "frame-ended")).toBe(false);
  });

  it("认输不能中断准备与运动；离座撤销准备，旧尝试动作与越权连接拒绝", () => {
    const room = makeTestRoom({ bestOf: 3 });
    const { c0, c1 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 0, dz: -1 });
    expect(room.command("stranger", action(room, "concede-frame", "bad"), 0).ack?.reason).toBe("not-your-turn");
    room.command(c0, prepareCommand("shot", 0, vars), 1);
    expect(room.command(c1, action(room, "concede-frame", "pending"), 2).ack?.reason).toBe("wrong-phase");
    room.tick(701);
    expect(room.command(c1, action(room, "concede-frame", "rolling"), 702).ack?.reason).toBe("wrong-phase");
    runTicks(room, 701);
    room.command(c1, action(room, "concede-frame", "concede"), 30000);
    const staleAttempt = action(room, "concede-frame", "old-attempt");
    room.command(c0, action(room, "ready-next-frame", "r0"), 30001);
    room.release(c0); room.join(c0, 0, 30002);
    room.command(c1, action(room, "ready-next-frame", "r1"), 30003);
    expect(room.snapshot(30003).phase).toBe("between-frames");
    room.command(c0, action(room, "ready-next-frame", "r0-again"), 30004);
    expect(room.command(c0, { ...staleAttempt, expectedVersion: room.stateVersion }, 30005).ack?.reason).toBe("stale-version");
    expect(room.snapshot(30005).match.frameWins).toEqual([1, 0]);
  });

  it("固定先手1跨三局轮换，两个席位相同命令ID不能共享裁决，重建房间不是原比赛", () => {
    const room = makeTestRoom({ bestOf: 3, firstOpeningPlayer: 1 });
    joinSeats(room);
    for (const [index, loser] of [1, 0, 1].entries()) {
      expect(room.snapshot(index).match.openingPlayer).toBe(index % 2 === 0 ? 1 : 0);
      room.command(`connection-${loser}`, action(room, "concede-frame", `c${index}`), index * 10);
      if (index < 2) {
        room.command("connection-0", action(room, "ready-next-frame", "same" + index), index * 10 + 1);
        expect(room.command("connection-1", action(room, "ready-next-frame", "same" + index), index * 10 + 2).ack?.duplicate).toBe(false);
      }
    }
    expect(room.snapshot(100).match.result).toMatchObject({ winner: 0, frameWins: [2, 1] });
    const first = makeTestRoom({ matchId: undefined, firstOpeningPlayer: undefined });
    const second = makeTestRoom({ matchId: undefined, firstOpeningPlayer: undefined });
    expect(first.snapshot(0).match.matchId).not.toBe(second.snapshot(0).match.matchId);
    expect(first.snapshot(0).match.firstOpeningPlayer).toBe(first.snapshot(100).match.firstOpeningPlayer);
  });
});
