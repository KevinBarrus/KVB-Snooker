import type { GameContext, GameMode, GameState, TurnDecision } from "./game.js";
import { copyFrameSetup, type GameOptions } from "./frame-setup.js";
import { copyPracticeOptions } from "./game-options.js";
import type { PlayerSnapshot } from "./player.js";
import type { Simulator } from "./simulator/simulator.js";
import type { SerialData } from "./simulator/shot-result.js";
import { readSerialData, type SimulatorCheckpoint } from "./simulator/checkpoint.js";
import { readNineHundred, type NineHundredCheckpoint } from "./timed-checkpoint.js";
import { choice, finite, flag, integer, list, nullable, record, requireCheckpoint } from "./checkpoint-validation.js";

export interface ShotPosition {
  readonly world: SerialData;
  readonly ballOn: number;
  readonly inHand: 0 | 1 | 2;
  readonly playerIndex: number;
  readonly scoreGap: number;
  readonly points: number;
  readonly players: readonly PlayerSnapshot[];
}

export interface GameCheckpoint {
  readonly format: 1;
  readonly rulesVersion: "rules-1";
  readonly mode: GameMode;
  readonly options: GameOptions;
  readonly simulator: SimulatorCheckpoint;
  readonly state: GameState;
  readonly context: GameContext;
  readonly players: readonly PlayerSnapshot[];
  readonly result: { readonly score: number; readonly foulCode: number };
  readonly decision: TurnDecision | null;
  readonly nominatedIndex: number | null;
  readonly freeBall: boolean;
  readonly previousShot: ShotPosition | null;
  readonly snapshot: SerialData | null;
  readonly nine: NineHundredCheckpoint | null;
}

function readPlayer(value: unknown): PlayerSnapshot {
  const data = record(value);
  const result = { pts: integer(data.pts), penalty: integer(data.penalty, -Number.MAX_SAFE_INTEGER, 0),
    shootingCount: integer(data.shootingCount), scoreCount: integer(data.scoreCount),
    currentBreak: integer(data.currentBreak), maxBreak: integer(data.maxBreak) };
  requireCheckpoint(result.scoreCount <= result.shootingCount && result.currentBreak <= result.maxBreak &&
    result.maxBreak <= result.pts);
  return result;
}

export function readGameCheckpoint(value: unknown, simulator: Simulator): GameCheckpoint {
  const data = record(value);
  requireCheckpoint(data.format === 1 && data.rulesVersion === "rules-1");
  const mode = choice(data.mode, ["practice", "single-play"]);
  const playerCount = mode === "practice" ? 1 : 2;
  const count = simulator.getBallCount();
  const seat = (item: unknown) => integer(item, 0, playerCount - 1);
  const index = (item: unknown) => integer(item, 1, count - 1);
  const target = (item: unknown) => choice(item, [0, 2, 4, 8, 16, 32, 64, 128, 252, 65535]);
  const options = record(data.options);
  const ruleset = choice(options.ruleset, ["classic", "snooker-900"]);
  requireCheckpoint(mode !== "practice" || ruleset === "classic");
  const parsedOptions: GameOptions = { ruleset, openingPlayerIndex: seat(options.openingPlayerIndex),
    players: list(options.players, item => choice(item, ["USER", "AI"]), playerCount, playerCount) };
  const practice = options.practice === undefined ? undefined : record(options.practice);
  if (practice) {
    requireCheckpoint(mode === "practice");
    const parsed = {
      ...(practice.cuePlacement === undefined ? {} : { cuePlacement: choice(practice.cuePlacement, ["d-area", "anywhere"]) }),
      ...(practice.respotTargetBallNumber === undefined ? {} : { respotTargetBallNumber: integer(practice.respotTargetBallNumber, 1, 7) }),
      ...(practice.targetBallOn === undefined ? {} : { targetBallOn: target(practice.targetBallOn) }),
      ...(practice.score === undefined ? {} : { score: flag(practice.score) }),
      ...(practice.freeScoring === undefined ? {} : { freeScoring: flag(practice.freeScoring) }),
      ...(practice.respotColoursAfterReds === undefined ? {} : { respotColoursAfterReds: flag(practice.respotColoursAfterReds) })
    };
    Object.assign(parsedOptions, { practice: copyPracticeOptions(parsed) });
  }
  if (options.setup !== undefined) {
    const setup = record(options.setup);
    const parsed = { balls: list(setup.balls, item => {
      const ball = record(item);
      return { index: integer(ball.index, 0, count - 1), x: finite(ball.x), z: finite(ball.z), active: flag(ball.active) };
    }, count, count), scores: list(setup.scores, item => integer(item), playerCount, playerCount),
      ballOn: target(setup.ballOn), inHand: choice(setup.inHand, [0, 1, 2]), playerIndex: seat(setup.playerIndex) };
    Object.assign(parsedOptions, { setup: copyFrameSetup(parsed, count, playerCount) });
  }
  const physical = simulator.validateCheckpoint(data.simulator);
  const serial = (item: unknown) => readSerialData(item, physical.world.mbid, count);
  const players = (items: unknown) => list(items, readPlayer, playerCount, playerCount);
  const ctx = record(data.context);
  const context: GameContext = { playerIndex: seat(ctx.playerIndex), nRounds: integer(ctx.nRounds),
    inHand: choice(ctx.inHand, [0, 1, 2]), ballOn: target(ctx.ballOn) };
  requireCheckpoint(ctx.nominatedBallIndex === undefined && ctx.freeBallIndex === undefined);
  const decision = nullable(data.decision, item => {
    const decision = record(item);
    return { kind: choice(decision.kind, ["foul"]), playerIndex: seat(decision.playerIndex), canReplace: flag(decision.canReplace) };
  });
  const state = choice(data.state, [4, 32]);
  const previousShot = nullable(data.previousShot, item => {
    const shot = record(item);
    return { world: serial(shot.world), ballOn: target(shot.ballOn), inHand: choice(shot.inHand, [0, 1, 2]),
      playerIndex: seat(shot.playerIndex), scoreGap: integer(shot.scoreGap, -Number.MAX_SAFE_INTEGER),
      points: integer(shot.points), players: players(shot.players) };
  });
  const nine = nullable(data.nine, readNineHundred);
  const freeBall = flag(data.freeBall);
  const nominatedIndex = nullable(data.nominatedIndex, index);
  const result = record(data.result);
  requireCheckpoint((state === 32) === (decision !== null) && (!decision || decision.playerIndex === context.playerIndex) &&
    (!decision?.canReplace || previousShot !== null) && (ruleset === "snooker-900") === (nine !== null));
  requireCheckpoint(!nine || (!decision && !freeBall && (context.ballOn === 0) === nine.finished));
  requireCheckpoint(nominatedIndex === null || freeBall || context.ballOn === 252);
  return { format: 1, rulesVersion: "rules-1", mode, options: parsedOptions, simulator: physical, state, context,
    players: players(data.players), result: { score: integer(result.score, -Number.MAX_SAFE_INTEGER), foulCode: integer(result.foulCode, 0, 511) },
    decision, nominatedIndex, freeBall, previousShot, snapshot: nullable(data.snapshot, serial), nine };
}
