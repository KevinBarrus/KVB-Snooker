import type { PracticePoint, PracticeTable } from "./table-geometry.js";
import type { PracticeBall, PracticeLayout } from "./shape-types.js";

export const CUE_BALL_INDEX = 0;
export const RED_INDICES = Array.from({ length: 15 }, (_, index) => index + 1);
export const COLOUR_INDEX = { yellow: 16, green: 17, brown: 18, blue: 19, pink: 20, black: 21 } as const;
export const COLOUR_INDICES = [16, 17, 18, 19, 20, 21] as const;

export const BALL_ON = { red: 2, yellow: 4, blue: 32 } as const;

export function baseBalls(table: PracticeTable): PracticeBall[] {
  return table.spots.map((spot, index) => ({ index, x: spot.x, z: spot.z, active: false }));
}

export function place(balls: PracticeBall[], index: number, point: PracticePoint): void {
  const ball = balls[index];
  ball.x = point.x;
  ball.z = point.z;
  ball.active = true;
}

export function placeSpot(balls: PracticeBall[], table: PracticeTable, index: number): void {
  place(balls, index, table.spots[index]);
}

export function activateColours(balls: PracticeBall[], table: PracticeTable, excluded: readonly number[] = []): void {
  for (const index of COLOUR_INDICES) {
    if (!excluded.includes(index)) placeSpot(balls, table, index);
  }
}

export function finishLayout(balls: PracticeBall[], table: PracticeTable, ballOn: number,
  cue: PracticePoint = table.spots[CUE_BALL_INDEX]): PracticeLayout {
  place(balls, CUE_BALL_INDEX, cue);
  return { balls, cue, ballOn };
}

/** 在 a、b 之间等距放入 count 个点，不包含两端。 */
export function divideBetween(a: number, b: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => a + (b - a) * (index + 1) / (count + 1));
}

export function lineFrom(origin: PracticePoint, stepX: number, stepZ: number, count: number): PracticePoint[] {
  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + stepX * (index + 1),
    z: origin.z + stepZ * (index + 1)
  }));
}

function bezierAt(p0: PracticePoint, p1: PracticePoint, p2: PracticePoint, p3: PracticePoint, t: number): PracticePoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z
  };
}

/** 按弧长等距采样三次贝塞尔曲线，返回 count 个点（含两端）。 */
export function curvePoints(p0: PracticePoint, p1: PracticePoint, p2: PracticePoint, p3: PracticePoint, count: number): PracticePoint[] {
  if (count < 2) throw new Error("Curve needs at least two points");
  const steps = 64;
  const samples = [bezierAt(p0, p1, p2, p3, 0)];
  const lengths = [0];
  for (let step = 1; step <= steps; step++) {
    const point = bezierAt(p0, p1, p2, p3, step / steps);
    const previous = samples[step - 1];
    lengths.push(lengths[step - 1] + Math.hypot(point.x - previous.x, point.z - previous.z));
    samples.push(point);
  }
  const total = lengths[steps];
  const result: PracticePoint[] = [];
  let segment = 0;
  for (let index = 0; index < count; index++) {
    const target = total * index / (count - 1);
    while (segment < steps - 1 && lengths[segment + 1] < target) segment++;
    const span = lengths[segment + 1] - lengths[segment];
    const ratio = span <= 0 ? 0 : (target - lengths[segment]) / span;
    const from = samples[segment];
    const to = samples[segment + 1];
    result.push({ x: from.x + (to.x - from.x) * ratio, z: from.z + (to.z - from.z) * ratio });
  }
  return result;
}
