import { describe, expect, it } from "vitest";
import type { CommandMessage, PauseAction, SnapshotMessage } from "../../src/net/protocol.js";
import { startHarness, waitAck, waitSnapshot } from "./harness.js";

const command = (snapshot: SnapshotMessage, type: PauseAction["type"], id: string): CommandMessage => ({
  type: "command", commandId: id, expectedVersion: snapshot.version,
  action: { type, attemptId: snapshot.match.attemptId }
});

describe("暂停传输", () => {
  it("真实双连接协商、去重、双方准备后恢复，独立房间不受影响", async () => {
    const harness = await startHarness();
    try {
      const { client: a } = await harness.join("pause", 0);
      const { client: b } = await harness.join("pause", 1);
      const { client: other } = await harness.join("unaffected", 0);
      const initial = await waitSnapshot(a, () => true);
      const req = command(initial, "pause-request", "request");
      a.send(req);
      expect((await waitAck(a)).accepted).toBe(true);
      const requested = await waitSnapshot(b, s => s.pause.phase === "requested");
      a.send(req);
      expect((await waitAck(a)).duplicate).toBe(true);
      b.send(command(requested, "pause-accept", "accept"));
      expect((await waitAck(b)).accepted).toBe(true);
      const paused = await waitSnapshot(a, s => s.pause.phase === "paused");
      expect((await waitSnapshot(b, s => s.pause.phase === "paused")).balls).toEqual(paused.balls);
      a.send(command(paused, "pause-ready", "ready-a"));
      expect((await waitAck(a)).accepted).toBe(true);
      const prepared = await waitSnapshot(b, s => s.pause.ready[0]);
      b.send(command(prepared, "pause-ready", "ready-b"));
      expect((await waitAck(b)).accepted).toBe(true);
      const resuming = await waitSnapshot(a, s => s.pause.phase === "resuming");
      expect(resuming.pause.countdownSeconds).toBeGreaterThan(2.5);
      const resumed = await waitSnapshot(a, s => s.version > resuming.version && s.pause.phase === "running");
      expect(resumed.balls).toEqual(initial.balls);
      expect(resumed.context).toEqual(initial.context);
      expect(resumed.match).toEqual(initial.match);
      expect((await waitSnapshot(other, () => true)).pause.phase).toBe("running");
    } finally { await harness.close(); }
  }, 15000);
});
