import { describe, expect, it } from "vitest";
import { startHarness, varsFor, waitAck, waitEvent, waitStableSnapshot } from "./harness.js";
import { sleep } from "./ws-client.js";

describe("延迟注入、故障注入与多房间隔离（联机原型 §3—§7）", () => {
  it("入站/出站延迟只影响到达时间：prepareLead 不被入站延迟吃掉，结算结果不变", async () => {
    const baseline = await startHarness();
    try {
      const client = await baseline.join("baseline-room");
      const sentAt = Date.now();
      client.client.send({
        type: "command", commandId: "base-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0, -1, 5), clientSentAtMs: sentAt }
      });
      const baselineAck = await waitAck(client.client);
      const baselineAckArrivedAt = Date.now();
      expect(baselineAck.accepted).toBe(true);
      await waitEvent(client.client, "shot-settled");
      const baselineFinal = await waitStableSnapshot(client.client);
      expect(baselineFinal.checkpoint).not.toBeNull();
      const baselineAckDelay = baselineAckArrivedAt - sentAt;

      const delayed = await startHarness({ latency: { inboundMs: 40, outboundMs: 40, jitterMs: 0, dropNextAck: false } });
      try {
        const delayedClient = await delayed.join("baseline-room");
        const delayedSentAt = Date.now();
        delayedClient.client.send({
          type: "command", commandId: "base-1", expectedVersion: 0,
          action: { type: "prepare-shot", vars: varsFor(0, -1, 5), clientSentAtMs: delayedSentAt }
        });
        const delayedAck = await waitAck(delayedClient.client);
        const delayedAckArrivedAt = Date.now();
        expect(delayedAck.accepted).toBe(true);
        // 房间权威 nowMs 必须是命令投递时刻：触球 = 投递时刻 + prepareLeadMs。
        expect(delayedAck.touchAtServerMs).toBeDefined();
        expect(delayedAck.touchAtServerMs! - delayedAck.serverTimeMs).toBe(700);
        // 入站 40ms：服务器处理时刻不早于客户端发送时刻 + 入站延迟（容忍定时器抖动）。
        expect(delayedAck.serverTimeMs - delayedSentAt).toBeGreaterThanOrEqual(25);
        // 出站 40ms + 入站 40ms：Ack 实际到达明显晚于无延迟基线。
        expect(delayedAckArrivedAt - delayedSentAt).toBeGreaterThanOrEqual(60);
        expect(delayedAckArrivedAt - delayedSentAt).toBeGreaterThan(baselineAckDelay);

        await waitEvent(delayedClient.client, "shot-settled");
        const delayedFinal = await waitStableSnapshot(delayedClient.client);
        expect(delayedFinal.checkpoint).toEqual(baselineFinal.checkpoint);
      } finally {
        await delayed.close();
      }
    } finally {
      await baseline.close();
    }
  }, 30000);

  it("--drop-next-ack：客户端收不到 Ack，同 ID 重试得到 duplicate 原裁决且只出杆一次", async () => {
    const harness = await startHarness({ latency: { inboundMs: 0, outboundMs: 0, jitterMs: 0, dropNextAck: true } });
    try {
      const a = await harness.join("drop-room");
      const b = await harness.join("drop-room");
      const command = {
        type: "command", commandId: "drop-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0, -1, 5), clientSentAtMs: 0 }
      };
      a.client.send(command);
      const prepared = await waitEvent(a.client, "shot-prepared");
      await sleep(300);
      expect(a.client.all(message => message.type === "ack")).toHaveLength(0);

      a.client.send(command);
      const retried = await waitAck(a.client);
      expect(retried.duplicate).toBe(true);
      expect(retried.accepted).toBe(true);
      expect(retried.shotId).toBe(prepared.event.shotId);

      await waitEvent(a.client, "shot-fired");
      await waitEvent(b.client, "shot-fired");
      await waitEvent(a.client, "shot-settled");
      await waitStableSnapshot(a.client);
      await sleep(50);
      expect(a.client.all(message => message.type === "event" && message.event.type === "shot-fired")).toHaveLength(1);
      expect(a.client.all(message => message.type === "event" && message.event.type === "shot-prepared")).toHaveLength(1);
    } finally {
      await harness.close();
    }
  }, 30000);

  it("两个房间同时进行互不影响：同房间两端一致、房间间状态与事件序号独立", async () => {
    const harness = await startHarness();
    try {
      const a0 = await harness.join("room-alpha");
      const a1 = await harness.join("room-alpha");
      const b0 = await harness.join("room-beta");
      const b1 = await harness.join("room-beta");
      expect(a0.welcome.roomId).toBe("room-alpha");
      expect(b0.welcome.roomId).toBe("room-beta");
      expect(harness.server.roomCount()).toBe(2);

      a0.client.send({
        type: "command", commandId: "alpha-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0, -1, 5), clientSentAtMs: 0 }
      });
      b0.client.send({
        type: "command", commandId: "beta-1", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(1, 0.2, 5), clientSentAtMs: 0 }
      });
      const ackA = await waitAck(a0.client);
      const ackB = await waitAck(b0.client);
      expect(ackA.accepted).toBe(true);
      expect(ackB.accepted).toBe(true);

      await waitEvent(a0.client, "shot-settled");
      await waitEvent(b0.client, "shot-settled");
      // 结算后的稳定快照：版本 ≥2 且携带检查点（v1 是 prepare 阶段的 ready 快照）。
      const finalA0 = await waitStableSnapshot(a0.client, 2);
      const finalA1 = await waitStableSnapshot(a1.client, 2);
      const finalB0 = await waitStableSnapshot(b0.client, 2);
      const finalB1 = await waitStableSnapshot(b1.client, 2);
      expect(finalA1).toEqual(finalA0);
      expect(finalB1).toEqual(finalB0);
      expect(finalB0.checkpoint).not.toEqual(finalA0.checkpoint);

      const sequence = (clientMessages: readonly { readonly type: string; readonly seq?: number }[]): readonly number[] =>
        clientMessages.filter(message => message.type === "event").map(message => message.seq ?? -1);
      const seqA = sequence(a0.client.messages);
      const seqB = sequence(b0.client.messages);
      expect(seqA.length).toBeGreaterThan(0);
      expect(seqB.length).toBeGreaterThan(0);
      // 房间各自维护事件序号：两个房间的第一个事件序号都是 1，不共享全局计数器。
      expect(seqA[0]).toBe(1);
      expect(seqB[0]).toBe(1);
      for (let index = 1; index < seqA.length; ++index) expect(seqA[index]).toBeGreaterThan(seqA[index - 1]);
      for (let index = 1; index < seqB.length; ++index) expect(seqB[index]).toBeGreaterThan(seqB[index - 1]);
    } finally {
      await harness.close();
    }
  }, 30000);
});
