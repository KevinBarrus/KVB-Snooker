import type { FrameResult, MatchProgressView } from "./match-progress.js";
import { choice, flag, integer, list, nullable, record, requireCheckpoint, text } from "./checkpoint-validation.js";

export interface MatchProgressCheckpoint {
  readonly format: 1;
  readonly view: MatchProgressView;
  readonly shotSequence: number;
}

export function readMatchCheckpoint(value: unknown): MatchProgressCheckpoint {
  const data = record(value), view = record(data.view);
  requireCheckpoint(data.format === 1);
  const matchId = text(view.matchId);
  requireCheckpoint(/^[A-Za-z0-9_-]{1,64}$/.test(matchId));
  const bestOf = choice(view.bestOf, [1, 3, 5, 7, 9, 11, 17, 19, 25, 33, 35]);
  const firstOpeningPlayer = choice(view.firstOpeningPlayer, [0, 1]);
  const frameNumber = integer(view.frameNumber, 1, bestOf);
  const attemptNumber = integer(view.attemptNumber, 1);
  const frameId = `${matchId}/frame-${frameNumber}`, attemptId = `${frameId}/attempt-${attemptNumber}`;
  const openingPlayer = choice((firstOpeningPlayer + frameNumber - 1) % 2, [0, 1]);
  requireCheckpoint(view.frameId === frameId && view.attemptId === attemptId && view.openingPlayer === openingPlayer);
  const phase = choice(view.phase, ["active", "between-frames", "finished"]);
  const ready = list(view.ready, flag, 2, 2);
  requireCheckpoint(!ready.every(Boolean) && (phase === "between-frames" || !ready.some(Boolean)));
  const wins = [0, 0];
  const frames = list(view.frames, item => {
    const frame = record(item);
    const number = integer(frame.frameNumber, 1, bestOf);
    const id = `${matchId}/frame-${number}`;
    const attempt = text(frame.attemptId);
    requireCheckpoint(frame.frameId === id && attempt.startsWith(`${id}/attempt-`) &&
      /^[1-9]\d*$/.test(attempt.slice(`${id}/attempt-`.length)));
    return { frameId: id, attemptId: attempt, frameNumber: number,
      openingPlayer: choice(frame.openingPlayer, [0, 1]), winner: choice(frame.winner, [0, 1]),
      scores: list(frame.scores, entry => integer(entry), 2, 2),
      reason: choice(frame.reason, ["played", "conceded"]), shotCount: integer(frame.shotCount) } satisfies FrameResult;
  }, 0, bestOf);
  frames.forEach((frame, index) => {
    requireCheckpoint(frame.frameNumber === index + 1 && frame.openingPlayer === (firstOpeningPlayer + index) % 2 &&
      wins.every(win => win < (bestOf + 1) / 2));
    wins[frame.winner]++;
  });
  const frameWins = list(view.frameWins, item => integer(item), 2, 2);
  requireCheckpoint(wins.every((win, index) => win === frameWins[index]) &&
    frames.length === frameNumber - (phase === "active" ? 1 : 0) &&
    (phase === "finished") === wins.some(win => win >= (bestOf + 1) / 2));
  if (phase !== "active") requireCheckpoint(frames.at(-1)?.attemptId === attemptId);
  const result = nullable(view.result, item => {
    const result = record(item);
    const winner = choice(result.winner, [0, 1]);
    const resultWins = list(result.frameWins, entry => integer(entry), 2, 2);
    requireCheckpoint(result.resultId === `${matchId}/result` && result.matchId === matchId &&
      wins[winner] >= (bestOf + 1) / 2 && wins.every((win, index) => win === resultWins[index]));
    return { resultId: `${matchId}/result`, matchId, winner, frameWins: resultWins };
  });
  requireCheckpoint((phase === "finished") === (result !== null));
  const shotCount = integer(view.shotCount), shotSequence = integer(data.shotSequence, shotCount);
  const lastShotId = nullable(view.lastShotId, text);
  requireCheckpoint((shotCount === 0) === (lastShotId === null));
  if (lastShotId) {
    const suffix = lastShotId.slice(`${attemptId}/shot-`.length);
    requireCheckpoint(lastShotId.startsWith(`${attemptId}/shot-`) && /^[1-9]\d*$/.test(suffix));
    integer(Number(suffix), shotCount, shotSequence);
  }
  if (phase !== "active") requireCheckpoint(frames.at(-1)?.shotCount === shotCount);
  return { format: 1, shotSequence, view: { matchId, bestOf, firstOpeningPlayer, frameNumber, attemptNumber, frameId,
    attemptId, openingPlayer, phase, ready, frameWins, frames, result, shotCount, lastShotId } };
}
