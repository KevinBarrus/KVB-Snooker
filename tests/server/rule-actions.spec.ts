import { describe, expect, it } from "vitest";
import { makeTestRoom, joinSeats, makeStrokeVarsFor, prepareCommand, runTicks, defaultFrameSetup } from "./helpers.js";
import type { RoomSession } from "../../src/server/room.js";
import type { RuleAction } from "../../src/net/rule-view.js";
import type { CommandMessage } from "../../src/net/protocol.js";

function command(room: RoomSession, action: Omit<Extract<RuleAction, { type: "place-cue" }>, "attemptId"> |
  Omit<Extract<RuleAction, { type: "nominate" }>, "attemptId"> | { type: "replace-shot" }, id = "action"): CommandMessage {
  return { type: "command", commandId: id, expectedVersion: room.stateVersion,
    action: { ...action, attemptId: room.snapshot(0).match.attemptId } };
}

describe("经典联机规则操作", () => {
  it("彩球与自由球提名经权威规则校验并冻结于准备出杆", () => {
    const colour = makeTestRoom({ frameSetup: { ...defaultFrameSetup(), ballOn: 252, inHand: 0 } });
    joinSeats(colour);
    expect(colour.snapshot(0).rules.nomination.options).toContain(21);
    expect(colour.command("connection-0", command(colour, { type: "nominate", ballIndex: 21 }), 0).ack?.accepted).toBe(true);
    expect(colour.snapshot(0).rules.nomination.selected).toBe(21);
    colour.command("connection-0", prepareCommand("shot", colour.stateVersion,
      makeStrokeVarsFor(colour.simulator, { dx: 1, dz: 0, speed: .01 })), 1);
    expect(colour.session.context.nominatedBallIndex).toBe(21);
    expect(colour.command("connection-0", command(colour, { type: "nominate", ballIndex: 20 }, "late"), 2).ack?.accepted).toBe(false);
    colour.close();
    const setup = defaultFrameSetup(index => [0, 1, 21].includes(index));
    const room = makeTestRoom({ frameSetup: { ...setup, inHand: 0, balls: setup.balls.map(ball => ({ ...ball,
      x: ball.index === 0 ? 0 : ball.index === 1 ? .6 : .15, z: .2 })) } });
    joinSeats(room);
    room.command("connection-0", prepareCommand("miss", 0, makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: .001 })), 0);
    room.tick(700); const settled = runTicks(room, 700);
    expect(settled.finalSnapshot.rules.freeBall).toBe(true);
    expect(room.command("connection-1", { type: "command", commandId: "take", expectedVersion: room.stateVersion,
      action: { type: "decide-turn", takeOver: true } }, 20000).ack?.accepted).toBe(true);
    expect(room.command("connection-1", command(room, { type: "nominate", ballIndex: 1 }, "red"), 20001).ack?.accepted).toBe(false);
    expect(room.command("connection-1", command(room, { type: "nominate", ballIndex: 21 }, "black"), 20002).ack?.accepted).toBe(true);
    room.command("connection-1", prepareCommand("free", room.stateVersion,
      makeStrokeVarsFor(room.simulator, { dx: 1, dz: 0, speed: .1 })), 20003);
    expect(room.session.context.freeBallIndex).toBe(21);
    room.close();
  });

  it("持权者反复摆球只校验落点；非法、越权、旧尝试及重复命令不修改状态", () => {
    const room = makeTestRoom(); joinSeats(room);
    const move = command(room, { type: "place-cue", x: -1.15, z: .1 });
    expect(room.command("connection-1", move, 1).ack?.reason).toBe("not-your-turn");
    const accepted = room.command("connection-0", move, 2);
    expect(accepted.ack?.accepted).toBe(true);
    expect(room.command("connection-0", move, 3).ack?.duplicate).toBe(true);
    expect(room.stateVersion).toBe(1);
    expect(room.command("connection-0", command(room, { type: "place-cue", x: -1.2, z: -.1 }, "again"), 4).ack?.accepted).toBe(true);
    const before = room.simulator.serialize();
    for (const [x,z] of [[0,0],[-1.04,.9],[NaN,0]]) {
      expect(room.command("connection-0", command(room, { type: "place-cue", x,z }, `bad-${z}-${x}`), 5).ack?.accepted).toBe(false);
      expect(room.simulator.serialize()).toEqual(before);
    }
    const old = command(room, { type: "place-cue", x: -1.15, z: 0 }, "old");
    expect(room.command("connection-0", { ...old, action: { type: "place-cue", x: -1.15, z: 0, attemptId: "old" } }, 6).ack?.accepted).toBe(false);
  });

  it("已准备出杆不能改摆球；触球音来自实际权威触球而非准备阶段", () => {
    const room = makeTestRoom(); joinSeats(room);
    const prepared = room.command("connection-0", prepareCommand("shot", room.stateVersion,
      makeStrokeVarsFor(room.simulator, { dx: -1, dz: 0, speed: 1 })), 0);
    expect(prepared.events.some(e => e.event.type === "shot-impact")).toBe(false);
    expect(room.command("connection-0", command(room, { type: "place-cue", x: -1.2, z: 0 }), 1).ack?.accepted).toBe(false);
    const fired = room.tick(700);
    expect(fired.events.filter(e => e.event.type === "shot-impact" && e.event.impact.kind === "cue")).toHaveLength(1);
    expect(room.tick(701).events.filter(e => e.event.type === "shot-impact" && e.event.impact.kind === "cue")).toHaveLength(0);
  });

  it("Miss复位走核心判定，保留罚分；错误席位不能替别人决定", () => {
    const room = makeTestRoom(); joinSeats(room);
    const before = room.simulator.serialize();
    room.command("connection-0", prepareCommand("miss", room.stateVersion,
      makeStrokeVarsFor(room.simulator, { dx: -1, dz: 0, speed: .01 })), 0);
    room.tick(700);
    const result = runTicks(room, 700);
    expect(result.finalSnapshot.rules.decision).toEqual({ playerIndex: 1, canReplace: true });
    const score = room.session.getScore(1);
    expect(score).toBeGreaterThanOrEqual(4);
    const replace = command(room, { type: "replace-shot" });
    expect(room.command("connection-0", replace, 20000).ack?.accepted).toBe(false);
    expect(room.command("connection-1", replace, 20001).ack?.accepted).toBe(true);
    expect(room.simulator.serialize()).toEqual(before);
    expect(room.session.getScore(1)).toBe(score);
    expect(room.session.context.playerIndex).toBe(0);
    expect(room.command("connection-1", replace, 20002).ack?.duplicate).toBe(true);
  });

  it("普通红球回合拒绝彩球提名，非法载荷不推进版本", () => {
    const room = makeTestRoom(); joinSeats(room);
    expect(room.command("connection-0", command(room, { type: "nominate", ballIndex: 16 }), 1).ack?.accepted).toBe(false);
    expect(room.stateVersion).toBe(0);
    expect(room.snapshot(1).rules.nomination.enabled).toBe(false);
  });
});
