import * as B from "babylonjs/es6.js";
import type { CameraTween } from "./camera-tween.js";

// PCOL L2396-2480, L4466-4642
export class CameraOrbit {
  readonly center = new B.Vector2(0, 0);
  private readonly angles: number[];
  private readonly start = new B.Vector2(0, 0);
  private readonly change = new B.Vector2(0, 0);
  private active = 0;
  private controlsDirty = true;
  private left = 0;
  private right = 0;
  private speed = 0;
  private targetSpeed = 0;
  private speedDirty = false;
  private angularSpeed = 0;

  constructor(initialAngle: number) { this.angles = [initialAngle, 0]; }

  resetCenter(x: number, z: number): void {
    this.center.set(x, z);
    this.controlsDirty = true;
  }

  orbit(left?: number, right?: number): void {
    if (left !== undefined) this.left = left ? 1 : 0;
    if (right !== undefined) this.right = right ? 1 : 0;
    const target = 0.0018 * (this.right - this.left);
    if (target !== this.targetSpeed) { this.targetSpeed = target; this.speedDirty = true; }
  }

  private cross(x: number, z: number): B.Vector2 | null {
    const cx = this.center.x, cz = this.center.y;
    const dx = x - cx, dz = z - cz;
    if (dx === 0 && dz === 0) throw new Error("GEO2D.Line.resetWithXYXY: same points");
    const slope = dx === 0 ? Infinity : dz / dx;
    const intercept = Number.isFinite(slope) ? cz - slope * cx : cx;
    const a = 2.05 * 1.55, b = 2.05, aa = a * a, bb = b * b;
    const points: B.Vector2[] = [];
    if (Math.abs(slope) < 1e-6) {
      const square = intercept * intercept;
      if (square <= bb + 1e-6) {
        if (square > bb - 1e-6) points.push(new B.Vector2(0, intercept));
        else { const offset = a * Math.sqrt(1 - square / bb); points.push(new B.Vector2(offset, intercept), new B.Vector2(-offset, intercept)); }
      }
    } else if (Number.isFinite(slope)) {
      const denominator = bb + aa * slope * slope;
      const linear = slope * aa * intercept;
      const discriminant = linear * linear - denominator * (aa * intercept * intercept - aa * bb);
      if (discriminant > 1e-6) {
        for (const sign of [1, -1]) { const px = (-linear + sign * Math.sqrt(discriminant)) / denominator; points.push(new B.Vector2(px, slope * px + intercept)); }
      } else if (discriminant > -1e-6) { const px = -linear / denominator; points.push(new B.Vector2(px, slope * px + intercept)); }
    } else {
      const square = intercept * intercept;
      if (square <= aa + 1e-6) {
        if (square >= aa - 1e-6) points.push(new B.Vector2(intercept, 0));
        else { const offset = b * Math.sqrt(1 - square / aa); points.push(new B.Vector2(intercept, offset), new B.Vector2(intercept, -offset)); }
      }
    }
    if (points.length === 0) return null;
    return points.length === 2 && dx * (points[0].x - cx) + dz * (points[0].y - cz) < 0 ? points[1] : points[0];
  }

  private outerAngle(x: number, z: number): number {
    const point = this.cross(x, z);
    return point ? Math.atan2(point.y * (2.05 * 1.55), point.x * 2.05) : Math.atan2(z - this.center.y, x - this.center.x);
  }

  private computeControls(state: number): void {
    let x: number, z: number, innerX: number, innerZ: number;
    if (state === 0) {
      x = Math.cos(this.angles[0]) * 2.05 * 1.55; z = Math.sin(this.angles[0]) * 2.05;
      const angle = Math.atan2(z - this.center.y, x - this.center.x);
      innerX = this.center.x + Math.cos(angle) * 0.38; innerZ = this.center.y + Math.sin(angle) * 0.38;
    } else {
      innerX = this.center.x + Math.cos(this.angles[1]) * 0.38; innerZ = this.center.y + Math.sin(this.angles[1]) * 0.38;
      const point = this.cross(innerX, innerZ);
      x = point?.x ?? Math.cos(this.angles[0]) * 2.05 * 1.55; z = point?.y ?? Math.sin(this.angles[0]) * 2.05;
    }
    this.start.set(x, z); this.change.set(innerX - x, innerZ - z);
  }

  resetWithKissDir(dx: number, dz: number, body: B.Vector3, ratio: number): void {
    this.angles[1] = Math.atan2(-dz, -dx);
    this.angles[0] = this.outerAngle(this.center.x - dx, this.center.y - dz);
    this.computeControls(0);
    body.x = this.start.x + this.change.x * ratio; body.z = this.start.y + this.change.y * ratio;
    this.angularSpeed = this.speed = this.targetSpeed = 0;
    this.speedDirty = true;
  }

  update(state: number, tween: CameraTween, body: B.Vector3): boolean {
    let running = false;
    if (this.speedDirty) {
      const delta = this.targetSpeed - this.speed;
      this.speedDirty = Math.abs(delta) >= 0.001;
      this.speed = this.speedDirty ? this.speed + delta / 15 : this.targetSpeed;
      running = this.speedDirty;
    }
    this.angularSpeed += this.speed;
    if (state !== this.active) {
      this.active = state; this.controlsDirty = true;
      this.angles[state] = state === 1 ? Math.atan2(body.z - this.center.y, body.x - this.center.x) : this.outerAngle(body.x, body.z);
    }
    if (this.angularSpeed !== 0) {
      this.controlsDirty = true;
      const factor = 1 - Math.abs(Math.sin(this.angles[state]));
      this.angularSpeed *= 0.82;
      if (Math.abs(this.angularSpeed) < 1e-4) this.angularSpeed = 0;
      else running = true;
      this.angles[state] += (1 + (state === 0 ? 1.55 : 1) * factor - factor) * this.angularSpeed * (0.2 * tween.renderedRatio + 0.8);
    }
    if (tween.renderedRatio === 0 || tween.renderedRatio === 1) {
      body.x = (state === 1 ? this.center.x : 0) + Math.cos(this.angles[state]) * (state === 1 ? 0.38 : 2.05 * 1.55);
      body.z = (state === 1 ? this.center.y : 0) + Math.sin(this.angles[state]) * (state === 1 ? 0.38 : 2.05);
    } else {
      if (this.controlsDirty) {
        this.controlsDirty = false; this.computeControls(state);
        const distance = this.change.lengthSquared();
        tween.timeScale = distance < 4 ? 1 : 1 - 0.0125 * (Math.min(distance, 16) - 4);
      }
      body.x = this.start.x + this.change.x * tween.renderedRatio; body.z = this.start.y + this.change.y * tween.renderedRatio;
    }
    return running;
  }
}
