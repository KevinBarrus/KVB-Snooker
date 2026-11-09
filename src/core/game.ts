import { SnookerRef, type RulesContext } from "./rules/snooker.js";
import type { Simulator } from "./simulator/simulator.js";
import type { SerialData, StrokeVars } from "./simulator/shot-result.js";
import { Player } from "./player.js";
import { copyFrameSetup, type FrameSetup, type GameOptions, type PracticeOptions, type RuleSet } from "./frame-setup.js";
import { availablePoints, isMiss } from "./rules/miss.js";
import { inferColour, type NominationView } from "./rules/nomination.js";
import { snookerView } from "./rules/snookered.js";
import { hasOpenInHand } from "./rules/in-hand-visibility.js";
import { NineHundredRef, canPlaceOnTable } from "./rules/nine-hundred.js";
import { NineHundredMatch, type ShootoutView } from "./nine-hundred-match.js";
import type { MatchClockView } from "./match-clock.js";
import { copyPracticeOptions } from "./game-options.js";
import { settleFreePractice, settleTimedScore, applyTimeoutFoul } from "./game-settlement.js";
import { readGameCheckpoint, type GameCheckpoint, type ShotPosition } from "./game-checkpoint.js";
// PCOL L8922-8931
export const GAME_STATE = { ERROR: 0, NO_GAME: 1, PENDING: 2, READY: 4, SIMULATING: 8, JUDGING: 16, DECIDING: 32 } as const;
export type GameState = typeof GAME_STATE[keyof typeof GAME_STATE];
export type GameMode = "practice" | "single-play";
export interface TurnDecision { readonly kind: "foul"; readonly playerIndex: number; readonly canReplace: boolean }
export interface GameContext extends RulesContext {
  playerIndex: number;
  nRounds: number;
}
// PCOL L3660-3772
export class GameSession {
  readonly context: GameContext = { inHand: 0, ballOn: 0, playerIndex: -1, nRounds: 0 };
  readonly players: Player[];
  readonly result = { score: 0, foulCode: 0 };
  readonly ruleset: RuleSet;
  private readonly ref: SnookerRef;
  private readonly nine: NineHundredMatch | null;
  private currentState: GameState = GAME_STATE.NO_GAME;
  private serialData: SerialData | null = null;
  private initialSetup?: FrameSetup;
  private readonly practiceOptions: PracticeOptions;
  private pendingDecision: TurnDecision | null = null;
  private nominatedIndex: number | null = null;
  private prepared = false;
  private freeBall = false;
  private previousShot: ShotPosition | null = null;
  private initialColourIndices: number[];
  private openingIndex: number;
  constructor(readonly simulator: Simulator, readonly mode: GameMode = "single-play", options: GameOptions = {}) {
    const types = options.players ?? (mode === "practice" ? ["USER"] : ["USER", "AI"]);
    if (types.length !== (mode === "practice" ? 1 : 2) || types.some(type => type !== "USER" && type !== "AI")) {
      throw new Error("Invalid game options");
    }
    if (mode !== "practice" && options.practice) throw new Error("Invalid game options");
    this.practiceOptions = copyPracticeOptions(options.practice ?? {});
    const opening = options.openingPlayerIndex ?? 0;
    if (!Number.isInteger(opening) || opening < 0 || opening >= types.length) throw new Error("Invalid opening player");
    this.openingIndex = opening;
    this.ruleset = options.ruleset ?? "classic";
    if (this.ruleset !== "classic" && this.ruleset !== "snooker-900") throw new Error("Invalid ruleset");
    if (this.ruleset === "snooker-900" && mode === "practice") throw new Error("Practice does not support snooker-900");
    this.ref = this.ruleset === "snooker-900" ? new NineHundredRef() : new SnookerRef();
    this.nine = this.ruleset === "snooker-900" ? new NineHundredMatch() : null;
    this.players = types.map(type => new Player(type));
    this.initialSetup = options.setup && copyFrameSetup(options.setup, simulator.getBallCount(), this.players.length);
    this.initialColourIndices = this.initialSetup
      ? this.initialSetup.balls.filter(ball => ball.active && ball.index > 0 &&
        this.simulator.getBallAtIndex(ball.index).number >= 2).map(ball => ball.index)
      : [];
    this.currentState = GAME_STATE.PENDING;
    this.ref.syncAreaWithSimulator(simulator);
    this.reset();
  }
  get openingPlayerIndex(): number { return this.openingIndex; }
  get state(): GameState { return this.currentState; }
  get finished(): boolean { return this.nine ? this.nine.finished : this.mode === "single-play" && this.context.ballOn === 0; }
  get clock(): MatchClockView | null { return this.nine ? this.nine.clock.view : null; }
  get timeUntilExpiry(): number { return this.nine ? this.nine.clock.untilExpiry : Infinity; }
  get shootout(): ShootoutView | null { return this.nine ? this.nine.shootout : null; }
  get decision(): TurnDecision | null { return this.pendingDecision && { ...this.pendingDecision }; }
  get canRestorePreviousShot(): boolean { return this.previousShot !== null && !this.prepared; }
  get practiceScored(): boolean { return this.practiceOptions.score !== false; }
  get freeBallAvailable(): boolean { return this.freeBall; }
  get touchingBallIndices(): readonly number[] {
    const cue = this.simulator.getBallAtIndex(0);
    return this.simulator.getBalls().filter(ball => ball.active && ball.index !== 0 &&
      ball.position.distanceTo(cue.position) <= 2 * this.simulator.ballRadius + 1e-5).map(ball => ball.index);
  }
  get winnerIndex(): number | null {
    if (this.nine) return this.nine.winner;
    return this.finished ? (this.getScore(0) > this.getScore(1) ? 0 : this.getScore(1) > this.getScore(0) ? 1 : null) : null;
  }
  getScore(index: number): number {
    return this.players[index].pts - (this.players[1 - index]?.penalty ?? 0);
  }
  get snapshot(): SerialData | null {
    return this.serialData && { ...this.serialData, balls: [...this.serialData.balls] };
  }
  exportCheckpoint(): GameCheckpoint {
    if (this.prepared || (this.state !== GAME_STATE.READY && this.state !== GAME_STATE.DECIDING)) {
      throw new Error("Checkpoint requires a stable turn without a prepared shot");
    }
    return readGameCheckpoint({ format: 1, rulesVersion: "rules-1", mode: this.mode,
      options: { ruleset: this.ruleset, players: this.players.map(player => player.type),
        openingPlayerIndex: this.openingIndex, ...(this.initialSetup ? { setup: this.initialSetup } : {}),
        ...(this.mode === "practice" ? { practice: this.practiceOptions } : {}) },
      simulator: this.simulator.exportCheckpoint(), state: this.state, context: this.context,
      players: this.players.map(player => player.snapshot()), result: this.result, decision: this.pendingDecision,
      nominatedIndex: this.nominatedIndex, freeBall: this.freeBall, previousShot: this.previousShot,
      snapshot: this.serialData, nine: this.nine?.exportCheckpoint() ?? null }, this.simulator);
  }
  static fromCheckpoint(simulator: Simulator, value: unknown): GameSession {
    const data = readGameCheckpoint(value, simulator);
    const game = new GameSession(simulator, data.mode, { ...data.options, setup: undefined });
    game.initialSetup = data.options.setup;
    game.initialColourIndices = data.options.setup?.balls.filter(ball => ball.active && ball.index > 0 &&
      simulator.getBallView(ball.index).number >= 2).map(ball => ball.index) ?? [];
    simulator.restoreCheckpoint(data.simulator);
    Object.assign(game.context, data.context);
    Object.assign(game.result, data.result);
    data.players.forEach((player, index) => game.players[index].restore(player));
    game.currentState = data.state;
    game.pendingDecision = data.decision;
    game.nominatedIndex = data.nominatedIndex;
    game.freeBall = data.freeBall;
    game.previousShot = data.previousShot;
    game.serialData = data.snapshot;
    if (data.nine) game.nine!.restoreCheckpoint(data.nine);
    return game;
  }

