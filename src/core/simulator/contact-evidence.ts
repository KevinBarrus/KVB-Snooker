import { Solver } from "../physics/solver.js";
import type { ContactBase } from "../physics/contact.js";
import type { Ball } from "./ball.js";

export interface ContactEvidence {
  readonly touchingIndices: readonly number[];
  readonly firstContactIndices: readonly number[];
  readonly pushedIndices: readonly number[];
}

export class ContactRecorder extends Solver {
  private balls: readonly Ball[] = [];
  private touching: number[] = [];
  private held = new Set<number>();
  private first: number[] = [];
  private pushed = new Set<number>();
  private firstPoint: { x: number; y: number; z: number; evolution: number } | null = null;

  constructor(private readonly evolution: () => number) { super(); }

  begin(balls: readonly Ball[]): void {
    this.clear(); this.balls = balls;
    const cue = balls[0];
    this.touching = balls.filter(ball => ball.index !== 0 && ball.active &&
      ball.position.distanceTo(cue.position) <= ball.radius + cue.radius + 1e-5).map(ball => ball.index);
    this.held = new Set(this.touching);
  }

  clear(): void {
    this.balls = []; this.touching = []; this.held.clear(); this.first = []; this.pushed.clear(); this.firstPoint = null;
  }

  snapshot(): ContactEvidence | null {
    return this.balls.length ? { touchingIndices: [...this.touching], firstContactIndices: [...this.first], pushedIndices: [...this.pushed] } : null;
  }

  checkSeparation(): void {
    const cue = this.balls[0];
    if (!cue) return;
    for (const index of this.held) {
      const ball = this.balls[index];
      if (!ball.active || !cue.active || ball.position.distanceTo(cue.position) > ball.radius + cue.radius + 1e-5) this.held.delete(index);
    }
  }

  override solveContact(contact: ContactBase): void {
    this.checkSeparation();
    const cue = this.balls[0];
    const target = contact.isSS && cue ? (contact.bi === cue ? contact.bj : contact.bj === cue ? contact.bi : null) as Ball | null : null;
    const vx = target?.v.x ?? 0, vz = target?.v.z ?? 0;
    const toward = target && cue ? cue.v.x * (target.position.x - cue.position.x) + cue.v.z * (target.position.z - cue.position.z) : 0;
    super.solveContact(contact);
    if (target && Math.hypot(target.v.x - vx, target.v.z - vz) > 1e-7) {
      if (this.held.has(target.index) && toward > 1e-7) this.pushed.add(target.index);
      if (!this.firstPoint) this.firstPoint = { ...cue.position, evolution: this.evolution() };
      const point = this.firstPoint;
      if (point.evolution === this.evolution() && Math.hypot(cue.position.x - point.x, cue.position.y - point.y, cue.position.z - point.z) <= 1e-5 && !this.first.includes(target.index)) {
        this.first.push(target.index);
      }
    } else if (contact.isSS && cue && contact.bi !== cue && contact.bj !== cue) {
      this.held.delete((contact.bi as Ball).index);
      this.held.delete((contact.bj as Ball).index);
    }
  }
}
