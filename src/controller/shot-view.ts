import * as B from "babylonjs/es6.js";
import type { CameraPoint } from "./camera-look.js";

export class ShotView {
  readonly target = B.Vector3.Zero();
  private readonly anchor = B.Vector3.Zero();
  active = false;
  manual = false;

  begin(target: CameraPoint): void {
    this.anchor.copyFromFloats(target.x, target.y, target.z);
    this.target.copyFrom(this.anchor);
    this.active = true;
    this.manual = false;
  }

  end(): void { this.active = false; this.manual = false; }
  takeManual(): void { if (this.active) this.manual = true; }

  update(dt: number, aimRatio: number): void {
    if (!this.active || this.manual || dt <= 0) return;
    const blend = 1 - Math.exp(-3 * dt);
    this.target.x += (this.anchor.x * aimRatio - this.target.x) * blend;
    this.target.y += (.93625 + (this.anchor.y - .93625) * aimRatio - this.target.y) * blend;
    this.target.z += (this.anchor.z * aimRatio - this.target.z) * blend;
  }
}
