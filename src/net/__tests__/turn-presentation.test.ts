import { describe, expect, it } from "vitest";
import { TurnCommands } from "../turn-commands.js";
import { PresentationEvents } from "../presentation-events.js";
import type { CommandMessage, ServerEventMessage } from "../protocol.js";

function impact(seq: number, serverTimeMs: number): ServerEventMessage {
  return { type: "event", seq, serverTimeMs, event: { type: "shot-impact", shotId: "shot", impact: {
    kind: "ball", speed: 2, time: 0, ballIndex: 1, x: 0, z: 0 } } };
}

describe("规则命令和表现事件", () => {
  it("重试保留ID与版本，接受后等快照，拒绝不重放到新局面", () => {
    const sent: CommandMessage[] = [];
    const commands = new TurnCommands(c => { sent.push(c); return true; }, () => "same-id");
    const action = { type: "place-cue", x: -1.2, z: 0, attemptId: "attempt" } as const;
    expect(commands.submit(action, 4, 0)).toBe(true);
    expect(commands.submit(action, 5, 1)).toBe(false);
    commands.update(1000, 5); expect(sent).toEqual([sent[0], sent[0]]);
    commands.receive({ type: "ack", commandId: "same-id", accepted: true, duplicate: false, stateVersion: 6, serverTimeMs: 0 });
    commands.update(1001, 5); expect(commands.busy).toBe(true);
    commands.update(1002, 6); expect(commands.busy).toBe(false);
    commands.submit(action, 6, 1003);
    commands.receive({ type: "ack", commandId: "same-id", accepted: false, reason: "stale-version", duplicate: false, stateVersion: 7, serverTimeMs: 1004 });
    commands.update(3000, 7); expect(sent).toHaveLength(3); expect(commands.error).not.toBe("");
  });
  it("断线与无确认有界失败，不永久锁住操作", () => {
    const closed = new TurnCommands(() => false, () => "id");
    expect(closed.submit({ type: "replace-shot", attemptId: "a" }, 0, 0)).toBe(false);
    const lost = new TurnCommands(() => true, () => "id");
    lost.submit({ type: "replace-shot", attemptId: "a" }, 0, 0);
    for (let t = 1000; t <= 5000; t += 1000) lost.update(t, 0);
    expect(lost.busy).toBe(false); expect(lost.error).not.toBe("");
  });
  it("声音等显示游标、按序去重，过晚的碰撞声不集中补播", () => {
    const events = new PresentationEvents(), played: number[] = [];
    events.receive(impact(1, 100)); events.receive(impact(2, 200)); events.receive(impact(1, 100));
    events.consume(99, e => played.push(e.seq)); expect(played).toEqual([]);
    events.consume(100, e => played.push(e.seq)); expect(played).toEqual([1]);
    events.consume(900, e => played.push(e.seq)); expect(played).toEqual([1]);
    events.consume(901, e => played.push(e.seq)); expect(played).toEqual([1]);
  });
});
