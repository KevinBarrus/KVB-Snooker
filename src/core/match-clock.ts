import { readClock } from "./timed-checkpoint.js";

export type ClockPhase = "placement" | "aiming" | "rolling" | "settling" | "frame-expired" | "shot-expired" | "finished";
export type ClockExpiry = "frame" | "shot";

export interface MatchClockView {
  readonly frameSeconds: number;
  readonly shotSeconds: number;
  readonly phase: ClockPhase;
  readonly shootout: boolean;
}

export class MatchClock {
  private frame = 900;
  private shot = 20;
  private currentPhase: ClockPhase = "placement";
  private deciding = false;

  get view(): MatchClockView {
    return { frameSeconds: this.frame, shotSeconds: this.shot, phase: this.currentPhase, shootout: this.deciding };
  }

  get untilExpiry(): number {
    if (this.currentPhase === "aiming" || this.currentPhase === "placement") return Math.min(this.shot, this.deciding ? Infinity : this.frame);
    if ((this.currentPhase === "rolling" || this.currentPhase === "settling") && !this.deciding) return this.frame;
    return Infinity;
  }

  restore(value: MatchClockView): void {
    const data = readClock(value);
    this.frame = data.frameSeconds;
    this.shot = data.shotSeconds;
    this.currentPhase = data.phase;
    this.deciding = data.shootout;
  }

  reset(): void {
    this.frame = 900;
    this.shot = 20;
    this.currentPhase = "placement";
    this.deciding = false;
  }

  beginTurn(placement: boolean): void {
    this.shot = 20;
    this.currentPhase = this.frame === 0 && !this.deciding ? "frame-expired" : placement ? "placement" : "aiming";
  }

  beginPlacement(): boolean {
    if (this.currentPhase === "placement") return true;
    if (this.currentPhase !== "aiming") return false;
    this.currentPhase = "placement";
    return true;
  }

  confirmPlacement(): boolean {
    if (this.currentPhase !== "placement") return false;
    this.currentPhase = "aiming";
    return true;
  }

  strike(): boolean {
    if (this.currentPhase !== "aiming" || this.shot <= 0 || (!this.deciding && this.frame <= 0)) return false;
    this.currentPhase = "rolling";
    return true;
  }

  settle(): void {
    if (this.currentPhase === "rolling") this.currentPhase = "settling";
  }

  startShootout(): void {
    this.deciding = true;
    this.frame = 0;
    this.beginTurn(true);
  }

  finish(): void { this.currentPhase = "finished"; }

  advance(seconds: number): ClockExpiry | null {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid clock interval");
    const elapsed = Math.min(seconds, this.untilExpiry);
    const aiming = this.currentPhase === "aiming" || this.currentPhase === "placement";
    if (!aiming && this.currentPhase !== "rolling" && this.currentPhase !== "settling") return null;
    if (!this.deciding) this.frame = Math.max(0, this.frame - elapsed);
    if (aiming) this.shot = Math.max(0, this.shot - elapsed);
    if (!this.deciding && this.frame === 0) {
      this.currentPhase = "frame-expired";
      return "frame";
    }
    if (aiming && this.shot === 0) {
      this.currentPhase = "shot-expired";
      return "shot";
    }
    return null;
  }
}
