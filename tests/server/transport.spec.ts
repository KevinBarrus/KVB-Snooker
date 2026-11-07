import { describe, expect, it } from "vitest";
import { NET_PROTOCOL_VERSION, REJECT } from "../../src/net/protocol.js";
import {
  DEV_TOKEN, joinRaw, startHarness, varsFor, waitAck, waitError, waitEvent, waitSnapshot, waitStableSnapshot
} from "./harness.js";
import { sleep } from "./ws-client.js";

describe("WebSocket 传输与双客户端（联机原型 §3—§6）", () => {
  it("两个客户端加入同一房间得到不同席位、welcome 与初始快照", async () => {
    const harness = await startHarness();
    try {
      const a = await harness.join("room-a");
      const b = await harness.join("room-a");
      expect(a.welcome.seat).toBe(0);
      expect(b.welcome.seat).toBe(1);
      expect(a.welcome.protocolVersion).toBe(NET_PROTOCOL_VERSION);
      expect(a.welcome.roomId).toBe("room-a");
      expect(a.welcome.stateVersion).toBe(0);
      expect(a.welcome.latency.appliesTo).toBe("one-way-per-direction");
      expect(a.welcome.match).toEqual({ ruleset: "classic", mode: "single-play", tickHz: 60, snapshotHz: 20, prepareLeadMs: 700 });
      expect(b.welcome.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: true }]);
      expect(harness.server.roomCount()).toBe(1);

      const initial = await waitSnapshot(a.client, snapshot => snapshot.version === 0);
      expect(initial.phase).toBe("ready");
      expect(initial.balls).toHaveLength(22);
      expect(initial.checkpoint?.mbid).toBe("six-pocket-test-table");
      expect(initial.pendingShot).toBeNull();

      const firstSeatEvent = await waitEvent(a.client, "seat-changed");
      expect(firstSeatEvent.event.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: false }]);
      const secondSeatEvent = await waitEvent(a.client, "seat-changed");
      expect(secondSeatEvent.event.seats).toEqual([{ seat: 0, connected: true }, { seat: 1, connected: true }]);
    } finally {
      await harness.close();
    }
  }, 20000);

  it("client0 prepare-shot：两端收到同一杆事件与一致快照", async () => {
    const harness = await startHarness();
    try {
      const a = await harness.join("room-shot");
      const b = await harness.join("room-shot");
      const sentAt = Date.now();
      a.client.send({
        type: "command", commandId: "shot-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0, -1, 5), clientSentAtMs: sentAt }
      });
      const ack = await waitAck(a.client);
      expect(ack.accepted).toBe(true);
      expect(ack.duplicate).toBe(false);
      expect(ack.stateVersion).toBe(1);
      expect(ack.shotId).toBeDefined();
      expect(ack.touchAtServerMs).toBeDefined();
      if (ack.touchAtServerMs === undefined) throw new Error("missing touch time");
      expect(ack.touchAtServerMs - ack.serverTimeMs).toBe(700);

      const preparedA = await waitEvent(a.client, "shot-prepared");
      const preparedB = await waitEvent(b.client, "shot-prepared");
      expect(preparedA.event.shotId).toBe(ack.shotId);
      expect(preparedB.event.shotId).toBe(ack.shotId);
      expect(preparedA.event.prepareLeadMs).toBe(700);

      const firedA = await waitEvent(a.client, "shot-fired");
      const firedB = await waitEvent(b.client, "shot-fired");
      expect(firedA.event.shotId).toBe(ack.shotId);
      expect(firedB.event.firedAtServerMs).toBeGreaterThanOrEqual(firedB.event.touchAtServerMs);

      const settledA = await waitEvent(a.client, "shot-settled");
      const settledB = await waitEvent(b.client, "shot-settled");
      expect(settledB.event.shotId).toBe(settledA.event.shotId);
      expect(settledB.event.score).toBe(settledA.event.score);
      expect(settledB.event.foulCode).toBe(settledA.event.foulCode);

      const finalA = await waitStableSnapshot(a.client);
      const finalB = await waitStableSnapshot(b.client);
      expect(finalA.version).toBe(3);
      expect(finalB).toEqual(finalA);
      expect(finalA.checkpoint).not.toBeNull();
      expect(finalA.pendingShot).toBeNull();
      expect(finalA.phase === "ready" || finalA.phase === "deciding" || finalA.phase === "finished").toBe(true);
    } finally {
      await harness.close();
    }
  }, 20000);

  it("同 ID 同参数重试只产生一次 shot-fired，并返回 duplicate 原裁决", async () => {
    const harness = await startHarness();
    try {
      const a = await harness.join("room-retry");
      const b = await harness.join("room-retry");
      const command = {
        type: "command", commandId: "retry-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0.4, -1, 5), clientSentAtMs: 0 }
      };
      a.client.send(command);
      const first = await waitAck(a.client);
      expect(first.accepted).toBe(true);
      a.client.send(command);
      const second = await waitAck(a.client);
      expect(second.duplicate).toBe(true);
      expect(second.accepted).toBe(true);
      expect(second.shotId).toBe(first.shotId);
      expect(second.stateVersion).toBe(first.stateVersion);
      expect(second.touchAtServerMs).toBe(first.touchAtServerMs);

      await waitEvent(a.client, "shot-fired");
      await waitEvent(a.client, "shot-settled");
      await waitStableSnapshot(a.client);
      expect(a.client.all(message => message.type === "event" && message.event.type === "shot-fired")).toHaveLength(1);
      expect(a.client.all(message => message.type === "event" && message.event.type === "shot-prepared")).toHaveLength(1);
      expect(b.client.all(message => message.type === "event" && message.event.type === "shot-fired")).toHaveLength(1);
      await sleep(50);
      expect(a.client.all(message => message.type === "event" && message.event.type === "shot-fired")).toHaveLength(1);
    } finally {
      await harness.close();
    }
  }, 20000);

  it("开发令牌、协议版本、非法 roomId、席位冲突与房间满被明确拒绝", async () => {
    const harness = await startHarness();
    try {
      const badToken = await harness.connect();
      badToken.send({ type: "hello", protocolVersion: NET_PROTOCOL_VERSION, devToken: "wrong-token", roomId: "room-a" });
      expect((await waitError(badToken)).code).toBe(REJECT.BAD_TOKEN);
      await badToken.peerClosed();

      const badProtocol = await harness.connect();
      badProtocol.send({ type: "hello", protocolVersion: 99, devToken: DEV_TOKEN, roomId: "room-a" });
      expect((await waitError(badProtocol)).code).toBe(REJECT.BAD_PROTOCOL);
      await badProtocol.peerClosed();

      const badRoom = await harness.connect();
      badRoom.send({ type: "hello", protocolVersion: NET_PROTOCOL_VERSION, devToken: DEV_TOKEN, roomId: "bad room!" });
      expect((await waitError(badRoom)).code).toBe(REJECT.BAD_PROTOCOL);
      await badRoom.peerClosed();

      const unjoined = await harness.connect();
      unjoined.send({ type: "command", commandId: "x", expectedVersion: 0, action: { type: "decide-turn", takeOver: true } });
      expect((await waitError(unjoined)).code).toBe(REJECT.NOT_YOUR_TURN);

      const first = await harness.connect();
      expect((await joinRaw(first, "room-limit", { requestedSeat: 0 })).seat).toBe(0);
      const conflict = await harness.connect();
      conflict.send({ type: "hello", protocolVersion: NET_PROTOCOL_VERSION, devToken: DEV_TOKEN, roomId: "room-limit", requestedSeat: 0 });
      expect((await waitError(conflict)).code).toBe(REJECT.SEAT_CONFLICT);
      await conflict.peerClosed();

      const second = await harness.connect();
      expect((await joinRaw(second, "room-limit")).seat).toBe(1);
      const third = await harness.connect();
      third.send({ type: "hello", protocolVersion: NET_PROTOCOL_VERSION, devToken: DEV_TOKEN, roomId: "room-limit" });
      expect((await waitError(third)).code).toBe(REJECT.ROOM_FULL);
      await third.peerClosed();
      expect(harness.server.roomCount()).toBe(1);
    } finally {
      await harness.close();
    }
  }, 20000);
});
