import { Vec3 } from "../math/vec3.js";
import type { Simulator } from "../simulator/simulator.js";
import type { Ball } from "../simulator/ball.js";
import { isSegmentSafe } from "./geometry.js";
import type { RouteCache } from "./route-cache.js";

// PCOL L2585-2626
export function checkBanks(cue: Ball, target: Ball, sim: Simulator, cache: RouteCache): void {
  const balls = sim.getBalls();
  const x = cue.position.x;
  const z = cue.position.z;
  const tx = target.position.x;
  const tz = target.position.z;
  const radius = cue.radius;
  for (const poly of sim.sidePolyGroups?.polys ?? []) {
    if (!poly.sidehard || poly.bCenter) continue;
    const edge = poly.edges.find(item => Math.abs(item.vab.y) <= Vec3.EPSILON);
    if (!edge) continue;
    const normal = new Vec3(poly.normal.x, 0, poly.normal.z).normalize();
    const start = new Vec3(edge.va.x, 0, edge.va.z);
    const tangent = new Vec3(edge.vab.x, 0, edge.vab.z);
    const edgeLength = tangent.length();
    tangent.scale(1 / edgeLength);
    let fromCue = (x - start.x) * normal.x + (z - start.z) * normal.z - radius;
    let fromTarget = (tx - start.x) * normal.x + (tz - start.z) * normal.z - radius;
    if (fromCue * fromTarget < 0) continue;
    const sum = fromCue + fromTarget;
    const ratio = fromCue / sum;
    const correction = radius + 2 * fromCue * fromTarget / sum;
    const along = Math.abs(tangent.x) > Math.abs(tangent.z)
      ? ((tx - x) * ratio - normal.x * correction + x - start.x) / tangent.x
      : ((tz - z) * ratio - normal.z * correction + z - start.z) / tangent.z;
    if (along < Vec3.EPSILON || along > edgeLength - Vec3.EPSILON) continue;
    const bounce = new Vec3(start.x + tangent.x * along + normal.x * radius,
      cue.position.y, start.z + tangent.z * along + normal.z * radius);
    const incoming = bounce.clone().sub(cue.position);
    fromCue = incoming.length();
    incoming.scale(1 / fromCue);
    if (!isSegmentSafe(cue.position, incoming, fromCue, radius, balls, cue, target)) continue;
    const outgoing = target.position.clone().sub(bounce);
    fromTarget = outgoing.length();
    outgoing.scale(1 / fromTarget);
    if (!isSegmentSafe(bounce, outgoing, fromTarget, radius, balls, target)) continue;
    const power = 0.2 + 0.02 * (fromCue + fromTarget);
    let spinFactor = outgoing.dot(incoming) + 1;
    spinFactor *= spinFactor;
    cache.next(incoming.x, incoming.y, incoming.z, -power * spinFactor, power, 1 - fromTarget / 10).ballBIndex = target.index;
  }
}