  reset(): void {
    // PCOL L3700-3714
    if (this.currentState !== GAME_STATE.PENDING && this.mode !== "practice" && !this.initialSetup) {
      this.openingIndex = (this.openingIndex + 1) % this.players.length;
    }
    this.currentState = GAME_STATE.JUDGING;
    this.pendingDecision = null;
    this.previousShot = null;
    this.nominatedIndex = null;
    this.prepared = false;
    this.freeBall = false;
    delete this.context.nominatedBallIndex;
    delete this.context.freeBallIndex;
    for (const player of this.players) player.clearScores();
    this.context.playerIndex = this.openingIndex;
    this.context.nRounds = 0;
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
    if (this.mode === "practice" && this.practiceOptions.freeScoring) this.context.ballOn = this.ref.sysReservedBallOn;
    this.nine?.reset(false);
    const cue = this.simulator.getBallAtIndex(0);
    if (this.nine && this.context.inHand > 0 && (!cue.active ||
        !this.canPlaceCueBall(cue.position.x, cue.position.y, cue.position.z))) this.nine.clock.beginPlacement();
    this.response();
  }

  advanceTime(seconds: number): "shot" | "frame" | null {
    const nine = this.nine;
    if (!nine || this.finished) return null;
    const expiry = nine.clock.advance(seconds);
    if (expiry === "shot") this.timeoutFoul();
    else if (expiry === "frame" && this.currentState !== GAME_STATE.SIMULATING) this.endNineHundredFrame();
    else return expiry;
    if (this.currentState !== GAME_STATE.SIMULATING) this.response();
    return expiry;
  }

