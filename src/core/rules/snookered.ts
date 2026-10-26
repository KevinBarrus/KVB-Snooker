import type { BallRefLike, RefSimulator } from "./snooker.js";

export interface TablePoint { readonly x: number; readonly z: number }
export interface SnookerView { readonly snookered: boolean; readonly effectiveBlockers: readonly number[] }

export function snookerView(sim: RefSimulator, ballOn: number, cue: TablePoint = sim.getBallAtIndex(0).position): SnookerView {
  const balls = sim.getBalls().filter(ball => ball.active && ball.index !== 0);
  const targets = balls.filter(ball => (2 ** ball.number & ballOn) !== 0);
  const blockers = balls.filter(ball => (2 ** ball.number & ballOn) === 0);
  const radius = 2 * sim.ballRadius;
  let effective: number[] | null = null;
  if (!targets.length) return { snookered: false, effectiveBlockers: [] };
  for (const target of targets) {
    const x = target.position.x - cue.x, z = target.position.z - cue.z;
    const length = Math.hypot(x, z);
    if (length <= radius + 1e-8) return { snookered: false, effectiveBlockers: [] };
    const sine = radius / length, cosine = Math.sqrt(1 - sine * sine);
    const distance = length * cosine;
    const obstructing = blockers.filter(ball => [-1, 1].some(sign => {
      const dx = (x * cosine - sign * z * sine) / length;
      const dz = (z * cosine + sign * x * sine) / length;
      const bx = ball.position.x - cue.x, bz = ball.position.z - cue.z;
      const along = bx * dx + bz * dz, across = bx * dz - bz * dx;
      if (along <= 0 || Math.abs(across) >= radius - 1e-9) return false;
      return along - Math.sqrt(radius * radius - across * across) < distance - 1e-9;
    }));
    if (!obstructing.length) return { snookered: false, effectiveBlockers: [] };
    const nearest = Math.min(...obstructing.map(ball => distanceTo(ball, cue)));
    const indices = obstructing.filter(ball => distanceTo(ball, cue) <= nearest + 1e-8).map(ball => ball.index);
    effective = effective === null ? indices : effective.filter(index => indices.includes(index));
  }
  return { snookered: true, effectiveBlockers: effective ?? [] };
}

function distanceTo(ball: BallRefLike, point: TablePoint): number {
  return Math.hypot(ball.position.x - point.x, ball.position.z - point.z);
}
