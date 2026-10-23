import * as B from "babylonjs/es6.js";
import { CameraSpring, type CameraAzimuth } from "./camera-smoothing.js";
import { CameraTween } from "./camera-tween.js";

export type CameraPoint = Readonly<{ x: number; y: number; z: number }>;

// PCOL L4678-4778
export class CameraLook {
  private readonly axes = [new CameraSpring(0.5, 0.25, 0.5, 0.0003), new CameraSpring(0.5, 0.25, 0.5, 0.0003), new CameraSpring(0.5, 0.25, 0.5, 0.0003)];
  private readonly gain = new CameraTween(0.35, value => value);
  private following: (() => CameraPoint) | null = null;

  constructor() {
    this.axes[1].reset(0.88 + 0.02625 + 0.03);
    this.axes[0].minimum = -3.66 / 2; this.axes[0].maximum = 3.66 / 2;
    this.axes[2].minimum = -1.859 / 2; this.axes[2].maximum = 1.859 / 2;
    this.gain.pause(this.gain.duration);
  }

  get needsUpdate(): boolean { return this.following !== null || this.axes.some(axis => axis.dirty); }
  get isFollowing(): boolean { return this.following !== null; }

  follow(source: () => CameraPoint): void { this.following = source; this.gain.pause(0); }
  unfollow(): void { this.following = null; this.gain.play(); }

  move(dx: number, dz: number, azimuth: CameraAzimuth): void {
    if (this.following) this.unfollow();
    dz *= 1.5;
    this.axes[0].to(this.axes[0].target + dz * azimuth.forward.x + dx * azimuth.side.x);
    this.axes[2].to(this.axes[2].target + dz * azimuth.forward.z + dx * azimuth.side.z);
  }

  lookTo(x: number, z: number, instant = false): void {
    if (this.following) this.unfollow();
    if (instant) {
      this.axes[0].reset(x); this.axes[2].reset(z);
      this.gain.pause(this.gain.duration);
    } else {
      if (this.axes[0].target !== x && this.axes[2].target !== z) this.gain.play(0);
      this.axes[0].to(x); this.axes[2].to(z);
    }
  }

  update(dt: number, out: B.Vector3): boolean {
    let running = this.following !== null;
    if (this.following) {
      const point = this.following();
      this.axes[0].to(point.x); this.axes[2].to(point.z);
    }
    if (this.gain.needsUpdate) {
      this.gain.update(dt);
      for (const axis of this.axes) axis.gain = 0.05 + 0.21 * this.gain.renderedRatio;
    }
    for (const axis of this.axes) if (axis.dirty && axis.update()) running = true;
    out.copyFromFloats(this.axes[0].current, this.axes[1].current, this.axes[2].current);
    return running;
  }
}