  beginPlacement(playerIndex: number): boolean {
    if (!this.nine || this.state !== GAME_STATE.READY || this.finished || this.prepared ||
        playerIndex !== this.context.playerIndex || this.context.inHand === 0) return false;
    return this.nine.clock.beginPlacement();
  }

  confirmPlacement(playerIndex: number): boolean {
    if (!this.nine || this.state !== GAME_STATE.READY || this.finished || this.prepared ||
        playerIndex !== this.context.playerIndex || this.context.inHand === 0) return false;
    const cue = this.simulator.getBallAtIndex(0);
    if (!cue.active || !this.canPlaceCueBall(cue.position.x, cue.position.y, cue.position.z)) return false;
    return this.nine.clock.confirmPlacement();
  }

  canPlaceCueBall(x: number, y: number, z: number): boolean {
    if (this.nine) {
      return !this.finished && (this.nine.fullTable ? canPlaceOnTable(this.simulator, x, y, z)
        : this.ref.placeCueBallCheck(x, y, z, this.simulator));
    }
    if (this.mode === "practice" && this.practiceOptions.cuePlacement === "anywhere") {
      return !this.finished && canPlaceOnTable(this.simulator, x, y, z);
    }
    return this.ref.placeCueBallCheck(x, y, z, this.simulator);
  }

  placeCueBall(x: number, y: number, z: number): boolean {
    if (this.state !== GAME_STATE.READY || this.finished || this.prepared || this.context.inHand === 0) return false;
    if (!this.canPlaceCueBall(x, y, z)) return false;
    this.currentState = GAME_STATE.JUDGING;
    this.simulator.respotIndexXYZ(0, x, this.simulator.spotY, z);
    if (this.context.inHand > 1) this.context.inHand = 1;
    this.response();
    return true;
  }

