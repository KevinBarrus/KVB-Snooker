import * as B from "babylonjs/es6.js";
import type { Simulator } from "../core/simulator/simulator.js";
import { StickObstacles, sphereRayDistance, type Point3 } from "./stick-obstacles.js";

// PCOL L1216-1221
export const STICK_SPECS = { len: 1.45, tipRadius: 0.005, buttRadius: 0.015 } as const;

// PCOL L5172-5193, L5462-5484
function setTransform(matrix: B.Matrix, position: Point3, horizontal: number, vertical: number): void {
  const ch = Math.cos(horizontal), sh = Math.sin(horizontal), cv = Math.cos(vertical), sv = Math.sin(vertical);
  B.Matrix.FromValuesToRef(ch * cv, sv, -cv * sh, 0, -ch * sv, cv, sv * sh, 0,
    sh, 0, ch, 0, position.x, position.y, position.z, 1, matrix);
}

// PCOL L498-531
const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 4 * t - 2 * t * t - 1;
const easeOut = (t: number) => 2 * t - t * t;
const easeInOutFourth = (t: number) => t < 0.5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4;

// PCOL L4882-5484
export class StickController {
  readonly position = B.Vector3.Zero();
  readonly rotation = B.Vector3.Zero();
  readonly worldMatrix = B.Matrix.Identity();
  private readonly target = B.Vector3.Zero();
  private readonly localTip = B.Vector3.Zero();
  private readonly localSupport: B.Vector3;
  private readonly worldTip = B.Vector3.Zero();
  private readonly worldSupport = B.Vector3.Zero();
  private readonly contact = B.Vector3.Zero();
  private readonly direction = B.Vector3.Zero();
  private readonly transform = B.Matrix.Identity();
  private readonly aimPosition = B.Vector3.Zero();
  private readonly aimRotation = B.Vector3.Zero();
  private readonly animatedPosition = B.Vector3.Zero();
  private readonly animatedRotation = B.Vector3.Zero();
  private readonly standPosition = new B.Vector3(NaN, 1.86, NaN);
  private readonly obstacles = new StickObstacles();
  private potentialIndices: number[] = [];
  private controllerX = NaN;
  private controllerZ = NaN;
  private cachedSlope = 999;
  private horizontal = NaN;
  private vertical = 0;
  private tipMaxEscape = 0;
  private previousSupportY = 0;
  private factor = 1;
  private ratio = 0;
  private lead = 0;
  private kissDirty = 4 | 16 | 32;
  private animationDirty = 2;
  private predictionChanged = false;
  private readonly maxOffset: number;

  constructor(private readonly simulator: Pick<Simulator, "getBallCount" | "getBallView">, private readonly radius: number) {
    this.localSupport = new B.Vector3(-0.66, 0.5 * radius + 0.01, 0);
    this.maxOffset = Math.min(0.6 * radius, 0.99 * (radius - 0.01));
  }

  get stateRatio(): number { return this.ratio; }
  get angleH1(): number { return this.horizontal; }
  get rotationZ1(): number { return this.animatedRotation.z; }
  get leadingSpace(): number { return this.lead; }
  set leadingSpace(value: number) {
    if (this.lead !== value) { this.lead = value; this.animationDirty |= 2; }
  }
  get kissPoint(): B.Vector3 { this.updateKiss(); return this.contact; }
  get kissDir(): B.Vector3 { this.updateKiss(); return this.direction; }

  resetAimPoint(point: Point3): void {
    if (this.target.x !== point.x || this.target.y !== point.y || this.target.z !== point.z) {
      this.target.copyFromFloats(point.x, point.y, point.z);
      this.markKissDirty(1 | 2 | 16);
    }
  }

  syncPerson(body: Point3, azimuth: { forward: Point3; side: Point3; angle: number }, ratio: number): void {
    this.ratio = ratio;
    this.standPosition.x = body.x - 0.2 * azimuth.side.x;
    this.standPosition.z = body.z - 0.2 * azimuth.side.z;
    if (this.controllerX !== body.x || this.controllerZ !== body.z) {
      this.controllerX = body.x; this.controllerZ = body.z;
      this.markKissDirty(1);
    }
  }

