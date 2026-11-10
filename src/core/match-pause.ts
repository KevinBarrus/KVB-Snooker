import { choice, finite, flag, integer, list, record, requireCheckpoint } from "./checkpoint-validation.js";

export interface PausePolicy {
  readonly players: number;
  readonly maxPerPlayer: number | null;
  readonly maxSeconds: number | null;
  readonly countdownSeconds: number;
}

export interface PauseView {
  readonly phase: "running" | "requested" | "waiting" | "paused" | "resuming";
  readonly requester: number | null;
  readonly used: readonly number[];
  readonly ready: readonly boolean[];
  readonly remainingSeconds: number | null;
  readonly countdownSeconds: number;
}

export interface PauseCheckpoint {
  readonly format: 1;
  readonly policy: PausePolicy;
  readonly view: PauseView;
}

export function readPauseCheckpoint(value: unknown): PauseCheckpoint {
  const data = record(value), p = record(data.policy), v = record(data.view);
  requireCheckpoint(data.format === 1);
  const policy: PausePolicy = {
    players: integer(p.players, 1, 2),
    maxPerPlayer: p.maxPerPlayer === null ? null : integer(p.maxPerPlayer, 1),
    maxSeconds: p.maxSeconds === null ? null : finite(p.maxSeconds, Number.MIN_VALUE),
    countdownSeconds: finite(p.countdownSeconds, 0)
  };
  const view: PauseView = {
    phase: choice(v.phase, ["running", "requested", "waiting", "paused", "resuming"]),
    requester: v.requester === null ? null : integer(v.requester, 0, policy.players - 1),
    used: list(v.used, n => integer(n, 0, policy.maxPerPlayer ?? Number.MAX_SAFE_INTEGER), policy.players, policy.players),
    ready: list(v.ready, flag, policy.players, policy.players),
    remainingSeconds: v.remainingSeconds === null ? null : finite(v.remainingSeconds, 0, policy.maxSeconds ?? Infinity),
    countdownSeconds: finite(v.countdownSeconds, 0, policy.countdownSeconds)
  };
  const stopped = view.phase === "paused" || view.phase === "resuming";
  requireCheckpoint((view.phase === "running") === (view.requester === null));
  requireCheckpoint(stopped || (view.remainingSeconds === null && !view.ready.some(Boolean)));
  requireCheckpoint(view.phase === "resuming" || view.countdownSeconds === 0);
  requireCheckpoint(!stopped || ((policy.maxSeconds === null) === (view.remainingSeconds === null) && view.used[view.requester!] > 0));
  return { format: 1, policy, view };
}

export class MatchPause {
  readonly policy: PausePolicy;
  private state: PauseView;

  constructor(policy: PausePolicy) {
    const data = readPauseCheckpoint({ format: 1, policy, view: { phase: "running", requester: null,
      used: Array.from({ length: policy.players }, () => 0), ready: Array.from({ length: policy.players }, () => false),
      remainingSeconds: null, countdownSeconds: 0 } });
    this.policy = data.policy;
    this.state = data.view;
  }

  get view(): PauseView { return { ...this.state, used: [...this.state.used], ready: [...this.state.ready] }; }
  get blocksPlay(): boolean { return this.state.phase === "paused" || this.state.phase === "resuming"; }

  request(player: number): boolean {
    if (!this.validPlayer(player) || this.state.phase !== "running" ||
        (this.policy.maxPerPlayer !== null && this.state.used[player] >= this.policy.maxPerPlayer)) return false;
    this.state = { ...this.state, phase: this.policy.players === 1 ? "waiting" : "requested", requester: player };
    return true;
  }

  respond(player: number, accepted: boolean): boolean {
    if (!this.validPlayer(player) || this.state.phase !== "requested" || this.state.requester === player) return false;
    if (accepted) this.state = { ...this.state, phase: "waiting" };
    else this.continuePlaying();
    return true;
  }

  cancel(player: number): boolean {
    if (this.state.phase !== "requested" || this.state.requester !== player) return false;
    this.continuePlaying();
    return true;
  }

  ready(player: number): boolean {
    if (!this.validPlayer(player) || this.state.phase !== "paused" || this.state.ready[player]) return false;
    const ready = this.state.ready.map((value, index) => value || index === player);
    this.state = { ...this.state, ready };
    if (ready.every(Boolean)) this.beginCountdown();
    return true;
  }

  disconnect(player: number): boolean {
    if (!this.validPlayer(player)) return false;
    if (this.state.phase === "requested" || this.state.phase === "waiting") {
      this.continuePlaying();
      return true;
    }
    if (!this.state.ready[player]) return false;
    this.state = { ...this.state, ready: this.state.ready.map((value, index) => index === player ? false : value) };
    return true;
  }

  advance(seconds: number, stable: boolean, finished: boolean): number {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid pause elapsed time");
    if (finished) { this.continuePlaying(); return seconds; }
    if (this.state.phase === "waiting" && stable) {
      this.state = { ...this.state, phase: "paused", remainingSeconds: this.policy.maxSeconds,
        used: this.state.used.map((used, index) => used + (index === this.state.requester ? 1 : 0)) };
    }
    if (this.state.phase === "paused") {
      if (this.state.remainingSeconds === null) return 0;
      const elapsed = Math.min(seconds, this.state.remainingSeconds);
      this.state = { ...this.state, remainingSeconds: this.state.remainingSeconds - elapsed };
      seconds -= elapsed;
      if ((this.state.remainingSeconds ?? 0) > 0) return 0;
      this.beginCountdown();
    }
    if (this.state.phase === "resuming") {
      const elapsed = Math.min(seconds, this.state.countdownSeconds);
      this.state = { ...this.state, countdownSeconds: this.state.countdownSeconds - elapsed };
      seconds -= elapsed;
      if (this.state.countdownSeconds > 0) return 0;
      this.continuePlaying();
    }
    return seconds;
  }

  resetFrame(): void {
    this.continuePlaying();
    this.state = { ...this.state, used: this.state.used.map(() => 0) };
  }

  exportCheckpoint(): PauseCheckpoint { return { format: 1, policy: { ...this.policy }, view: this.view }; }

  restoreCheckpoint(value: unknown): void {
    const data = readPauseCheckpoint(value);
    if (JSON.stringify(data.policy) !== JSON.stringify(this.policy)) throw new Error("Incompatible pause policy");
    this.state = { ...data.view, ready: data.view.ready.map(() => false) };
    if (this.state.phase === "resuming") this.state = { ...this.state, phase: "paused", countdownSeconds: 0 };
  }

  private validPlayer(player: number): boolean { return Number.isInteger(player) && player >= 0 && player < this.policy.players; }
  private beginCountdown(): void { this.state = { ...this.state, phase: "resuming", countdownSeconds: this.policy.countdownSeconds }; }
  private continuePlaying(): void {
    this.state = { ...this.state, phase: "running", requester: null, ready: this.state.ready.map(() => false),
      remainingSeconds: null, countdownSeconds: 0 };
  }
}
