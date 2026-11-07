import { describe, expect, it } from "vitest";
import { GAME_STATE } from "../../src/core/game.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import type { FrameSetup } from "../../src/core/frame-setup.js";
import { NET_PROTOCOL_VERSION, REJECT, type RejectReason, type WelcomeMessage } from "../../src/net/protocol.js";
import type { RoomJoinOutcome, RoomJoinResult, RoomSession } from "../../src/server/room.js";
import {
  TEST_ROOM_ID, decideCommand, defaultFrameSetup, eventsOfType, joinSeats, makeReferenceSession,
  makeStrokeVarsFor, makeTestRoom, prepareCommand, runTicks
} from "./helpers.js";

function joined(outcome: RoomJoinOutcome): RoomJoinResult {
  if ("reason" in outcome) throw new Error(`join rejected: ${outcome.reason}`);
  return outcome;
}

function reasonOf(outcome: RoomJoinOutcome): RejectReason {
  if (!("reason" in outcome)) throw new Error("expected join rejection");
  return outcome.reason;
}

function welcomeOf(room: RoomSession, connectionId: string): WelcomeMessage {
  return joined(room.join(connectionId, undefined, 0)).welcome;
}

/** 22 球表中的受控局面：母球在原点，1 号红球在 +x 0.5m；其余球失活。 */
function singleRedSetup(): FrameSetup {
  return {
    balls: Array.from({ length: 22 }, (_, index) => ({
      index, x: index === 1 ? 0.5 : 0, z: 0, active: index === 0 || index === 1
    })),
    ballOn: 2, inHand: 0, playerIndex: 0, scores: [0, 0]
  };
}

/** 母球在 (0,0.3)、黑球在 (0,0.86)：沿 +z 轻推即可合法打进中袋。 */
function blackPotSetup(): FrameSetup {
  return {
    balls: Array.from({ length: 22 }, (_, index) => ({
      index, x: 0, z: index === 21 ? 0.86 : index === 0 ? 0.3 : 0,
      active: index === 0 || index === 21
    })),
    ballOn: 128, inHand: 0, playerIndex: 0, scores: [0, 0]
  };
}

