import { readNineHundred, type NineHundredCheckpoint } from "./timed-checkpoint.js";
import { MatchClock } from "./match-clock.js";
import type { CushionEvidence } from "./simulator/contact-evidence.js";

export interface TimedContext { ballOn: number; inHand: 0 | 1 | 2; playerIndex: number }
export interface ShootoutView { readonly attempts: readonly number[]; readonly potted: readonly number[] }

/** 决胜只读消费面；Simulator 结构化满足（受限引用不暴露可变 Body）。 */
export interface ShootoutBall {
  readonly index: number;
  readonly number: number;
  readonly active: boolean;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export interface ShootoutSimulator {
  getBalls(): readonly ShootoutBall[];
  getResult(): { readonly pottedIndices: readonly number[] };
  getCushionEvidence(): CushionEvidence | null;
  respotIndexDefault(index: number): void;
  resetBallPosition(ball: ShootoutBall, spot: null): void;
}

export class NineHundredMatch {
  readonly clock = new MatchClock();
  fullTable = false;
  finished = false;
  winner: number | null = null;
  private attempts: number[] | null = null;
  private potted = [0, 0];

  get shootout(): ShootoutView | null {
    return this.attempts && { attempts: [...this.attempts], potted: [...this.potted] };
  }

  exportCheckpoint(): NineHundredCheckpoint {
    return readNineHundred({ clock: this.clock.view, fullTable: this.fullTable, finished: this.finished,
      winner: this.winner, shootout: this.shootout });
  }

  restoreCheckpoint(value: NineHundredCheckpoint): void {
    const data = readNineHundred(value);
    this.clock.restore(data.clock);
    this.fullTable = data.fullTable;
    this.finished = data.finished;
    this.winner = data.winner;
    this.attempts = data.shootout ? [...data.shootout.attempts] : null;
    this.potted = data.shootout ? [...data.shootout.potted] : [0, 0];
  }

  reset(placement: boolean): void {
    this.clock.reset(); this.clock.beginTurn(placement);
    this.fullTable = false; this.finished = false; this.winner = null;
    this.attempts = null; this.potted = [0, 0];
  }

  endFrame(scores: readonly number[], opening: number, sim: ShootoutSimulator, ctx: TimedContext): void {
    if (scores[0] !== scores[1]) {
      this.win(scores[0] > scores[1] ? 0 : 1, ctx);
      return;
    }
    this.attempts = [0, 0]; this.potted = [0, 0]; this.fullTable = false;
    ctx.playerIndex = 1 - opening;
    this.clock.startShootout();
    this.setupBlue(sim, ctx);
  }

  completeAttempt(success: boolean, sim: ShootoutSimulator, ctx: TimedContext): void {
    if (!this.attempts) throw new Error("No blue shootout");
    const index = ctx.playerIndex;
    this.attempts[index]++;
    if (success) this.potted[index]++;
    if (this.attempts[0] === this.attempts[1] && this.potted[0] !== this.potted[1]) {
      this.win(this.potted[0] > this.potted[1] ? 0 : 1, ctx);
      return;
    }
    ctx.playerIndex = 1 - index;
    this.setupBlue(sim, ctx);
    this.clock.beginTurn(true);
  }

  isDirectBluePot(sim: ShootoutSimulator, foulCode: number): boolean {
    const blue = sim.getBalls().find(ball => ball.number === 5);
    if (!blue || foulCode || !sim.getResult().pottedIndices.includes(blue.index)) return false;
    return !(sim.getCushionEvidence()?.contacts ?? []).some(contact => contact.ballIndex === blue.index &&
      (contact.kind === "cushion" || Math.hypot(contact.x - blue.position.x, contact.z - blue.position.z) > .25));
  }

  private setupBlue(sim: ShootoutSimulator, ctx: TimedContext): void {
    const blue = sim.getBalls().find(ball => ball.number === 5);
    if (!blue) throw new Error("Missing blue for shootout");
    for (const ball of sim.getBalls()) {
      if (ball.index === 0 || ball.index === blue.index) sim.respotIndexDefault(ball.index);
      else if (ball.active) sim.resetBallPosition(ball, null);
    }
    ctx.ballOn = 32; ctx.inHand = 2;
  }

  private win(index: number, ctx: TimedContext): void {
    this.winner = index; this.finished = true;
    ctx.ballOn = 0; ctx.inHand = 0;
    this.clock.finish();
  }
}
