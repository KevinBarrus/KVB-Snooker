import { describe, expect, it } from "vitest";
import type { CommandMessage, MatchAction, SnapshotMessage } from "../../src/net/protocol.js";
import { startHarness, waitAck, waitSnapshot } from "./harness.js";

const command = (snapshot: SnapshotMessage, type: MatchAction["type"], commandId: string): CommandMessage => ({
  type: "command", commandId, expectedVersion: snapshot.version,
  action: { type, attemptId: snapshot.match.attemptId }
});

describe("整场传输", () => {
  it("双客户端完成2:1、广播一致、重发只回原结果、独立房间不变", async () => {
    const harness = await startHarness({ room: { prepareLeadMs: 700, tickHz: 60, snapshotHz: 20,
      seed: 42, bestOf: 3, firstOpeningPlayer: 1 } });
    try {
      const { client: a } = await harness.join("match-a", 0);
      const { client: b } = await harness.join("match-a", 1);
      const { client: other } = await harness.join("match-b", 0);
      const otherInitial = await waitSnapshot(other, () => true);
      let latest = await waitSnapshot(b, () => true);
      const clients = [a, b];
      for (const [index, loser] of [1, 0, 1].entries()) {
        expect(latest.match.openingPlayer).toBe(index % 2 === 0 ? 1 : 0);
        const concede = command(latest, "concede-frame", `end-${index}`);
        clients[loser].send(concede);
        const snapshots = await Promise.all(clients.map(client => waitSnapshot(client,
          snap => snap.match.frames.length === index + 1)));
        expect(snapshots[0]).toEqual(snapshots[1]);
        latest = snapshots[0];
        clients[loser].send(concede);
        expect((await waitAck(clients[loser])).duplicate).toBe(true);
        if (index < 2) {
          a.send(command(latest, "ready-next-frame", `r0-${index}`));
          latest = await waitSnapshot(b, snap => snap.version > latest.version);
          expect(latest.match.frameNumber).toBe(index + 1);
          b.send(command(latest, "ready-next-frame", `r1-${index}`));
          latest = await waitSnapshot(b, snap => snap.match.frameNumber === index + 2);
          expect(latest.context.scores).toEqual([0, 0]);
        }
      }
      expect(latest.match.result).toMatchObject({ winner: 0, frameWins: [2, 1] });
      for (const client of clients) {
        const events = client.messages.filter(m => m.type === "event" && m.event.type === "match-ended");
        expect(events).toHaveLength(1);
        expect(client.messages.filter(m => m.type === "event" && m.event.type === "frame-ended")).toHaveLength(3);
      }
      expect(other.messages.filter(m => m.type === "event" && m.event.type === "frame-ended")).toHaveLength(0);
      expect(otherInitial.match.matchId).not.toBe(latest.match.matchId);
      expect(otherInitial.match.frameWins).toEqual([0, 0]);
    } finally { await harness.close(); }
  });
});
