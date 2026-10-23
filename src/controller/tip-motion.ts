import * as B from "babylonjs/es6.js";
import type { StickController } from "./stick-controller.js";
import { sphereRayDistance, type Point3 } from "./stick-obstacles.js";

// PCOL L6006-6113
export class TipMotion {
  readonly maxPullbackLen = 0.25;
  readonly gap = -0.015;
  length = this.gap;
  pullbackProgress = 0;
  needsUpdate = false;
  private elapsed = 0;
  private duration = 0;
  private pullbackDistance = 0;
  private pullbackDuration = 0;
  private forwardDuration = 0;
  private forwardAcceleration = 0;
  private followDuration = 0;
  private followDistance = 0;
  private tipRadius = 0;
  private readonly direction = B.Vector3.Zero();
  private readonly contact = B.Vector3.Zero();

  reset(): void {
    this.needsUpdate = false;
    this.length = this.gap;
    this.pullbackProgress = 0;
  }

  isReady(): boolean { return !this.needsUpdate && this.pullbackProgress === 0; }

  launch(stick: StickController, power: number): number {
    const speed = stick.getTouchSpdWithPower(power);
    const slowDownDistance = stick.getSlowDownDistance(power, this.maxPullbackLen);
    this.tipRadius = stick.getTipRadius();
    this.direction.copyFrom(stick.kissDir);
    this.contact.copyFrom(stick.kissPoint);
    const easeOut = 2 * power - power * power;
    this.pullbackDistance = easeOut * this.maxPullbackLen;
    this.pullbackDuration = 0.3 + 0.3 * easeOut;
    this.forwardDuration = 2 * (this.pullbackDistance - this.gap) / speed;
    this.forwardAcceleration = speed / this.forwardDuration;
    const followSpeed = 0.92 * speed;
    const followAcceleration = 0.5 * followSpeed * followSpeed / slowDownDistance;
    this.followDuration = followSpeed / followAcceleration;
    this.followDistance = slowDownDistance;
    this.elapsed = 0;
    this.duration = this.pullbackDuration + this.forwardDuration + this.followDuration;
    this.needsUpdate = true;
    return this.pullbackDuration + this.forwardDuration;
  }

  tick(dt: number): number {
    const previous = this.elapsed;
    dt = Math.min(dt, 0.02);
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.elapsed = this.duration;
      this.needsUpdate = false;
      return this.duration - previous;
    }
    return dt;
  }

  rewind(dt: number): void { this.elapsed -= dt; }

  updateLength(cue: Point3, radius: number): void {
    let time = this.elapsed;
    if (time <= this.pullbackDuration) {
      const progress = this.pullbackProgress = time / this.pullbackDuration;
      const eased = progress < 0.5 ? 8 * progress ** 4 : 1 - 8 * (1 - progress) ** 4;
      this.length = this.gap - eased * this.pullbackDistance;
      return;
    }
    this.pullbackProgress = 1;
    time -= this.pullbackDuration;
    if (time < this.forwardDuration) {
      this.length = this.gap - this.pullbackDistance + this.forwardAcceleration * time * time * 0.5;
      return;
    }
    const progress = (time - this.forwardDuration) / this.followDuration;
    const distance = (1 - (1 - progress) ** 3) * this.followDistance;
    const offset = new B.Vector3(this.contact.x - cue.x, this.contact.y - cue.y, this.contact.z - cue.z);
    this.length = Math.min(distance, sphereRayDistance(this.direction, offset, (radius + this.tipRadius) ** 2));
  }
}