  private markKissDirty(flags: number): void { this.kissDirty |= flags; this.animationDirty |= 2; }

  private setLocalTip(z: number, y: number, animated: boolean): void {
    if (this.localTip.z === z && this.localTip.y === y) return;
    this.localTip.z = z; this.localTip.y = y;
    this.markKissDirty(4);
    if (animated && this.factor > 0.4) this.factor *= 0.4;
  }

  moveLocTip(dx: number, dy: number): void {
    const ratio = Math.abs(dx / dy);
    if (ratio > 1.5) dy = 0;
    else if (ratio < 1 / 1.5) dx = 0;
    this.setLocalTip(this.localTip.z + 8e-5 * dx, this.localTip.y + 8e-5 * dy, true);
  }
  clearTip(animated = false): void { this.setLocalTip(0, 0, animated); }
  setTipPercent(x: number, y: number): void { this.setLocalTip(x * this.maxOffset, y * this.maxOffset, false); }
  setAngleV(angle: number, animated = false): void {
    angle = Math.max(0, Math.min(Math.PI / 4, angle));
    if (angle === this.vertical) return;
    this.vertical = angle;
    this.markKissDirty(2);
    if (animated) this.factor *= 0.4;
  }
  moveAngleV(delta: number): void { this.setAngleV(this.vertical + delta, true); }

  private updateKiss(): void {
    let dirty = this.kissDirty;
    if (!dirty) return;
    this.kissDirty = 0;
    if (dirty & 1) {
      const dx = this.controllerX - this.target.x, dz = this.controllerZ - this.target.z;
      const slope = dz / dx;
      if (Math.abs(slope - this.cachedSlope) > 1e-6) {
        this.cachedSlope = slope;
        this.horizontal = Math.atan2(-dz, dx) + Math.PI;
        dirty |= 2;
      }
    }
    if (dirty & 2) {
      setTransform(this.transform, this.target, this.horizontal, -this.vertical);
      dirty |= 8;
    }
    if (dirty & 4) {
      let { y, z } = this.localTip;
      if (y * y + z * z > this.maxOffset * this.maxOffset) {
        const angle = Math.atan2(y, z);
        this.localTip.y = y = this.maxOffset * Math.sin(angle);
        this.localTip.z = z = this.maxOffset * Math.cos(angle);
      }
      this.tipMaxEscape = Math.sqrt(this.maxOffset * this.maxOffset - z * z) - y;
      dirty |= 8;
    }
    if (dirty & 8) {
      B.Vector3.TransformCoordinatesToRef(this.localTip, this.transform, this.worldTip);
      B.Vector3.TransformCoordinatesToRef(this.localSupport, this.transform, this.worldSupport);
      dirty |= 32;
    }
    if (dirty & 16) {
      const reach = STICK_SPECS.len + this.radius + 0.1;
      this.potentialIndices = [];
      for (let i = 0; i < this.simulator.getBallCount(); ++i) {
        const ball = this.simulator.getBallView(i);
        const dx = ball.position.x - this.target.x, dy = ball.position.y - this.target.y, dz = ball.position.z - this.target.z;
        if (ball.active && ball.number !== 0 && dx * dx + dy * dy + dz * dz < reach * reach) this.potentialIndices.push(i);
      }
      this.obstacles.filter(this.target, reach);
      dirty |= 32;
    }
    if (dirty & 32) {
      const balls = this.potentialIndices.map(index => this.simulator.getBallView(index).position);
      if (this.obstacles.correct(this.worldTip, this.worldSupport, this.radius, 0.01, this.tipMaxEscape, balls)) {
        const factor = Math.max(0.5, 1 - Math.abs(this.worldSupport.y - this.previousSupportY) / 0.03);
        if (this.factor > factor) this.factor *= factor;
      }
      this.previousSupportY = this.worldSupport.y;
      this.worldTip.subtractToRef(this.worldSupport, this.direction);
      this.direction.normalize();
      const offset = this.worldSupport.subtract(this.target);
      const distance = sphereRayDistance(this.direction, offset, (this.radius + STICK_SPECS.tipRadius) ** 2);
      this.contact.copyFrom(this.worldSupport.add(this.direction.scale(distance)));
      this.predictionChanged = true;
    }
  }

