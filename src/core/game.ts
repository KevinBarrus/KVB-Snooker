import { SnookerRef, type RulesContext } from "./rules/snooker.js";
import type { Simulator } from "./simulator/simulator.js";
import type { SerialData, StrokeVars } from "./simulator/shot-result.js";
import { Player } from "./player.js";
import { copyFrameSetup, type FrameSetup, type GameOptions } from "./frame-setup.js";
import { coreRandom } from "./rng.js";
import { inferColour, type NominationView } from "./rules/nomination.js";
import { snookerView } from "./rules/snookered.js";
import { hasOpenInHand } from "./rules/in-hand-visibility.js";

// PCOL L8922-8931
export const GAME_STATE = { ERROR: 0, NO_GAME: 1, PENDING: 2, READY: 4, SIMULATING: 8, JUDGING: 16, DECIDING: 32 } as const;
export type GameState = typeof GAME_STATE[keyof typeof GAME_STATE];
export type GameMode = "practice" | "single-play";
export interface TurnDecision { readonly kind: "foul" | "black"; readonly playerIndex: number }

export interface GameContext extends RulesContext {
  playerIndex: number;
  nRounds: number;
}

// PCOL L3660-3772
export class GameSession {
  readonly context: GameContext = { inHand: 0, ballOn: 0, playerIndex: -1, nRounds: 0 };
  readonly players: Player[];
  readonly result = { score: 0, foulCode: 0 };
  private readonly ref = new SnookerRef();
  private currentState: GameState = GAME_STATE.NO_GAME;
  private serialData: SerialData | null = null;
  private readonly initialSetup?: FrameSetup;
  private pendingDecision: TurnDecision | null = null;
  private nominatedIndex: number | null = null;
  private prepared = false;
  private freeBall = false;

  constructor(readonly simulator: Simulator, readonly mode: GameMode = "single-play", options: GameOptions = {}) {
    const types = options.players ?? (mode === "practice" ? ["USER"] : ["USER", "AI"]);
    if (types.length !== (mode === "practice" ? 1 : 2) || types.some(type => type !== "USER" && type !== "AI") ||
        (mode === "practice" && options.setup)) throw new Error("Invalid game options");
    this.players = types.map(type => new Player(type));
    this.initialSetup = options.setup && copyFrameSetup(options.setup, simulator.getBallCount(), this.players.length);
    this.currentState = GAME_STATE.PENDING;
    this.ref.syncAreaWithSimulator(simulator);
    this.reset();
  }

  get state(): GameState { return this.currentState; }
  get finished(): boolean { return this.mode === "single-play" && this.context.ballOn === 0; }
  get decision(): TurnDecision | null { return this.pendingDecision && { ...this.pendingDecision }; }
  get freeBallAvailable(): boolean { return this.freeBall; }
  get touchingBallIndices(): readonly number[] {
    const cue = this.simulator.getBallAtIndex(0);
    return this.simulator.getBalls().filter(ball => ball.active && ball.index !== 0 &&
      ball.position.distanceTo(cue.position) <= 2 * this.simulator.ballRadius + 1e-5).map(ball => ball.index);
  }
  get winnerIndex(): number | null {
    return this.finished ? (this.getScore(0) > this.getScore(1) ? 0 : this.getScore(1) > this.getScore(0) ? 1 : null) : null;
  }
  getScore(index: number): number {
    return this.players[index].pts - (this.players[1 - index]?.penalty ?? 0);
  }
  get snapshot(): SerialData | null {
    return this.serialData && { ...this.serialData, balls: [...this.serialData.balls] };
  }

  reset(): void {
    this.currentState = GAME_STATE.JUDGING;
    this.pendingDecision = null;
    this.nominatedIndex = null;
    this.prepared = false;
    this.freeBall = false;
    delete this.context.nominatedBallIndex;
    delete this.context.freeBallIndex;
    for (const player of this.players) player.clearScores();
    this.context.playerIndex = this.context.nRounds = 0;
    this.ref.resetGContext(this.context);
    if (this.mode === "practice") {
      this.context.inHand = 1;
      this.context.ballOn = this.ref.sysReservedBallOn;
    }
    this.result.score = this.result.foulCode = 0;
    this.simulator.reset(true, true);
    if (this.initialSetup) {
      const setup = this.initialSetup;
      for (const placement of setup.balls) {
        const ball = this.simulator.getBallAtIndex(placement.index);
        ball.orientation.set(0, 0, 0, 1);
        this.simulator.resetBallXYZ(ball, placement.x, this.simulator.spotY, placement.z);
        if (!placement.active) this.simulator.resetBallPosition(ball, null);
      }
      this.context.ballOn = setup.ballOn;
      this.context.inHand = setup.inHand;
      this.context.playerIndex = setup.playerIndex;
      setup.scores.forEach((score, index) => { this.players[index].pts = score; });
      this.simulator.reset(false, true);
    }
    this.response();
  }

