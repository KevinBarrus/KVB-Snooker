import { Vec3 } from "../math/vec3.js";
import type { Ball } from "../simulator/ball.js";

// PCOL L10099-10138
export function intersectSphereRay(center: Vec3, radius: number, origin: Vec3, direction: Vec3): number | null {
  const offset = origin.clone().sub(center);
  const along = offset.dot(direction);
  const distance = offset.dot(offset) - radius * radius;
  if (distance > 0 && along > 0) return null;
  const discriminant = along * along - distance;
  if (discriminant < -Vec3.EPSILON) return null;
  return Math.max(0, discriminant > Vec3.EPSILON ? -along - Math.sqrt(discriminant) : -along);
}

// PCOL L2823-2834
export function isSegmentSafe(
  origin: Vec3, direction: Vec3, length: number, radius: number, balls: Ball[], ...excluded: Ball[]
): boolean {
  if (length < radius) return true;
  for (const ball of balls) {
    if (ball.active && !excluded.includes(ball)) {
      const hit = intersectSphereRay(ball.position, ball.radius + radius, origin, direction);
      if (hit !== null && hit <= length) return false;
    }
  }
  return true;
}