  private animate(): void {
    const dirty = this.animationDirty;
    this.animationDirty = 0;
    if (dirty & 2) {
      this.updateKiss();
      this.aimRotation.y = Math.atan2(this.direction.x, this.direction.z) - Math.PI / 2;
      this.aimRotation.z = Math.asin(this.direction.y);
      this.aimPosition.copyFrom(this.contact.add(this.direction.scale(this.lead)));
    }
    if (this.factor !== 1) {
      this.factor += 0.05;
      if (this.factor <= 0.99) {
        this.animationDirty |= 1;
        this.factor = this.factor * this.ratio + 1 - this.ratio;
        B.Vector3.LerpToRef(this.animatedPosition, this.aimPosition, this.factor, this.animatedPosition);
        this.animatedRotation.x += (this.aimRotation.x - this.animatedRotation.x) * this.factor;
        this.animatedRotation.z += (this.aimRotation.z - this.animatedRotation.z) * this.factor;
        let yaw = this.aimRotation.y - this.animatedRotation.y;
        if (yaw > Math.PI) yaw -= 2 * Math.PI;
        else if (yaw < -Math.PI) yaw += 2 * Math.PI;
        this.animatedRotation.y += yaw * this.factor;
        return;
      }
      this.factor = 1;
    }
    this.animatedPosition.copyFrom(this.aimPosition);
    this.animatedRotation.copyFrom(this.aimRotation);
  }

  update(): void {
    if (this.ratio === 0) {
      this.position.copyFrom(this.standPosition);
      this.rotation.copyFromFloats(0, 0, Math.PI / 2);
    } else {
      if (this.animationDirty) this.animate();
      if (this.ratio === 1) {
        this.position.copyFrom(this.animatedPosition);
        this.rotation.copyFrom(this.animatedRotation);
      } else {
        const body = this.standPosition, aim = this.animatedPosition;
        const ratio = Math.min(1, this.ratio / 0.9);
        const horizontal = easeInOutFourth(ratio), vertical = easeInOut(ratio);
        this.position.copyFromFloats(body.x + (aim.x - body.x) * horizontal,
          body.y + (aim.y - body.y) * vertical, body.z + (aim.z - body.z) * horizontal);
        this.rotation.copyFromFloats(this.animatedRotation.x, this.animatedRotation.y,
          Math.PI / 2 + (this.animatedRotation.z - Math.PI / 2) * easeOut(Math.min(1, this.ratio / 0.7)));
      }
    }
    setTransform(this.worldMatrix, this.position, this.rotation.y, this.rotation.z);
  }

  isReadyToStroke(): boolean { return this.ratio === 1 && this.kissDirty === 0 && this.factor === 1; }
  consumePredictionChanged(): boolean {
    const changed = this.predictionChanged;
    this.predictionChanged = false;
    return changed;
  }
  getStrokeVars(power: number): Float32Array {
    const p = this.kissPoint, d = this.kissDir;
    return new Float32Array([p.x, p.y, p.z, d.x, d.y, d.z,
      this.getTouchSpdWithPower(power) * (3.2 + 6 * power), STICK_SPECS.tipRadius]);
  }
  getTouchSpdWithPower(power: number): number { return 0.5 + 11 * power; }
  getTipRadius(): number { return STICK_SPECS.tipRadius; }
  getSlowDownDistance(power: number, distance: number): number {
    const direction = this.kissDir;
    const toTable = direction.y > -1e-6 ? Number.MAX_VALUE :
      -(this.kissPoint.y - this.target.y + this.radius - STICK_SPECS.tipRadius) / direction.y;
    return Math.min(0.015 + power * distance * 0.9, toTable);
  }
}
