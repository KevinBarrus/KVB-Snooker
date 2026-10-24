import type { CameraPoint } from "./camera-look.js";

export class FocusSmoothing {
  private angularSpeed = 0;
  aspect = 1.6;
  verticalFov = .88;

  reset(): void { this.angularSpeed = 0; }

  update(target: { x: number; y: number; z: number }, desired: CameraPoint, eye: CameraPoint, dt: number): void {
    let remaining = Math.min(Math.max(dt, 0), .1);
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 120);
      remaining -= step;
      const dx = desired.x - eye.x, dz = desired.z - eye.z;
      const tx = target.x - eye.x, tz = target.z - eye.z;
      const angle = Math.atan2(tz, tx);
      const error = Math.atan2(Math.sin(Math.atan2(dz, dx) - angle), Math.cos(Math.atan2(dz, dx) - angle));
      const halfFov = Math.atan(Math.tan(this.verticalFov / 2) * Math.max(.5, this.aspect));
      const urgency = Math.min(1, Math.max(0, (Math.abs(error) / halfFov - .2) / .5));
      const speedLimit = 1.4 + 2 * urgency;
      const requested = Math.max(-speedLimit, Math.min(speedLimit, error * (5 + 9 * urgency)));
      this.angularSpeed += (requested - this.angularSpeed) * (1 - Math.exp(-10 * step));
      let turn = this.angularSpeed * step;
      if (Math.sign(turn) === Math.sign(error) && Math.abs(turn) > Math.abs(error)) turn = error;
      const blend = 1 - Math.exp(-8 * step);
      const distance = Math.hypot(tx, tz) + (Math.hypot(dx, dz) - Math.hypot(tx, tz)) * blend;
      target.x = eye.x + Math.cos(angle + turn) * distance;
      target.z = eye.z + Math.sin(angle + turn) * distance;
      target.y += (desired.y - target.y) * blend;
    }
  }
}
