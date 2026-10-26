import { Vec3 } from "../math/vec3.js";
import type { DiscRegion } from "./region.js";
import type { RefSimulator } from "./snooker.js";
import { snookerView } from "./snookered.js";

interface Line { kind: "line"; x: number; z: number; offset: number }
interface Circle { kind: "circle"; x: number; z: number; radius: number }
type Boundary = Line | Circle;

export function hasOpenInHand(sim: RefSimulator, ballOn: number, area: DiscRegion): boolean {
  const radius = area.radius;
  const balls = sim.getBalls().filter(ball => ball.active && ball.index !== 0).map(ball => {
    const dx = ball.position.x - area.center.x, dz = ball.position.z - area.center.z;
    return { ball, x: dx * area.arcDir.x + dz * area.arcDir.z,
      z: dx * area.diameterDir.x + dz * area.diameterDir.z };
  });
  const curves: Boundary[] = [{ kind: "circle", x: 0, z: 0, radius }];
  const diameter = 2 * sim.ballRadius;
  const point = new Vec3(0, sim.spotY, 0);
  const open = (x: number, z: number): boolean => {
    if (x < 0 || x * x + z * z > radius * radius + 1e-12) return false;
    point.set(area.center.x + x * area.arcDir.x + z * area.diameterDir.x, sim.spotY,
      area.center.z + x * area.arcDir.z + z * area.diameterDir.z);
    return area.projectionInside(point.x, point.y, point.z) && !sim.touchBalls(0, point) && !snookerView(sim, ballOn, point).snookered;
  };
  if (open(radius / 2, 0) || open(0, radius) || open(0, -radius)) return true;
  const keys = new Set<string>();
  const addLine = (x: number, z: number, offset: number): void => {
    if (Math.abs(offset) > radius + 1e-9) return;
    const key = [x, z, offset].map(n => n.toFixed(11)).join(",");
    if (!keys.has(key)) { keys.add(key); curves.push({ kind: "line", x, z, offset }); }
  };
  for (const item of balls) {
    const clearance = Math.sqrt(Math.max(0, (2.02 * sim.ballRadius) ** 2 - Vec3.EPSILON - (item.ball.position.y - sim.spotY) ** 2));
    if (Math.hypot(item.x, item.z) <= radius + clearance) curves.push({ kind: "circle", x: item.x, z: item.z, radius: clearance });
    if (!(2 ** item.ball.number & ballOn)) continue;
    for (const blocker of balls) {
      if (2 ** blocker.ball.number & ballOn) continue;
      const dx = blocker.x - item.x, dz = blocker.z - item.z, distance = Math.hypot(dx, dz);
      if (distance < 1e-10) continue;
      const ux = dx / distance, uz = dz / distance;
      for (const sign of [-1, 1]) {
        addLine(-uz, ux, -uz * item.x + ux * item.z + sign * diameter);
        if (distance >= 2 * diameter) {
          const cosine = 2 * diameter / distance, sine = Math.sqrt(1 - cosine * cosine);
          const nx = ux * cosine - sign * uz * sine, nz = uz * cosine + sign * ux * sine;
          addLine(nx, nz, nx * item.x + nz * item.z + diameter);
        } else {
          const height = Math.sqrt(diameter * diameter - distance * distance / 4);
          const px = (item.x + blocker.x) / 2 - sign * uz * height;
          const pz = (item.z + blocker.z) / 2 + sign * ux * height;
          for (const center of [item, blocker]) {
            const nx = (px - center.x) / diameter, nz = (pz - center.z) / diameter;
            addLine(nx, nz, nx * px + nz * pz);
          }
        }
      }
    }
  }
  const xs = [0, radius];
  const addPoint = (x: number, z: number): void => {
    if (x >= 0 && x <= radius && Math.abs(z) <= radius + 1e-9) xs.push(x);
  };
  for (let i = 0; i < curves.length; ++i) {
    const curve = curves[i];
    if (curve.kind === "circle") {
      addPoint(curve.x - curve.radius, curve.z); addPoint(curve.x + curve.radius, curve.z);
    } else if (Math.abs(curve.z) < 1e-12) addPoint(curve.offset / curve.x, 0);
    for (let j = 0; j < i; ++j) intersections(curve, curves[j], addPoint);
  }
  for (const x of samples(xs)) {
    const zs = [-radius, radius];
    for (const curve of curves) {
      if (curve.kind === "line") {
        if (Math.abs(curve.z) > 1e-12) zs.push((curve.offset - curve.x * x) / curve.z);
      } else {
        const square = curve.radius ** 2 - (x - curve.x) ** 2;
        if (square >= 0) zs.push(curve.z - Math.sqrt(square), curve.z + Math.sqrt(square));
      }
    }
    for (const z of samples(zs.filter(z => Math.abs(z) <= radius + 1e-9))) if (open(x, z)) return true;
  }
  return false;
}

function samples(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const result: number[] = [];
  for (let i = 0; i < values.length; ++i) {
    if (i && values[i] - values[i - 1] < 1e-11) continue;
    result.push(values[i]);
    if (i) result.push((values[i - 1] + values[i]) / 2);
  }
  return result;
}

function intersections(a: Boundary, b: Boundary, add: (x: number, z: number) => void): void {
  if (a.kind === "line" && b.kind === "line") {
    const det = a.x * b.z - a.z * b.x;
    if (Math.abs(det) > 1e-12) add((a.offset * b.z - a.z * b.offset) / det, (a.x * b.offset - a.offset * b.x) / det);
    return;
  }
  if (a.kind === "circle" && b.kind === "circle") {
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
    if (distance < 1e-12 || distance > a.radius + b.radius || distance < Math.abs(a.radius - b.radius)) return;
    const along = (distance ** 2 + a.radius ** 2 - b.radius ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
    for (const sign of [-1, 1]) add(a.x + (along * dx - sign * height * dz) / distance, a.z + (along * dz + sign * height * dx) / distance);
    return;
  }
  const line = a.kind === "line" ? a : b.kind === "line" ? b : null;
  const circle = a.kind === "circle" ? a : b.kind === "circle" ? b : null;
  if (!line || !circle) return;
  const distance = line.x * circle.x + line.z * circle.z - line.offset;
  if (Math.abs(distance) > circle.radius) return;
  const along = Math.sqrt(Math.max(0, circle.radius ** 2 - distance ** 2));
  for (const sign of [-1, 1]) add(circle.x - distance * line.x - sign * along * line.z, circle.z - distance * line.z + sign * along * line.x);
}