  placeCueBall(x: number, y: number, z: number): boolean {
    if (this.state !== GAME_STATE.READY || this.finished || this.prepared || this.context.inHand === 0) return false;
    if (!this.ref.placeCueBallCheck(x, y, z, this.simulator)) return false;
    this.currentState = GAME_STATE.JUDGING;
    this.simulator.respotIndexXYZ(0, x, this.simulator.spotY, z);
    if (this.context.inHand > 1) this.context.inHand = 1;
    this.response();
    return true;
  }

  stroke(playerIndex: number, vars: StrokeVars): boolean {
    if (this.state !== GAME_STATE.READY || this.finished || playerIndex !== this.context.playerIndex) return false;
    if (!this.prepared && !this.prepareStroke(playerIndex, vars)) return false;
    this.players[playerIndex].shootingCount++;
    this.currentState = GAME_STATE.SIMULATING;
    this.simulator.stroke(vars);
    return true;
  }

  nominate(playerIndex: number, ballIndex: number | null): boolean {
    if (this.state !== GAME_STATE.READY || this.prepared || (!this.freeBall && this.context.ballOn !== 252) || playerIndex !== this.context.playerIndex) return false;
    if (ballIndex !== null && !this.simulator.getBalls().some(ball => ball.index === ballIndex && ball.active && ball.number > 0 &&
      (this.freeBall ? (2 ** ball.number & this.context.ballOn) === 0 : ball.number > 1))) return false;
    this.nominatedIndex = ballIndex;
    return true;
  }

  getNomination(dx: number, dz: number): NominationView {
    if (this.freeBall) return { required: this.nominatedIndex !== null, ballIndex: this.nominatedIndex, manual: this.nominatedIndex !== null };
    const required = this.context.ballOn === 252;
    return { required, ballIndex: required ? this.context.nominatedBallIndex ?? this.nominatedIndex ?? inferColour(this.simulator, dx, dz) : null,
      manual: this.nominatedIndex !== null };
  }

  prepareStroke(playerIndex: number, vars: StrokeVars): boolean {
    if (this.state !== GAME_STATE.READY || this.finished || playerIndex !== this.context.playerIndex) return false;
    if (this.prepared) return true;
    const nomination = this.getNomination(vars[3], vars[5]);
    if (nomination.required) {
      if (nomination.ballIndex === null) return false;
      if (this.freeBall) this.context.freeBallIndex = nomination.ballIndex;
      else this.context.nominatedBallIndex = nomination.ballIndex;
    }
    this.prepared = true;
    return true;
  }

  chooseNextPlayer(playerIndex: number, nextIndex: number): boolean {
    if (this.state !== GAME_STATE.DECIDING || this.pendingDecision?.playerIndex !== playerIndex ||
        !Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= this.players.length) return false;
    if (nextIndex !== playerIndex) this.freeBall = false;
    this.context.playerIndex = nextIndex;
    this.pendingDecision = null;
    this.currentState = GAME_STATE.READY;
    return true;
  }

  step(dt: number): void {
    if (this.state !== GAME_STATE.SIMULATING) return;
    this.simulator.step(dt);
    if (this.simulator.nAwakened !== 0) return;
    this.currentState = GAME_STATE.JUDGING;
    this.ref.checkResult(this.context, this.simulator, this.result);
    this.prepared = false;
    this.freeBall = false;
    this.nominatedIndex = null;
    delete this.context.nominatedBallIndex;
    delete this.context.freeBallIndex;
    const index = this.context.playerIndex;
    const player = this.players[index];
    this.context.nRounds++;
    if (this.result.score > 0) {
      player.pts += this.result.score;
      player.scoreCount++;
      player.brk += this.result.score;
    } else {
      player.penalty += this.result.score;
      player.brk = 0;
      this.context.playerIndex = (index + 1) % this.players.length;
    }
    if (this.finished && this.getScore(0) === this.getScore(1)) {
      const black = this.simulator.getBalls().find(ball => ball.number === 7);
      if (!black) throw new Error("Missing black for tie-break");
      this.simulator.respotIndexDefault(black.index);
      this.simulator.respotIndexDefault(0);
      this.context.ballOn = 128;
      this.context.inHand = 2;
      this.context.playerIndex = coreRandom() < .5 ? 0 : 1;
      this.players.forEach(player => { player.brk = 0; });
      this.pendingDecision = { kind: "black", playerIndex: this.context.playerIndex };
    } else if (this.mode !== "practice" && !this.finished && this.result.foulCode !== 0) {
      this.pendingDecision = { kind: "foul", playerIndex: this.context.playerIndex };
    }
    this.response();
    if (this.pendingDecision?.kind === "foul") {
      this.freeBall = this.context.inHand > 0 ? !hasOpenInHand(this.simulator, this.context.ballOn, this.ref.dArea)
        : snookerView(this.simulator, this.context.ballOn).snookered;
    }
  }

  private response(): void {
    let count = 0;
    while (this.simulator.nAwakened !== 0) {
      if (++count > 200) {
        this.currentState = GAME_STATE.ERROR;
        throw new Error("too much ff(>200), must be some error!");
      }
      this.simulator.step(0.1);
    }
    this.serialData = this.simulator.serialize();
    this.currentState = this.pendingDecision ? GAME_STATE.DECIDING : GAME_STATE.READY;
  }
}
