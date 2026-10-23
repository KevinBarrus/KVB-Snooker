import * as B from "babylonjs/es6.js";

// PCOL L4326-4460
export class CameraSpring {
  current = 0;
  target = 0;
  dirty = false;
  minimum = -Number.MAX_VALUE;
  maximum = Number.MAX_VALUE;
  private velocity = 0;

  constructor(readonly bias: number, public gain: number, readonly damping: number, readonly epsilon: number) {}

  to(value: number): void {
    value = Math.max(this.minimum, Math.min(this.maximum, value));
    if (this.target !== value) { this.target = value; this.dirty = true; }
  }

  reset(value: number): void {
    value = Math.max(this.minimum, Math.min(this.maximum, value));
    if (this.current !== value || this.target !== value) {
      this.current = this.target = value;
      this.dirty = true;
    }
  }

  update(): boolean {
    const delta = this.target - this.current;
    this.dirty = false;
    if (Math.abs(delta) < this.epsilon) { this.velocity = 0; this.current = this.target; }
    else {
      this.velocity = this.bias * this.velocity + (1 - this.bias) * (this.velocity + delta * this.gain);
      this.velocity *= this.damping;
      this.current += this.velocity;
      this.dirty = true;
    }
    return this.dirty;
  }
}

// PCOL L4779-4812
export class CameraAzimuth {
  private angleValue = 0;
  private readonly forwardValue = new B.Vector3(1, 0, 0);
  private readonly sideValue = new B.Vector3(0, 0, 1);
  private slope = 0;
  private dx = 0;
  private dz = 0;
  private dirty = false;

  get angle(): number { this.update(); return this.angleValue; }
  get forward(): B.Vector3 { this.update(); return this.forwardValue; }
  get side(): B.Vector3 { this.update(); return this.sideValue; }

  setSlope(dx: number, dz: number): void {
    const slope = dz / dx;
    if (this.dirty || Math.abs(slope - this.slope) > 1e-6) {
      this.dirty = true; this.slope = slope; this.dx = dx; this.dz = dz;
    }
  }

  private update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.angleValue = Math.atan2(this.dz, this.dx);
    const cosine = Math.cos(this.angleValue), sine = Math.sin(this.angleValue);
    this.forwardValue.copyFromFloats(cosine, 0, sine);
    this.sideValue.copyFromFloats(-sine, 0, cosine);
  }
}
