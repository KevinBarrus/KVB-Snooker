export type MatchPlayer = 0 | 1;
export const MATCH_LENGTHS: readonly number[] = [1, 3, 5, 7, 9, 11, 17, 19, 25, 33, 35];

export interface FrameResult {
  readonly frameId: string;
  readonly attemptId: string;
  readonly frameNumber: number;
  readonly openingPlayer: MatchPlayer;
  readonly winner: MatchPlayer;
  readonly scores: readonly number[];
  readonly reason: "played" | "conceded";
  readonly shotCount: number;
}

export interface MatchResult {
  readonly resultId: string;
  readonly matchId: string;
  readonly winner: MatchPlayer;
  readonly frameWins: readonly number[];
}

export interface MatchProgressView {
  readonly matchId: string;
  readonly bestOf: number;
  readonly firstOpeningPlayer: MatchPlayer;
  readonly frameNumber: number;
  readonly frameId: string;
  readonly attemptNumber: number;
  readonly attemptId: string;
  readonly openingPlayer: MatchPlayer;
  readonly frameWins: readonly number[];
  readonly phase: "active" | "between-frames" | "finished";
  readonly ready: readonly boolean[];
  readonly shotCount: number;
  readonly lastShotId: string | null;
  readonly frames: readonly FrameResult[];
  readonly result: MatchResult | null;
}

export interface MatchOptions {
  readonly matchId: string;
  readonly bestOf: number;
  readonly firstOpeningPlayer: MatchPlayer;
}

export class MatchProgress {
  private readonly options: MatchOptions;
  private frameNumber = 1;
  private attemptNumber = 1;
  private readonly wins = [0, 0];
  private readonly ready = [false, false];
  private readonly frames: FrameResult[] = [];
  private phase: MatchProgressView["phase"] = "active";
  private result: MatchResult | null = null;
  private shotSequence = 0;
  private shotCount = 0;
  private reservedShotId: string | null = null;
  private lastShotId: string | null = null;

  constructor(options: MatchOptions) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.matchId) || !MATCH_LENGTHS.includes(options.bestOf) ||
        ![0, 1].includes(options.firstOpeningPlayer)) throw new Error("Invalid match options");
    this.options = { ...options };
  }

  private get frameId(): string { return `${this.options.matchId}/frame-${this.frameNumber}`; }
  private get attemptId(): string { return `${this.frameId}/attempt-${this.attemptNumber}`; }
  private get openingPlayer(): MatchPlayer {
    return ((this.options.firstOpeningPlayer + this.frameNumber - 1) % 2) as MatchPlayer;
  }

  get view(): MatchProgressView {
    return {
      ...this.options, frameNumber: this.frameNumber, frameId: this.frameId,
      attemptNumber: this.attemptNumber, attemptId: this.attemptId, openingPlayer: this.openingPlayer,
      frameWins: [...this.wins], phase: this.phase, ready: [...this.ready],
      shotCount: this.shotCount, lastShotId: this.lastShotId,
      frames: this.frames.map(frame => ({ ...frame, scores: [...frame.scores] })),
      result: this.result && { ...this.result, frameWins: [...this.result.frameWins] }
    };
  }

  reserveShotId(): string | null {
    if (this.phase !== "active") return null;
    this.reservedShotId = `${this.attemptId}/shot-${++this.shotSequence}`;
    return this.reservedShotId;
  }

  recordStrike(shotId: string): boolean {
    if (this.phase !== "active" || shotId !== this.reservedShotId) return false;
    this.reservedShotId = null;
    this.lastShotId = shotId;
    this.shotCount++;
    return true;
  }

  finishFrame(winner: MatchPlayer, scores: readonly number[], reason: FrameResult["reason"]): FrameResult | null {
    if (this.phase !== "active" || ![0, 1].includes(winner) || scores.length !== 2 ||
        scores.some(score => !Number.isSafeInteger(score) || score < 0) ||
        (reason !== "played" && reason !== "conceded")) return null;
    const frame: FrameResult = { frameId: this.frameId, attemptId: this.attemptId,
      frameNumber: this.frameNumber, openingPlayer: this.openingPlayer,
      winner, scores: [...scores], reason, shotCount: this.shotCount };
    this.frames.push(frame);
    this.wins[winner]++;
    this.reservedShotId = null;
    this.ready.fill(false);
    this.phase = this.wins[winner] >= (this.options.bestOf + 1) / 2 ? "finished" : "between-frames";
    if (this.phase === "finished") this.result = { resultId: `${this.options.matchId}/result`,
      matchId: this.options.matchId, winner, frameWins: [...this.wins] };
    return { ...frame, scores: [...frame.scores] };
  }

  readyNextFrame(player: MatchPlayer): boolean {
    if (this.phase !== "between-frames" || ![0, 1].includes(player) || this.ready[player]) return false;
    this.ready[player] = true;
    if (this.ready.every(Boolean)) {
      this.frameNumber++;
      this.attemptNumber = 1;
      this.phase = "active";
      this.resetAttempt();
    }
    return true;
  }

  clearReady(player: MatchPlayer): void { if ([0, 1].includes(player)) this.ready[player] = false; }

  rerack(): boolean {
    if (this.phase !== "active") return false;
    this.attemptNumber++;
    this.resetAttempt();
    return true;
  }

  private resetAttempt(): void {
    this.ready.fill(false);
    this.shotSequence = this.shotCount = 0;
    this.reservedShotId = this.lastShotId = null;
  }
}
