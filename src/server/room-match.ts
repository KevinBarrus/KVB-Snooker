import { randomInt, randomUUID } from "node:crypto";
import { GameSession } from "../core/game.js";
import { MatchProgress, type MatchProgressView } from "../core/match-progress.js";
import type { Simulator } from "../core/simulator/simulator.js";
import type { FrameSetup } from "../core/frame-setup.js";
import type { SeatIndex, ServerEvent } from "../net/protocol.js";
import type { RoomOptions } from "./room-types.js";

export class RoomMatch {
  readonly progress: MatchProgress;
  private currentSession: GameSession;

  constructor(private readonly simulator: Simulator, options: RoomOptions) {
    this.progress = new MatchProgress({ matchId: options.matchId ?? randomUUID(), bestOf: options.bestOf ?? 3,
      firstOpeningPlayer: options.firstOpeningPlayer ?? (randomInt(2) as SeatIndex) });
    this.currentSession = this.newFrame(options.frameSetup);
  }

  get session(): GameSession { return this.currentSession; }
  get view(): MatchProgressView { return this.progress.view; }
  get active(): boolean { return this.view.phase === "active"; }

  finish(winner: SeatIndex, reason: "played" | "conceded"): ServerEvent[] {
    const frame = this.progress.finishFrame(winner, [this.session.getScore(0), this.session.getScore(1)], reason);
    if (!frame) return [];
    const events: ServerEvent[] = [{ type: "frame-ended", frame }];
    const result = this.view.result;
    if (result) events.push({ type: "match-ended", result });
    return events;
  }

  settle(): ServerEvent[] {
    const winner = this.session.winnerIndex;
    return this.session.finished && (winner === 0 || winner === 1) ? this.finish(winner, "played") : [];
  }

  ready(player: SeatIndex): readonly ServerEvent[] | null {
    if (!this.progress.readyNextFrame(player)) return null;
    if (!this.active) return [];
    this.currentSession = this.newFrame();
    return [{ type: "frame-started", match: this.view }];
  }

  private newFrame(setup?: FrameSetup): GameSession {
    return new GameSession(this.simulator, "single-play", {
      players: ["USER", "USER"], ruleset: "classic", openingPlayerIndex: this.view.openingPlayer,
      ...(setup ? { setup } : {})
    });
  }
}
