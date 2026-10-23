import * as B from "babylonjs/es6.js";
import type { CameraPoint } from "./camera-look.js";
import { CameraSpring } from "./camera-smoothing.js";
import { CameraTween } from "./camera-tween.js";

// PCOL L5489-5654
export class CameraHead {
  readonly position = new B.Vector3(0, 0, 0);
  readonly lookAtOffset = new B.Vector3(0, 0, 0);
  private readonly origin = new B.Vector3(0, 0, 0);
  private readonly transform = new Float32Array(16);
  private readonly angle = new CameraSpring(0.4, 0.25, 0.5, 0.001);
  private readonly distance = new CameraSpring(0.4, 0.25, 0.5, 0.001);
  private readonly gain = new CameraTween(0.5, value => value * value);
  private horizontal = 0;
  private vertical = 0;
  private localX = -0.38;
  private localY = 0.12;
  private localZ = 0;
  private dirty = 3;

  constructor(cue: CameraPoint) {
    this.angle.minimum = -0.7 * Math.PI; this.angle.maximum = 0.7 * Math.PI;
    this.distance.minimum = 0.3 * 0.38; this.distance.maximum = 1;
    this.distance.reset(0.38);
    this.gain.pause(this.gain.duration);
    this.resetCue(cue);
  }

  resetCue(point: CameraPoint): void {
    if (Math.abs(this.origin.x - point.x) <= 1e-6 && Math.abs(this.origin.y - point.y) <= 1e-6 && Math.abs(this.origin.z - point.z) <= 1e-6) return;
    this.origin.copyFromFloats(point.x, point.y, point.z); this.dirty |= 1;
  }

  move(dx: number, dy: number): void {
    this.angle.to(this.angle.target + 0.5 * dx);
    this.distance.to(this.distance.target + 0.5 * dy);
  }

  resetLook(instant = false): void {
    if (instant) {
      this.angle.reset(0); this.distance.reset(0.38); this.gain.pause(this.gain.duration);
    } else {
      this.angle.to(0); this.distance.to(0.38);
      const ratio = 1 - Math.abs(this.angle.current) / this.angle.maximum;
      this.gain.play(ratio * ratio * this.gain.duration);
    }
  }

  setAngles(horizontal: number, vertical: number): void {
    if (Math.abs(this.horizontal - horizontal) > 1e-5) { this.horizontal = horizontal; this.dirty |= 1; }
    if (Math.abs(this.vertical - vertical) > 1e-5) { this.vertical = vertical; this.dirty |= 3; }
  }

  get needsUpdate(): boolean { return this.dirty !== 0 || this.angle.dirty || this.distance.dirty; }

  update(): void {
    let dirty = this.dirty;
    this.dirty = 0;
    if (this.angle.dirty || this.distance.dirty) dirty |= 4;
    const m = this.transform;
    if (dirty & 1) {
      const ch = Math.cos(this.horizontal), sh = Math.sin(this.horizontal), cv = Math.cos(this.vertical), sv = Math.sin(this.vertical);
      m.set([ch * cv, sv, -cv * sh, 0, -ch * sv, cv, sv * sh, 0, sh, 0, ch, 0, this.origin.x, this.origin.y, this.origin.z, 1]);
    }
    if (dirty & 2) {
      let ratio = Math.max(0, Math.min(1, this.vertical / -0.9));
      this.localX = -0.38 - 0.3 * ratio; this.localY = 0.12; this.localZ = this.lookAtOffset.y = 0;
      if (ratio > 0.35) { ratio -= 0.35; this.localY -= 0.2 * ratio; this.localZ += 0.08 * ratio; this.lookAtOffset.y = 0.3 * ratio; }
    }
    if (dirty & 4) {
      if (this.gain.needsUpdate) {
        this.gain.update(0.016);
        this.angle.gain = this.distance.gain = 0.01 + 0.24 * this.gain.renderedRatio;
      }
      this.angle.update(); this.distance.update();
    }
    if (dirty & 3) this.position.copyFromFloats(
      this.localX * m[0] + this.localY * m[4] + this.localZ * m[8] + m[12],
      this.localX * m[1] + this.localY * m[5] + this.localZ * m[9] + m[13],
      this.localX * m[2] + this.localY * m[6] + this.localZ * m[10] + m[14]);
    if (dirty & 5) {
      const x = Math.cos(this.angle.current) * this.distance.current - 0.38;
      const z = Math.sin(this.angle.current) * this.distance.current;
      this.lookAtOffset.x = x * m[0] + z * m[8]; this.lookAtOffset.z = x * m[2] + z * m[10];
    }
  }
}
