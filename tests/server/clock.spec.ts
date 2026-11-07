import { afterEach, describe, expect, it, vi } from "vitest";
import { serverNowMs } from "../../src/server/clock.js";
import { startHarness, varsFor, waitAck, waitEvent } from "./harness.js";

afterEach(() => vi.restoreAllMocks());

describe("服务端单调时钟", () => {
  it("系统墙钟前跳或回拨不改变进程时间", () => {
    const before = serverNowMs();
    const wall = vi.spyOn(Date, "now").mockReturnValue(1);
    const backwards = serverNowMs();
    wall.mockReturnValue(9e15);
    const forwards = serverNowMs();
    expect(backwards).toBeGreaterThanOrEqual(before);
    expect(forwards).toBeGreaterThanOrEqual(backwards);
    expect(forwards - before).toBeLessThan(100);
  });

  it("pong、命令触球和运动快照使用同一单调时基", async () => {
    const harness = await startHarness();
    try {
      const { client } = await harness.join("clock-test");
      const start = serverNowMs();
      const wall = vi.spyOn(Date, "now").mockReturnValue(1);
      client.send({ type: "ping", id: 1, clientTimeMs: 0 });
      const pong = await client.waitFor(message => message.type === "pong");
      if (pong.type !== "pong") throw new Error("missing pong");
      expect(pong.serverTimeMs).toBeGreaterThanOrEqual(start);
      expect(pong.serverTimeMs - start).toBeLessThan(500);
      client.send({ type: "command", commandId: "clock-shot", expectedVersion: 0,
        action: { type: "prepare-shot", vars: varsFor(0, -1, 5) } });
      const ack = await waitAck(client);
      expect(ack.accepted).toBe(true);
      expect(ack.serverTimeMs).toBeGreaterThanOrEqual(pong.serverTimeMs);
      expect(ack.touchAtServerMs! - ack.serverTimeMs).toBe(700);
      wall.mockReturnValue(9e15);
      const fired = await waitEvent(client, "shot-fired");
      expect(fired.serverTimeMs).toBeGreaterThanOrEqual(ack.touchAtServerMs!);
      expect(fired.serverTimeMs - ack.touchAtServerMs!).toBeLessThan(100);
      const moving = await client.waitFor(message => message.type === "snapshot" && message.phase === "simulating");
      if (moving.type !== "snapshot") throw new Error("missing snapshot");
      expect(moving.serverTimeMs).toBeGreaterThanOrEqual(fired.serverTimeMs);
      expect(moving.serverTimeMs - ack.serverTimeMs).toBeLessThan(1000);
    } finally {
      vi.restoreAllMocks();
      await harness.close();
    }
  });
});
