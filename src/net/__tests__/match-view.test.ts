import { expect, it } from "vitest";
import { MatchProgress } from "../../core/match-progress.js";
import { isMatchProgressView } from "../protocol.js";

it("整场快照校验拒绝缺失身份、非法局分与胜者", () => {
  const match = new MatchProgress({ matchId: "m", bestOf: 1, firstOpeningPlayer: 1 });
  expect(isMatchProgressView(match.view)).toBe(true);
  expect(isMatchProgressView(undefined)).toBe(false);
  expect(isMatchProgressView({ ...match.view, attemptId: "" })).toBe(false);
  expect(isMatchProgressView({ ...match.view, frameWins: [NaN, 0] })).toBe(false);
  expect(isMatchProgressView({ ...match.view, ready: [] })).toBe(false);
  match.finishFrame(1, [0, 7], "played");
  expect(isMatchProgressView(match.view)).toBe(true);
  expect(isMatchProgressView({ ...match.view, result: { ...match.view.result, winner: 2 } })).toBe(false);
});
