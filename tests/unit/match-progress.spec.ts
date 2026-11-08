import { describe, expect, it } from "vitest";
import { MatchProgress } from "../../src/core/match-progress.js";

const create = (firstOpeningPlayer: 0 | 1 = 0) => new MatchProgress({ matchId: "match-a", bestOf: 3, firstOpeningPlayer });

describe("整场身份与局分", () => {
  it("三局两胜，准备齐才换局，开球轮换，整场结果只生成一次", () => {
    const match = create(1);
    const initial = match.view;
    expect(match.readyNextFrame(0)).toBe(false);
    for (const [index, winner] of ([0, 1, 0] as const).entries()) {
      const frame = match.finishFrame(winner, winner === 0 ? [70, 20] : [10, 80], "played");
      expect(frame?.openingPlayer).toBe(index % 2 === 0 ? 1 : 0);
      expect(match.finishFrame(winner, [70, 20], "played")).toBeNull();
      if (index === 2) break;
      expect(match.readyNextFrame(0)).toBe(true);
      expect(match.readyNextFrame(0)).toBe(false);
      expect(match.view.frameNumber).toBe(index + 1);
      expect(match.readyNextFrame(1)).toBe(true);
      expect(match.view.frameNumber).toBe(index + 2);
      expect(match.view.frameId).not.toBe(frame?.frameId);
    }
    expect(match.view).toMatchObject({ phase: "finished", frameWins: [2, 1], frameNumber: 3,
      result: { resultId: "match-a/result", matchId: "match-a", winner: 0, frameWins: [2, 1] } });
    expect(match.readyNextFrame(0)).toBe(false);
    expect(match.reserveShotId()).toBeNull();
    expect(match.rerack()).toBe(false);
    expect(initial.frameWins).toEqual([0, 0]);
    expect(initial.frames).toEqual([]);
  });

  it("重摆只换尝试，取消准备不记杆，实际触球去重", () => {
    const match = create();
    const first = match.view;
    const cancelled = match.reserveShotId()!;
    expect(match.view.shotCount).toBe(0);
    const fired = match.reserveShotId()!;
    expect(fired).not.toBe(cancelled);
    expect(match.recordStrike(cancelled)).toBe(false);
    expect(match.recordStrike(fired)).toBe(true);
    expect(match.recordStrike(fired)).toBe(false);
    expect(match.view).toMatchObject({ shotCount: 1, lastShotId: fired });
    expect(match.rerack()).toBe(true);
    expect(match.view).toMatchObject({ frameId: first.frameId, matchId: first.matchId,
      openingPlayer: first.openingPlayer, attemptNumber: 2, shotCount: 0, frameWins: [0, 0] });
    expect(match.recordStrike(fired)).toBe(false);
    expect(match.reserveShotId()).toContain("match-a/frame-1/attempt-2/shot-1");
    match.finishFrame(0, [10, 0], "conceded");
    match.readyNextFrame(0); match.readyNextFrame(1);
    match.rerack();
    expect(match.view.frameWins).toEqual([1, 0]);
    expect(match.view.openingPlayer).toBe(1);
    expect(match.view.attemptId).toBe("match-a/frame-2/attempt-2");
  });

  it("断线撤销准备；非法赛制、比分和重复结算不污染局分", () => {
    expect(() => new MatchProgress({ matchId: "x", bestOf: 2, firstOpeningPlayer: 0 })).toThrow();
    const match = create();
    expect(match.finishFrame(0, [NaN, 0], "played")).toBeNull();
    match.finishFrame(0, [1, 0], "conceded");
    match.readyNextFrame(0); match.clearReady(0); match.readyNextFrame(1);
    expect(match.view.phase).toBe("between-frames");
    expect(match.view.ready).toEqual([false, true]);
    match.readyNextFrame(0);
    match.finishFrame(0, [1, 0], "conceded");
    expect(match.view.frameWins).toEqual([2, 0]);
    expect(match.view.frames).toHaveLength(2);
  });
});
