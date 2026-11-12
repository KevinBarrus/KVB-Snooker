import { describe, expect, it } from "vitest";
import { PlayerRooms } from "../../src/server/player-rooms.js";
import { makePocketTable } from "../fixtures/table.js";

const a = { userId: "account-a", name: "A" }, b = { userId: "account-b", name: "B" };
function rooms(): PlayerRooms {
  return new PlayerRooms({ meshFactory: makePocketTable, seed: 2026, tickHz: 60, snapshotHz: 20, prepareLeadMs: 700,
    firstOpeningPlayer: 0, latency: { enabled: false, inboundMs: 0, outboundMs: 0, jitterMs: 0, appliesTo: "one-way-per-direction" } });
}

describe("已认证房间与席位", () => {
  it("只有服务端创建可加入的房间，两位稳定身份绑定两席，双方准备才开局", () => {
    const r = rooms();
    try {
      expect(() => r.join("ABCDEF", a, 0)).toThrow("room-not-found");
      expect(() => r.create(a, 2, 0)).toThrow("invalid-best-of");
      const room = r.create(a, 3, 0), code = room.roomId;
      expect(room.players).toHaveLength(1);
      expect(r.join(code, a, 1).players).toHaveLength(1);
      expect(() => r.create(a, 3, 1)).toThrow("already-in-room");
      expect(r.join(code, b, 1).players).toHaveLength(2);
      expect(() => r.join(code, { userId: "outsider", name: "C" }, 1)).toThrow("room-full");
      expect(r.connect(code, { userId: "outsider", name: "A" }, "x", 1)).toHaveProperty("reason");
      const ca = r.connect(code, a, "a", 1), cb = r.connect(code, b, "b", 1);
      if ("reason" in ca || "reason" in cb) throw new Error("join failed");
      expect(ca.result.seat).toBe(0); expect(cb.result.seat).toBe(1);
      expect(r.connect(code, a, "duplicate-tab", 1)).toHaveProperty("reason", "seat-conflict");
      expect(r.canPlay(code, "a")).toBe(false);
      expect(r.ready(code, "a", true, 2).phase).toBe("waiting");
      expect(r.ready(code, "b", true, 3).phase).toBe("playing");
      expect(r.canPlay(code, "a")).toBe(true);
      expect(r.canPlay(code, "outsider")).toBe(false);
      expect(() => r.leave(code, a.userId, 4)).toThrow("match-in-progress");
      const id = ca.room.snapshot(4).match.matchId;
      r.release(code, "a");
      expect(r.current(a.userId, 4)?.roomId).toBe(code);
      const back = r.connect(code, a, "a-new", 5);
      if ("reason" in back) throw new Error("rejoin failed");
      expect(back.result.seat).toBe(0); expect(back.room.snapshot(5).match.matchId).toBe(id);
      expect(JSON.stringify(r.view(code, a.userId, 5))).not.toContain("account-a");
    } finally { r.close(); }
  });
  it("等待时退席撤销准备，原连接不能冒用替补成员，房主可关闭等待房间", () => {
    const r = rooms();
    try {
      const { roomId: code } = r.create(a, 1, 0); r.join(code, b, 0);
      r.connect(code, a, "a", 0); r.connect(code, b, "b", 0); r.ready(code, "a", true, 0);
      r.leave(code, b.userId, 1);
      expect(r.view(code, a.userId, 1).players[0].ready).toBe(false);
      r.join(code, { userId: "c", name: "C" }, 2);
      expect(r.hasConnection(code, "b")).toBe(false);
      expect(r.connect(code, b, "b", 2)).toHaveProperty("reason");
      r.leave(code, a.userId, 3); expect(r.roomCount).toBe(0);
      expect(r.current("c", 3)).toBeNull();
    } finally { r.close(); }
  });
});