  stroke(playerIndex: number, vars: StrokeVars): boolean {
    if (this.state !== GAME_STATE.READY || this.finished || playerIndex !== this.context.playerIndex) return false;
    if (!this.prepared && !this.prepareStroke(playerIndex, vars)) return false;
    if (this.nine && !this.nine.clock.strike()) { this.prepared = false; this.previousShot = null; return false; }
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
    if (this.nine && this.nine.clock.view.phase !== "aiming") return false;
    const nomination = this.getNomination(vars[3], vars[5]);
    if (nomination.required) {
      if (nomination.ballIndex === null) return false;
      if (this.freeBall) this.context.freeBallIndex = nomination.ballIndex;
      else this.context.nominatedBallIndex = nomination.ballIndex;
    }
    this.previousShot = { world: this.simulator.serialize(), ballOn: this.context.ballOn,
      inHand: this.context.inHand, playerIndex, scoreGap: this.mode === "practice" ? 0 : this.getScore(0) - this.getScore(1),
      points: availablePoints(this.simulator, this.context.ballOn),
      players: this.players.map(player => player.snapshot()) };
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

  restorePreviousShot(playerIndex: number): boolean {
    const shot = this.previousShot;
    if (!shot || this.prepared) return false;
    if (this.mode === "practice") {
      if (this.state !== GAME_STATE.READY || playerIndex !== this.context.playerIndex) return false;
    } else if (this.state !== GAME_STATE.DECIDING || this.pendingDecision?.kind !== "foul" ||
        !this.pendingDecision.canReplace || this.pendingDecision.playerIndex !== playerIndex) return false;
    this.simulator.restore(shot.world);
    this.context.ballOn = shot.ballOn;
    this.context.inHand = shot.inHand;
    this.context.playerIndex = shot.playerIndex;
    if (this.mode === "practice") {
      shot.players.forEach((snapshot, index) => this.players[index]?.restore(snapshot));
    }
    delete this.context.nominatedBallIndex;
    delete this.context.freeBallIndex;
    this.nominatedIndex = null;
    this.freeBall = false;
    this.pendingDecision = null;
    this.result.score = this.result.foulCode = 0;
    this.response();
    return true;
  }

  step(dt: number): void {
    if (this.state !== GAME_STATE.SIMULATING) return;
    this.simulator.step(dt);
    if (this.simulator.nAwakened !== 0) return;
    this.currentState = GAME_STATE.JUDGING;
    const index = this.context.playerIndex;
    this.context.nRounds++;
    if (this.mode === "practice" && this.practiceOptions.freeScoring) {
      this.resetShotState();
      settleFreePractice(this, this.practiceOptions, this.initialColourIndices, index);
      this.response();
      return;
    }
    this.ref.checkResult(this.context, this.simulator, this.result);
    this.resetShotState();
    if (this.nine) {
      this.settleNineHundred(index);
      this.response();
      return;
    }
    const player = this.players[index];
    if (this.mode === "practice" && this.practiceOptions.score === false) {
      player.brk = 0;
      this.context.playerIndex = (index + 1) % this.players.length;
    } else if (this.result.score > 0) {
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
      this.context.playerIndex = 1 - this.openingIndex;
      this.players.forEach(player => { player.brk = 0; });
    } else if (this.mode !== "practice" && !this.finished && this.result.foulCode !== 0) {
      const shot = this.previousShot;
      const canReplace = shot !== null && isMiss(this.result.foulCode, shot.scoreGap, shot.points,
        this.getScore(0) - this.getScore(1), availablePoints(this.simulator, this.context.ballOn));
      this.pendingDecision = { kind: "foul", playerIndex: this.context.playerIndex, canReplace };
    }
    if (this.mode === "practice" && this.practiceOptions.respotTargetBallNumber !== undefined) {
      const target = this.simulator.getBalls().find(ball => ball.number === this.practiceOptions.respotTargetBallNumber);
      if (target && !target.active) this.simulator.respotIndexDefault(target.index);
      if (this.practiceOptions.targetBallOn !== undefined) this.context.ballOn = this.practiceOptions.targetBallOn;
    }
    this.response();
    if (this.pendingDecision?.kind === "foul") {
      this.freeBall = this.context.inHand > 0 ? !hasOpenInHand(this.simulator, this.context.ballOn, this.ref.dArea)
        : snookerView(this.simulator, this.context.ballOn).snookered;
    }
  }

  private settleNineHundred(index: number): void {
    const nine = this.nine!;
    nine.clock.settle();
    if (nine.shootout) {
      nine.completeAttempt(nine.isDirectBluePot(this.simulator, this.result.foulCode), this.simulator, this.context);
      return;
    }
    if (settleTimedScore(this, nine, index)) this.endNineHundredFrame();
  }

  private timeoutFoul(): void {
    const nine = this.nine!;
    if (nine.shootout) { this.resetShotState(); nine.completeAttempt(false, this.simulator, this.context); return; }
    applyTimeoutFoul(this, nine);
    this.resetShotState();
    nine.clock.beginTurn(true);
  }

  private endNineHundredFrame(): void {
    const nine = this.nine!;
    nine.endFrame([this.getScore(0), this.getScore(1)], this.openingIndex, this.simulator, this.context);
    this.resetShotState();
  }

  private resetShotState(): void {
    this.prepared = false;
    this.freeBall = false;
    this.nominatedIndex = null;
    delete this.context.nominatedBallIndex;
    delete this.context.freeBallIndex;
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
