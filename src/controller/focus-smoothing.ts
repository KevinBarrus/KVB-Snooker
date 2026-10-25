import type { CameraPoint } from "./camera-look.js";

export class FocusSmoothing {
  private readonly angularSpeeds = [0, 0];
  aspect = 1.6;
  verticalFov = .88;

  reset(): void { this.angularSpeeds.fill(0); }

  private turn(error: number, halfFov: number, step: number, axis: number): number {
    const urgency = Math.min(1, Math.max(0, (Math.abs(error) / halfFov - .2) / .5));
    const speedLimit = 1.4 + 2 * urgency;
    const gain = 4 + 2 * urgency;
    const requested = Math.max(-speedLimit, Math.min(speedLimit, error * gain));
    const change = (requested - this.angularSpeeds[axis]) * (1 - Math.exp(-4 * gain * step));
    this.angularSpeeds[axis] += Math.max(-12 * step, Math.min(12 * step, change));
    return this.angularSpeeds[axis] * step;
  }

  update(target: { x: number; y: number; z: number }, desired: CameraPoint, eye: CameraPoint, dt: number): void {
    let remaining = Math.min(Math.max(dt, 0), .1);
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 120);
      remaining -= step;
      const dx = desired.x - eye.x, dy = desired.y - eye.y, dz = desired.z - eye.z;
      const tx = target.x - eye.x, ty = target.y - eye.y, tz = target.z - eye.z;
      if (Math.hypot(dx, dy, dz) < 1e-8 || Math.hypot(tx, ty, tz) < 1e-8) return;
      const angle = Math.atan2(tz, tx);
      const error = Math.atan2(Math.sin(Math.atan2(dz, dx) - angle), Math.cos(Math.atan2(dz, dx) - angle));
      const halfFov = Math.atan(Math.tan(this.verticalFov / 2) * Math.max(.5, this.aspect));
      const yaw = angle + this.turn(error, halfFov, step, 0);
      const pitch = Math.atan2(ty, Math.hypot(tx, tz));
      const nextPitch = pitch + this.turn(Math.atan2(dy, Math.hypot(dx, dz)) - pitch, this.verticalFov / 2, step, 1);
      const blend = 1 - Math.exp(-8 * step);
      const sine = Math.sin(nextPitch);
      const onPlane = dy * sine > 0 && Math.abs(sine) > 1e-4;
      const distance = onPlane ? dy / sine : Math.hypot(tx, ty, tz) + (Math.hypot(dx, dy, dz) - Math.hypot(tx, ty, tz)) * blend;
      target.x = eye.x + Math.cos(yaw) * Math.cos(nextPitch) * distance;
      target.z = eye.z + Math.sin(yaw) * Math.cos(nextPitch) * distance;
      target.y = onPlane ? desired.y : eye.y + sine * distance;
    }
  }
}
