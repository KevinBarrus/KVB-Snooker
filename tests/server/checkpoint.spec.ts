import { describe, expect, it } from "vitest";
import { RoomSession } from "../../src/server/room.js";
import type { CommandMessage, MatchAction } from "../../src/net/protocol.js";
import { makePocketTable } from "../fixtures/table.js";
import { joinSeats, makeTestRoom, makeStrokeVarsFor, prepareCommand, runTicks } from "./helpers.js";

function roundtrip(room: RoomSession): RoomSession {
  return RoomSession.fromCheckpoint(JSON.parse(JSON.stringify(room.exportCheckpoint())), makePocketTable());
}
function action(room: RoomSession, type: MatchAction["type"], id: string): CommandMessage {
  return { type: "command", commandId: id, expectedVersion: room.stateVersion,
    action: { type, attemptId: room.snapshot(0).match.attemptId } };
}

describe("权威房间完整检查点", () => {
  it("新房间恢复独立状态、比分/犯规待选择与随机游标，同一杆不再次触球", () => {
    const room = makeTestRoom({ bestOf: 3 });
    const { c0 } = joinSeats(room);
    const command = prepareCommand("saved-shot", 0, makeStrokeVarsFor(room.simulator, { dx: -1, dz: 0, speed: 1 }));
    room.command(c0, command, 1000);
    expect(() => room.exportCheckpoint()).toThrow();
    room.tick(1700);
    expect(() => room.exportCheckpoint()).toThrow();
    const settled = runTicks(room, 1700);
    expect(settled.finalSnapshot.phase).toBe("deciding");
    room.aiDependencies.random();
    const checkpoint = room.exportCheckpoint();
    const next = roundtrip(room);
    expect(next.stateVersion).toBe(room.stateVersion + 1);
    expect(next.eventSequence).toBe(room.eventSequence);
    expect(next.session.exportCheckpoint()).toEqual(room.session.exportCheckpoint());
    expect(next.seats.every(seat => !seat.connected)).toBe(true);
    expect(next.cuePose).toBeNull();
    expect(next.aiDependencies.random()).toBe(room.aiDependencies.random());
    expect(next.tick(100000).events).toHaveLength(0);
    expect(next.session.exportCheckpoint()).toEqual(room.session.exportCheckpoint());
    next.join("new-0", 0, 100001);
    next.join("new-1", 1, 100001);
    const retry = next.command("new-0", command, 100002);
    expect(retry.ack).toMatchObject({ accepted: true, duplicate: true, shotId: checkpoint.match.view.lastShotId });
    expect(retry.events.every(event => event.event.type === "seat-changed")).toBe(true);
    expect(next.tick(100100).events).toHaveLength(0);
    expect(next.session.players[0].shootingCount).toBe(1);
    expect(next.command("new-1", { ...command, expectedVersion: next.stateVersion }, 100101).ack?.duplicate).toBe(false);
    expect(next.command("new-0", { ...command, action: { type: "decide-turn", takeOver: true } }, 100102).ack?.reason).toBe("duplicate-command-mismatch");
    const holder = next.session.decision!.playerIndex;
    expect(next.command(`new-${holder}`, { type: "command", commandId: "take", expectedVersion: next.stateVersion,
      action: { type: "decide-turn", takeOver: true } }, 100103).ack?.accepted).toBe(true);
    const vars = makeStrokeVarsFor(next.simulator, { dx: 1, dz: 0, speed: 1 });
    const accepted = next.command(`new-${holder}`, prepareCommand("after-restore", next.stateVersion, vars), 100104);
    expect(accepted.ack).toMatchObject({ accepted: true, shotId: "test-match/frame-1/attempt-1/shot-2" });
    next.tick(100804);
    expect(next.session.players[holder].shootingCount).toBe(1);
    expect(room.session.state).toBe(32);
  });

  it("密集红球运动后保存，恢复后下一杆逐步球位、速度与结算保持一致", () => {
    const room = makeTestRoom({ bestOf: 3, tickHz: 60 });
    const { c0 } = joinSeats(room);
    room.command(c0, prepareCommand("break", 0, makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 60 })), 0);
    room.tick(700);
    runTicks(room, 700);
    const next = roundtrip(room);
    for (const game of [room.session, next.session]) if (game.decision) {
      game.chooseNextPlayer(game.decision.playerIndex, game.decision.playerIndex);
    }
    const cue = room.simulator.getCueBallPosition();
    const target = room.simulator.getBalls().find(ball => ball.active && ball.index > 0 &&
      (2 ** ball.number & room.session.context.ballOn) !== 0)!;
    expect(target).toBeDefined();
    const vars = makeStrokeVarsFor(room.simulator, { dx: target.position.x - cue.x, dz: target.position.z - cue.z, speed: 30 });
    for (const game of [room.session, next.session]) {
      if (game.context.ballOn === 252) game.nominate(game.context.playerIndex, target.index);
      expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
    }
    let steps = 0;
    while (room.session.state === 8 && steps++ < 2000) {
      room.session.step(1 / 60); next.session.step(1 / 60);
      expect(next.simulator.serialize()).toEqual(room.simulator.serialize());
    }
    expect(room.session.state).not.toBe(8);
    expect(next.session.context).toEqual(room.session.context);
    expect(next.session.result).toEqual(room.session.result);
    expect(next.session.players.map(player => player.snapshot())).toEqual(room.session.players.map(player => player.snapshot()));
  });

  it("三局两胜跨重建继续，局间撤销准备，轮换开球，终局不重新发结果", () => {
    let room = makeTestRoom({ bestOf: 3, firstOpeningPlayer: 1 });
    joinSeats(room);
    room.command("connection-1", action(room, "concede-frame", "first"), 10);
    room.command("connection-0", action(room, "ready-next-frame", "ready-before-save"), 11);
    const saved = room.exportCheckpoint();
    expect(saved.match.view.ready).toEqual([true, false]);
    room = roundtrip(room);
    expect(room.snapshot(1000).match).toMatchObject({ frameWins: [1, 0], ready: [false, false], openingPlayer: 1 });
    joinSeats(room, 1000);
    room.command("connection-1", action(room, "ready-next-frame", "ready-b"), 1001);
    expect(room.snapshot(1001).match.frameNumber).toBe(1);
    room.command("connection-0", action(room, "ready-next-frame", "ready-a"), 1002);
    expect(room.snapshot(1002).match).toMatchObject({ frameNumber: 2, openingPlayer: 0 });
    room.command("connection-0", action(room, "concede-frame", "second"), 1003);
    room = roundtrip(room);
    joinSeats(room, 2000);
    room.command("connection-0", action(room, "ready-next-frame", "third-a"), 2001);
    room.command("connection-1", action(room, "ready-next-frame", "third-b"), 2002);
    expect(room.snapshot(2002).match.openingPlayer).toBe(1);
    const concession = action(room, "concede-frame", "last");
    const end = room.command("connection-1", concession, 2003);
    expect(end.events.filter(event => event.event.type === "match-ended")).toHaveLength(1);
    const result = end.snapshot!.match.result;
    room = roundtrip(room);
    expect(room.snapshot(0).match.result).toEqual(result);
    expect(room.tick(0).events).toHaveLength(0);
    joinSeats(room);
    expect(room.command("connection-1", concession, 10).ack?.duplicate).toBe(true);
    expect(room.tick(20).events).toHaveLength(0);
    expect(room.snapshot(20).match.frameWins).toEqual([2, 1]);
  });

  it("检查点格式、规则、台面、计数与去重损坏拒绝，关闭房间不可保存", () => {
    const room = makeTestRoom({ bestOf: 3 });
    joinSeats(room);
    room.command("connection-0", { type: "command", commandId: "rejected", expectedVersion: 99,
      action: { type: "decide-turn", takeOver: true } }, 10);
    const data = room.exportCheckpoint();
    for (const invalid of [
      { ...data, format: 99 }, { ...data, protocolVersion: 4 }, { ...data, randomState: -1 },
      { ...data, game: { ...data.game, rulesVersion: "later" } },
      { ...data, match: { ...data.match, view: { ...data.match.view, frameWins: [1, 0] } } },
      { ...data, commands: [...data.commands, ...data.commands] },
      { ...data, commands: [{ ...data.commands[0], ack: { ...data.commands[0].ack, stateVersion: 999 } }] }
    ]) expect(() => RoomSession.fromCheckpoint(invalid, makePocketTable())).toThrow();
    const mesh = makePocketTable();
    mesh.id = "different-table";
    expect(() => RoomSession.fromCheckpoint(data, mesh)).toThrow();
    expect(room.exportCheckpoint()).toEqual(data);
    room.close();
    expect(() => room.exportCheckpoint()).toThrow();
  });
});
