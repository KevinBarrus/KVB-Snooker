import * as B from "babylonjs/es6.js";
import type { EventBus } from "../core/event-bus.js";
import { CameraHead } from "./camera-head.js";
import { CameraLook, type CameraPoint } from "./camera-look.js";
import { CameraOrbit } from "./camera-orbit.js";
import { CameraAzimuth } from "./camera-smoothing.js";
import { CameraTween } from "./camera-tween.js";

// PCOL L5656-5901, L7660-7667
export class CameraRig {
  readonly bodyPosition = new B.Vector3(0, 0, 0);
  readonly lockedTarget = new B.Vector3(0, 0, 0);
  readonly position = new B.Vector3(0, 0, 0);
  readonly target = new B.Vector3(0, 0, 0);
  readonly azimuth = new CameraAzimuth();
  private readonly transition = new CameraTween(1.2);
  private readonly squat = new CameraTween(0.6);
  private readonly horizon: CameraOrbit;
  private readonly look = new CameraLook();
  private readonly head: CameraHead;
  private stateValue: 0 | 1 = 0;
  private changeFrom = 0;
  private dirty = 14;

  constructor(private readonly bus: EventBus, cue: CameraPoint, initialAngle = Math.PI) {
    this.horizon = new CameraOrbit(initialAngle);
    this.horizon.resetCenter(cue.x, cue.z);
    this.head = new CameraHead(cue);
    this.update(0); this.updateHead(0, 0);
  }

  get state(): 0 | 1 { return this.stateValue; }
  get stateRatio(): number { return this.transition.ratio; }
  get renderedRatio(): number { return this.transition.renderedRatio; }
  get needsUpdate(): boolean { return this.dirty !== 0 || this.head.needsUpdate; }
  get isFollowing(): boolean { return this.look.isFollowing; }

  setState(state: 0 | 1, instant = false): void {
    if (this.stateValue !== state) {
      const from = this.stateValue;
      this.stateValue = state;
      if (!this.transition.needsUpdate) {
        this.changeFrom = from;
        this.bus.emit("ctrl/state-change-start", { from, to: state });
      }
      if (instant) this.transition.pause(state * this.transition.duration);
      else if (state === 1) this.transition.play();
      else this.transition.reverse();
      if (state === 1) {
        this.lookTo(this.horizon.center.x, this.horizon.center.y, instant);
        this.head.resetLook(instant);
      }
    } else if (instant && (this.transition.state !== 0 || this.transition.time !== state * this.transition.duration)) {
      this.transition.pause(state * this.transition.duration);
      if (state === 1) {
        this.lookTo(this.horizon.center.x, this.horizon.center.y, true);
        this.head.resetLook(true);
      }
    }
    if (this.transition.needsUpdate) this.dirty |= 1;
  }

  resetCue(point: CameraPoint): void {
    this.horizon.resetCenter(point.x, point.z); this.head.resetCue(point); this.dirty |= 2;
  }

  resetWithKissDir(dx: number, dz: number): void {
    this.horizon.resetWithKissDir(dx, dz, this.bodyPosition, this.renderedRatio); this.dirty |= 2;
  }

  orbit(left?: number, right?: number): void { this.horizon.orbit(left, right); this.dirty |= 2; }
  squatDown(): void { this.squat.play(); if (this.squat.needsUpdate) this.dirty |= 4; }
  standUp(): void { this.squat.reverse(); if (this.squat.needsUpdate) this.dirty |= 4; }

  moveLookAt(dx: number, dy: number): void {
    if (this.state === 1) this.head.move(dx, dy);
    else { this.look.move(dx, dy, this.azimuth); if (this.look.needsUpdate) this.dirty |= 8; }
  }

  resetLookAt(): void {
    if (this.state === 1) this.head.resetLook();
    else this.lookTo(0, 0);
  }

  lookTo(x: number, z: number, instant = false): void {
    this.look.lookTo(x, z, instant); if (this.look.needsUpdate) this.dirty |= 8;
  }

  follow(source: () => CameraPoint): void { this.look.follow(source); this.dirty |= 8; }
  unfollow(): void { this.look.unfollow(); }

  update(dt: number): boolean {
    let flags = this.dirty;
    this.dirty = 0;
    const changed = (flags & 15) !== 0;
    if (flags & 1) {
      flags |= 6;
      if (!this.transition.update(dt)) {
        flags &= ~1;
        this.bus.emit("ctrl/state-change-end", { from: this.changeFrom, to: this.state });
      }
    }
    let directionChanged = false;
    if (flags & 2) {
      if (!this.horizon.update(this.state, this.transition, this.bodyPosition)) flags &= ~2;
      directionChanged = true;
    }
    if (flags & 4) {
      const running = this.squat.needsUpdate && this.squat.update(dt);
      this.bodyPosition.y = 1.7 - (1 - this.renderedRatio) * this.squat.renderedRatio * 0.7;
      if (!running) flags &= ~4;
    }
    if (flags & 8) {
      if (!this.look.update(dt, this.lockedTarget)) flags &= ~8;
      directionChanged = true;
    }
    if (directionChanged) this.azimuth.setSlope(this.lockedTarget.x - this.bodyPosition.x, this.lockedTarget.z - this.bodyPosition.z);
    this.dirty |= flags;
    return changed;
  }

  updateHead(horizontal: number, vertical: number): void {
    this.head.setAngles(horizontal, vertical);
    if (this.head.needsUpdate) this.head.update();
    B.Vector3.LerpToRef(this.bodyPosition, this.head.position, this.renderedRatio, this.position);
    this.target.copyFromFloats(this.lockedTarget.x + this.head.lookAtOffset.x * this.renderedRatio,
      this.lockedTarget.y + this.head.lookAtOffset.y * this.renderedRatio,
      this.lockedTarget.z + this.head.lookAtOffset.z * this.renderedRatio);
  }
}