describe("服务端权威房间（联机原型 §3—§6 / 架构 §4.8）", () => {
  it("join 分配两个固定席位并回显 welcome（协议、房间、配置、延迟计量）", () => {
    const latency = { enabled: true, inboundMs: 10, outboundMs: 20, jitterMs: 3, appliesTo: "one-way-per-direction" as const };
    const room = makeTestRoom({ latency });
    const first = joined(room.join("c0", undefined, 1000));
    expect(first.seat).toBe(0);
    expect(first.welcome.protocolVersion).toBe(NET_PROTOCOL_VERSION);
    expect(first.welcome.roomId).toBe(TEST_ROOM_ID);
    expect(first.welcome.match).toEqual({ ruleset: "classic", mode: "single-play", tickHz: 100, snapshotHz: 20, prepareLeadMs: 700 });
    expect(first.welcome.latency).toEqual(latency);
    expect(first.welcome.stateVersion).toBe(0);
    expect(first.welcome.serverTimeMs).toBe(1000);
    expect(first.welcome.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: false }]);

    const second = joined(room.join("c1", undefined, 1010));
    expect(second.seat).toBe(1);
    expect(second.welcome.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: true }]);
    expect(reasonOf(room.join("c2", undefined, 1020))).toBe(REJECT.ROOM_FULL);

    room.release("c1");
    expect(room.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: false }]);
    expect(joined(room.join("c2", undefined, 1030)).seat).toBe(1);
  });

  it("requestedSeat 生效，已占席位返回 seat-conflict", () => {
    const room = makeTestRoom();
    expect(joined(room.join("a", 1, 0)).seat).toBe(1);
    expect(reasonOf(room.join("b", 1, 0))).toBe(REJECT.SEAT_CONFLICT);
    expect(joined(room.join("b", 0, 0)).seat).toBe(0);
    expect(reasonOf(room.join("c", undefined, 0))).toBe(REJECT.ROOM_FULL);
  });

  it("prepare-shot → tick 到触球 → 结算：版本、事件序号与快照单调", () => {
    const room = makeTestRoom({ frameSetup: singleRedSetup() });
    const { c0 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 8 });
    const prepared = room.command(c0, prepareCommand("cmd-1", 0, vars), 1000);
    expect(prepared.ack?.accepted).toBe(true);
    expect(prepared.ack?.stateVersion).toBe(1);
    expect(prepared.ack?.touchAtServerMs).toBe(1700);
    expect(prepared.ack?.shotId).toBeDefined();
    const preparedEvents = eventsOfType(prepared.events, "shot-prepared");
    expect(preparedEvents).toHaveLength(1);
    expect(preparedEvents[0].event).toMatchObject({ shotId: prepared.ack?.shotId, seat: 0, touchAtServerMs: 1700, prepareLeadMs: 700 });
    const preparedSnapshot = prepared.snapshot;
    expect(preparedSnapshot).not.toBeNull();
    if (!preparedSnapshot) throw new Error("missing prepared snapshot");
    expect(preparedSnapshot.version).toBe(1);
    expect(preparedSnapshot.phase).toBe("ready");
    expect(preparedSnapshot.pendingShot).toEqual({ shotId: prepared.ack?.shotId, seat: 0, touchAtServerMs: 1700 });
    expect(preparedSnapshot.checkpoint?.mbid).toBe("six-pocket-test-table");

    expect(eventsOfType(room.tick(1690).events, "shot-fired")).toHaveLength(0);
    const fired = room.tick(1700);
    const firedEvents = eventsOfType(fired.events, "shot-fired");
    expect(firedEvents).toHaveLength(1);
    expect(firedEvents[0].event.firedAtServerMs).toBe(1700);
    expect(firedEvents[0].event.touchAtServerMs).toBe(1700);
    if (!fired.snapshot) throw new Error("missing fired snapshot");
    expect(fired.snapshot.phase).toBe("simulating");
    expect(fired.snapshot.version).toBe(2);
    expect(fired.snapshot.checkpoint).toBeNull();

    const run = runTicks(room, 1700);
    expect(run.events.every(message => message.event.type !== "shot-fired")).toBe(true);
    const settled = eventsOfType(run.events, "shot-settled");
    expect(settled).toHaveLength(1);
    expect(settled[0].event).toMatchObject({ shotId: prepared.ack?.shotId, seat: 0, score: 0, foulCode: 0 });
    expect(run.finalSnapshot.phase).toBe("ready");
    expect(run.finalSnapshot.version).toBe(3);
    expect(run.finalSnapshot.pendingShot).toBeNull();
    expect(run.finalSnapshot.checkpoint).not.toBeNull();
    expect(room.session.context.playerIndex).toBe(1);

    const versions = [preparedSnapshot.version, fired.snapshot.version, ...run.snapshots.map(snapshot => snapshot.version)];
    for (let index = 1; index < versions.length; ++index) expect(versions[index]).toBeGreaterThanOrEqual(versions[index - 1]);
    const sequences = [...prepared.events, ...fired.events, ...run.events].map(message => message.seq);
    for (let index = 1; index < sequences.length; ++index) expect(sequences[index]).toBeGreaterThan(sequences[index - 1]);
  });

  it("重复命令：同 ID 同参数返回原裁决且只出杆一次，同 ID 换参数拒绝", () => {
    const room = makeTestRoom({ frameSetup: singleRedSetup() });
    const { c0 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 8 });
    const first = room.command(c0, prepareCommand("dup", 0, vars), 1000);
    expect(first.ack?.accepted).toBe(true);
    const duplicate = room.command(c0, prepareCommand("dup", 0, vars), 1010);
    expect(duplicate.ack?.accepted).toBe(true);
    expect(duplicate.ack?.duplicate).toBe(true);
    expect(duplicate.ack?.shotId).toBe(first.ack?.shotId);
    expect(duplicate.ack?.stateVersion).toBe(1);
    expect(duplicate.events).toHaveLength(0);
    expect(duplicate.snapshot).toBeNull();

    const otherVars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: 5 });
    const mismatch = room.command(c0, prepareCommand("dup", 0, otherVars), 1020);
    expect(mismatch.ack?.accepted).toBe(false);
    expect(mismatch.ack?.reason).toBe(REJECT.DUPLICATE_MISMATCH);
    expect(room.stateVersion).toBe(1);

    expect(eventsOfType(room.tick(1700).events, "shot-fired")).toHaveLength(1);
    const run = runTicks(room, 1700);
    expect(eventsOfType(run.events, "shot-fired")).toHaveLength(0);
  });

  it("越权席位、过期版本、错误阶段、非法 vars 全部拒绝且不改状态", () => {
    const room = makeTestRoom();
    const { c0, c1 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 0, dz: -1, speed: 6 });

    const wrongSeat = room.command(c1, prepareCommand("unauthorized", 0, vars), 1000);
    expect(wrongSeat.ack?.reason).toBe(REJECT.NOT_YOUR_TURN);
    const stale = room.command(c0, prepareCommand("stale", 9, vars), 1001);
    expect(stale.ack?.reason).toBe(REJECT.STALE_VERSION);
    expect(room.stateVersion).toBe(0);

    const invalidCases: readonly number[][] = [
      [NaN, 0, 0, 0, 0, -1, 6, 0.005],
      [0, 0, 0, 0, 0, -1, Infinity, 0.005],
      [0, 0, 0, 0, 0, -1, 6],
      [0, 0, 0, 0, 0, -1, 500, 0.005],
      [0, 0, 0, 0, 0, -1, 6, 0.5]
    ];
    invalidCases.forEach((values, index) => {
      const rejected = room.command(c0, prepareCommand(`bad-${index}`, 0, values), 1002 + index);
      expect(rejected.ack?.reason).toBe(REJECT.INVALID_PARAMS);
    });
    // 触点不在母球表面附近。
    const farContact = Array.from(vars);
    farContact[0] += 2 * room.simulator.ballRadius;
    expect(room.command(c0, prepareCommand("far-contact", 0, farContact), 1010).ack?.reason).toBe(REJECT.INVALID_PARAMS);
    expect(room.stateVersion).toBe(0);

    expect(room.command(c0, prepareCommand("accepted", 0, vars), 1020).ack?.accepted).toBe(true);
    expect(room.command(c0, prepareCommand("second", 1, vars), 1030).ack?.reason).toBe(REJECT.WRONG_PHASE);
    expect(room.command(c1, prepareCommand("while-simulating", 1, vars), 1040).ack?.reason).toBe(REJECT.WRONG_PHASE);
    expect(room.tick(1720).events.some(message => message.event.type === "shot-fired")).toBe(true);
    expect(room.command(c0, prepareCommand("late", 2, vars), 1730).ack?.reason).toBe(REJECT.WRONG_PHASE);
  });

  it("decide-turn：犯规结算后只有持权席位能选择自己接手或让对手重打", () => {
    for (const takeOver of [true, false]) {
      const room = makeTestRoom({ frameSetup: singleRedSetup() });
      const { c0, c1 } = joinSeats(room);
      // 沿 +z 打向空处，首碰不到任何球 → 犯规，进入 DECIDING。
      const vars = makeStrokeVarsFor(room.simulator, { dx: 0, dz: 1, speed: 6 });
      expect(room.command(c0, prepareCommand("foul", 0, vars), 1000).ack?.accepted).toBe(true);
      room.tick(1700);
      const run = runTicks(room, 1700);
      const settled = eventsOfType(run.events, "shot-settled");
      expect(settled).toHaveLength(1);
      expect(settled[0].event.score).toBeLessThan(0);
      expect(settled[0].event.foulCode).not.toBe(0);
      expect(run.finalSnapshot.phase).toBe("deciding");
      expect(room.session.state).toBe(GAME_STATE.DECIDING);
      expect(room.session.context.playerIndex).toBe(1);

      expect(room.command(c0, decideCommand("wrong-seat", room.stateVersion, true), 2000).ack?.reason)
        .toBe(REJECT.NOT_YOUR_TURN);
      const decided = room.command(c1, decideCommand("decide", room.stateVersion, takeOver), 2010);
      expect(decided.ack?.accepted).toBe(true);
      expect(decided.ack?.stateVersion).toBe(room.stateVersion);
      expect(decided.snapshot?.phase).toBe("ready");
      expect(decided.snapshot?.context.playerIndex).toBe(takeOver ? 1 : 0);
    }
  });

  it("finished：黑球入袋后 phase=finished 并拒绝继续击球", () => {
    const room = makeTestRoom({ frameSetup: blackPotSetup() });
    const { c0 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 0, dz: 1, speed: 6 });
    expect(room.command(c0, prepareCommand("black", 0, vars), 1000).ack?.accepted).toBe(true);
    room.tick(1700);
    const run = runTicks(room, 1700);
    const settled = eventsOfType(run.events, "shot-settled");
    expect(settled).toHaveLength(1);
    expect(settled[0].event).toMatchObject({ score: 7, foulCode: 0 });
    expect(settled[0].event.potted).toEqual([21]);
    expect(room.session.finished).toBe(true);
    expect(run.finalSnapshot.phase).toBe("finished");
    expect(run.finalSnapshot.checkpoint).not.toBeNull();
    expect(room.command(c0, prepareCommand("after-finish", room.stateVersion, vars), 3000).ack?.reason)
      .toBe(REJECT.WRONG_PHASE);
  });

  it("母球失活时用核心 placeCueBall 合法放置；无手中球时拒绝", () => {
    const inHandRoom = makeTestRoom({ frameSetup: defaultFrameSetup() });
    const { c0 } = joinSeats(inHandRoom);
    const vars = makeStrokeVarsFor(inHandRoom.simulator, { dx: 0, dz: -1, speed: 5 });
    inHandRoom.simulator.resetBallPosition(inHandRoom.simulator.getBallAtIndex(0), null);
    expect(inHandRoom.simulator.getBallAtIndex(0).active).toBe(false);
    const prepared = inHandRoom.command(c0, prepareCommand("respot", 0, vars), 1000);
    expect(prepared.ack?.accepted).toBe(true);
    expect(inHandRoom.simulator.getBallAtIndex(0).active).toBe(true);
    expect(prepared.snapshot?.balls[0].active).toBe(true);

    const noInHandSetup = { ...defaultFrameSetup(), inHand: 0 as const };
    const noInHandRoom = makeTestRoom({ frameSetup: noInHandSetup });
    joinSeats(noInHandRoom, 0);
    const noInHandVars = makeStrokeVarsFor(noInHandRoom.simulator, { dx: 0, dz: -1, speed: 5 });
    noInHandRoom.simulator.resetBallPosition(noInHandRoom.simulator.getBallAtIndex(0), null);
    const rejected = noInHandRoom.command("connection-0", prepareCommand("respot-fail", 0, noInHandVars), 1000);
    expect(rejected.ack?.reason).toBe(REJECT.CUE_BALL_INACTIVE);
    expect(noInHandRoom.stateVersion).toBe(0);
  });

  it("物理只施加一次冲量：房间结算存档与同参数参考 Simulator 逐位一致", () => {
    const setup = singleRedSetup();
    const room = makeTestRoom({ frameSetup: setup });
    const { c0 } = joinSeats(room);
    const vars = makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0.05, speed: 8, sideOffset: 0.002 });
    expect(room.command(c0, prepareCommand("once", 0, vars), 1000).ack?.accepted).toBe(true);
    room.tick(1700);
    const run = runTicks(room, 1700);
    const checkpoint = run.finalSnapshot.checkpoint;
    if (!checkpoint) throw new Error("missing checkpoint");
    expect(eventsOfType(run.events, "shot-fired")).toHaveLength(0);
    const firedEvents = [room.tick(1700)].flatMap(result => eventsOfType(result.events, "shot-fired"));
    expect(firedEvents.length).toBeLessThanOrEqual(1);

    const reference = makeReferenceSession(DEFAULT_SCENE.ballSet, setup);
    expect(reference.stroke(0, vars)).toBe(true);
    while (reference.state === GAME_STATE.SIMULATING) reference.step(0.01);
    expect(reference.state).not.toBe(GAME_STATE.SIMULATING);
    expect(reference.simulator.serialize()).toEqual(checkpoint);
    expect({ score: reference.result.score, foulCode: reference.result.foulCode })
      .toEqual({ score: room.session.result.score, foulCode: room.session.result.foulCode });
  });

  it("welcome 回显各连接自己的席位，重复 join 不占新席位", () => {
    const room = makeTestRoom();
    expect(welcomeOf(room, "c0").seat).toBe(0);
    expect(welcomeOf(room, "c0").seat).toBe(0);
    expect(welcomeOf(room, "c1").seat).toBe(1);
    expect(room.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: true }]);
    expect(reasonOf(room.join("c2", undefined, 0))).toBe(REJECT.ROOM_FULL);
  });
});
