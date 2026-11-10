import { finite, integer, list, choice, flag, record, requireCheckpoint, text } from "../core/checkpoint-validation.js";
import { readGameCheckpoint, type GameCheckpoint } from "../core/game-checkpoint.js";
import { readMatchCheckpoint, type MatchProgressCheckpoint } from "../core/match-checkpoint.js";
import type { Simulator } from "../core/simulator/simulator.js";
import type { AckMessage } from "../net/protocol.js";
import { NET_PROTOCOL_VERSION, REJECT } from "../net/protocol.js";
import type { RoomOptions } from "./room-types.js";
import type { CommandReceipt } from "./command-ledger.js";
import { readPauseCheckpoint, type PauseCheckpoint } from "../core/match-pause.js";
import { RoomPause } from "./room-pause.js";

export interface RoomCheckpoint {
  readonly format: 2;
  readonly pause: PauseCheckpoint;
  readonly protocolVersion: number;
  readonly roomId: string;
  readonly options: RoomOptions;
  readonly match: MatchProgressCheckpoint;
  readonly game: GameCheckpoint;
  readonly stateVersion: number;
  readonly eventSequence: number;
  readonly randomState: number;
  readonly commands: readonly CommandReceipt[];
}

export function readRoomCheckpoint(value: unknown, simulator: Simulator): RoomCheckpoint {
  const data = record(value), opts = record(data.options);
  requireCheckpoint(data.format === 2 && data.protocolVersion === NET_PROTOCOL_VERSION);
  const pause = readPauseCheckpoint(data.pause);
  new RoomPause().restoreCheckpoint(pause);
  const roomId = text(data.roomId);
  const match = readMatchCheckpoint(data.match), game = readGameCheckpoint(data.game, simulator);
  requireCheckpoint(game.mode === "single-play" && game.options.ruleset === "classic" &&
    game.options.players?.every(type => type === "USER") === true &&
    game.options.openingPlayerIndex === match.view.openingPlayer);
  requireCheckpoint(opts.matchId === match.view.matchId && opts.bestOf === match.view.bestOf &&
    opts.firstOpeningPlayer === match.view.firstOpeningPlayer);
  const options: RoomOptions = { matchId: match.view.matchId, bestOf: match.view.bestOf,
    firstOpeningPlayer: match.view.firstOpeningPlayer, prepareLeadMs: finite(opts.prepareLeadMs, 0),
    tickHz: finite(opts.tickHz, Number.MIN_VALUE), snapshotHz: finite(opts.snapshotHz, Number.MIN_VALUE),
    seed: integer(opts.seed, 0, 0xffffffff) };
  const stateVersion = integer(data.stateVersion), eventSequence = integer(data.eventSequence);
  const commands = list(data.commands, item => {
    const entry = record(item), ack = record(entry.ack);
    const key = text(entry.key), commandId = text(ack.commandId);
    requireCheckpoint(key === `0:${commandId}` || key === `1:${commandId}`);
    requireCheckpoint(ack.type === "ack");
    const accepted = flag(ack.accepted);
    const result: AckMessage = { type: "ack", commandId, accepted,
      duplicate: flag(ack.duplicate), stateVersion: integer(ack.stateVersion, 0, stateVersion), serverTimeMs: finite(ack.serverTimeMs),
      ...(ack.reason === undefined ? {} : { reason: choice(ack.reason, Object.values(REJECT)) }),
      ...(ack.shotId === undefined ? {} : { shotId: text(ack.shotId) }),
      ...(ack.touchAtServerMs === undefined ? {} : { touchAtServerMs: finite(ack.touchAtServerMs) }) };
    requireCheckpoint(accepted === (result.reason === undefined) && !result.duplicate &&
      (result.shotId === undefined) === (result.touchAtServerMs === undefined));
    return { key, signature: text(entry.signature), ack: result };
  }, 0, 256);
  requireCheckpoint(new Set(commands.map(entry => entry.key)).size === commands.length);
  if (match.view.phase !== "active") {
    const last = match.view.frames.at(-1)!;
    requireCheckpoint(last.scores[0] === game.players[0].pts - game.players[1].penalty &&
      last.scores[1] === game.players[1].pts - game.players[0].penalty);
  } else requireCheckpoint(game.context.ballOn !== 0);
  requireCheckpoint(match.view.phase === "active" || pause.view.phase === "running");
  return { format: 2, pause, protocolVersion: NET_PROTOCOL_VERSION, roomId, options, match, game,
    stateVersion, eventSequence, randomState: integer(data.randomState, 0, 0xffffffff), commands };
}
