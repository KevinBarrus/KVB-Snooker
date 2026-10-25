import * as B from "babylonjs/es6.js";
import type { CameraPoint } from "./camera-look.js";
import type { Simulator } from "../core/simulator/simulator.js";
import { FocusSmoothing } from "./focus-smoothing.js";

export type ShotViewMode = "natural" | "cue" | "object";
export const isShotViewMode = (value: unknown): value is ShotViewMode => value === "natural" || value === "cue" || value === "object";

export class ShotView {
  readonly target = B.Vector3.Zero();
  private readonly anchor = B.Vector3.Zero();
  readonly smoothing = new FocusSmoothing();
  mode: ShotViewMode = "natural";
  struck = false;
  private objectIndex = 0;
  private focus: CameraPoint | null = null;
  private lost = false;
  private switching = false;
  active = false;
  manual = false;

  begin(target: CameraPoint): void {
    this.anchor.copyFromFloats(target.x, target.y, target.z);
    this.target.copyFrom(this.anchor);
    this.active = true;
    this.manual = false;
    this.struck = false;
    this.objectIndex = 0;
    this.focus = null; this.lost = false; this.smoothing.reset();
    this.switching = false;
  }

  end(): void { this.active = false; this.manual = false; }
  takeManual(): void { if (this.active) this.manual = true; }

  setMode(mode: ShotViewMode, current: CameraPoint): void {
    this.mode = mode;
    this.manual = false;
    this.target.copyFromFloats(current.x, current.y, current.z);
    this.focus = null; this.lost = false; this.smoothing.reset();
    this.switching = this.active;
  }

  track(source: Pick<Simulator, "getBallCount" | "getBallView" | "getResult">): void {
    if (!this.active || !this.struck || this.manual || this.mode === "natural" || this.lost) return;
    if (this.mode === "object" && this.objectIndex === 0) this.objectIndex = source.getResult().firstKissIndex;
    const index = this.mode === "cue" ? 0 : this.objectIndex;
    if (index < 0 || index >= source.getBallCount() || this.mode === "object" && index === 0) return;
    const ball = source.getBallView(index);
    if (!ball.active || ball.position.y < .88 || Math.abs(ball.position.x) > 1.9 || Math.abs(ball.position.z) > 1) {
      this.lost = true;
      return;
    }
    this.focus = { x: ball.renderPosition.x, y: .93625, z: ball.renderPosition.z };
  }

  update(dt: number, aimRatio: number, eye?: CameraPoint): void {
    if (!this.active || this.manual || dt <= 0) return;
    if (this.mode !== "natural" && this.focus && eye) {
      this.smoothing.update(this.target, this.focus, eye, dt);
      return;
    }
    if (this.switching && eye) {
      this.smoothing.update(this.target, { x: this.anchor.x * aimRatio,
        y: .93625 + (this.anchor.y - .93625) * aimRatio, z: this.anchor.z * aimRatio }, eye, dt);
      return;
    }
    const blend = 1 - Math.exp(-3 * dt);
    this.target.x += (this.anchor.x * aimRatio - this.target.x) * blend;
    this.target.y += (.93625 + (this.anchor.y - .93625) * aimRatio - this.target.y) * blend;
    this.target.z += (this.anchor.z * aimRatio - this.target.z) * blend;
  }
}
