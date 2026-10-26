import type { RefSimulator } from "./snooker.js";

export interface NominationView {
  readonly required: boolean;
  readonly ballIndex: number | null;
  readonly manual: boolean;
}

export function inferColour(sim: RefSimulator, dx: number, dz: number): number | null {
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 1e-10) return null;
  dx /= length; dz /= length;
  const cue = sim.getBallAtIndex(0).position;
  const diameter = 2 * sim.ballRadius;
  let nearest = Infinity, next = Infinity, target: number | null = null;
  for (const ball of sim.getBalls()) {
    if (!ball.active || ball.index === 0) continue;
    const x = ball.position.x - cue.x, z = ball.position.z - cue.z;
    if (ball.number > 1 && Math.hypot(x, z) <= diameter + 1e-5) return null;
    const along = x * dx + z * dz;
    const across = x * dz - z * dx;
    if (along <= 0 || Math.abs(across) >= diameter) continue;
    const distance = Math.max(0, along - Math.sqrt(diameter * diameter - across * across));
    if (distance < nearest) {
      next = nearest; nearest = distance; target = ball.number > 1 ? ball.index : null;
    } else next = Math.min(next, distance);
  }
  return next - nearest <= 1e-5 ? null : target;
}
