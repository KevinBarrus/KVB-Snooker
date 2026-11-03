import type { Point3 } from "./stick-obstacles.js";

export function constrainPlacement(from: Point3, to: Point3,
  balls: readonly { readonly active: boolean; readonly index: number; readonly position: Point3 }[],
  radius: number, valid: (point: Point3) => boolean): Point3 {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite) || !valid(from)) return { ...from };
  const dx = to.x - from.x, dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return { ...from };
  let limit = 1;
  const gap = radius * 2.02;
  for (const ball of balls) {
    if (!ball.active || ball.index === 0) continue;
    const x = from.x - ball.position.x, z = from.z - ball.position.z;
    const projection = x * dx + z * dz;
    const discriminant = projection ** 2 - lengthSq * (x * x + z * z - gap * gap);
    if (discriminant <= 0) continue;
    const hit = (-projection - Math.sqrt(discriminant)) / lengthSq;
    if (hit >= 0 && hit <= limit) limit = Math.max(0, hit - 1e-6 / Math.sqrt(lengthSq));
  }
  const point = (t: number): Point3 => ({ x: from.x + dx * t, y: from.y, z: from.z + dz * t });
  const steps = Math.max(1, Math.ceil(Math.sqrt(lengthSq) * limit / (radius / 4)));
  let previous = 0;
  for (let i = 1; i <= steps; ++i) {
    const t = limit * i / steps;
    if (!valid(point(t))) {
      let low = previous, high = t;
      for (let j = 0; j < 24; ++j) {
        const middle = (low + high) / 2;
        if (valid(point(middle))) low = middle;
        else high = middle;
      }
      return point(low);
    }
    previous = t;
  }
  return point(limit);
}
