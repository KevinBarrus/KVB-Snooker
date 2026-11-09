import type { MatchClockView } from "./match-clock.js";
import type { ShootoutView } from "./nine-hundred-match.js";
import { choice, finite, flag, integer, list, nullable, record, requireCheckpoint } from "./checkpoint-validation.js";

export interface NineHundredCheckpoint {
  readonly clock: MatchClockView;
  readonly fullTable: boolean;
  readonly finished: boolean;
  readonly winner: number | null;
  readonly shootout: ShootoutView | null;
}

export function readClock(value: unknown): MatchClockView {
  const data = record(value);
  return { frameSeconds: finite(data.frameSeconds, 0, 900), shotSeconds: finite(data.shotSeconds, 0, 20),
    phase: choice(data.phase, ["placement", "aiming", "rolling", "settling", "frame-expired", "shot-expired", "finished"]),
    shootout: flag(data.shootout) };
}

export function readNineHundred(value: unknown): NineHundredCheckpoint {
  const data = record(value);
  const clock = readClock(data.clock);
  const finished = flag(data.finished);
  const winner = nullable(data.winner, item => choice(item, [0, 1]));
  const shootout = nullable(data.shootout, item => {
    const round = record(item);
    const attempts = list(round.attempts, entry => integer(entry), 2, 2);
    const potted = list(round.potted, entry => integer(entry), 2, 2);
    requireCheckpoint(potted.every((count, index) => count <= attempts[index]) && Math.abs(attempts[0] - attempts[1]) <= 1);
    return { attempts, potted };
  });
  requireCheckpoint(finished === (winner !== null) && finished === (clock.phase === "finished") &&
    clock.shootout === (shootout !== null) && (!clock.shootout || clock.frameSeconds === 0));
  requireCheckpoint(finished || (clock.phase === "aiming" || clock.phase === "placement") && clock.shotSeconds > 0 &&
    (clock.shootout || clock.frameSeconds > 0));
  return { clock, fullTable: flag(data.fullTable), finished, winner, shootout };
}
