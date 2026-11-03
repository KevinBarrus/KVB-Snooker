import { Vec3 } from "../math/vec3.js";
import { adjudicate } from "./adjudicate.js";
import { FOUL } from "./foul.js";
import { PointSetPolygon } from "./region.js";
import { SnookerRef, type RefSimulator, type RulesContext } from "./snooker.js";

export function targetPenalty(ctx: RulesContext, sim: RefSimulator): number {
  return Math.max(4, ctx.ballOn === 252 ? ctx.nominatedBallIndex === undefined ? 7
    : sim.getBallAtIndex(ctx.nominatedBallIndex).number : Math.log2(ctx.ballOn));
}

export class NineHundredRef extends SnookerRef {
  protected override readonly endsOnBlackFoul = false;

  protected override adjudicate(ctx: RulesContext, sim: RefSimulator): { score: number; foulCode: number } {
    const result = adjudicate(ctx, sim);
    if (!sim.result.pottedIndices.length && !sim.getCushionEvidence?.()?.contacts.length) {
      result.foulCode |= FOUL.NO_CUSHION;
      result.score = Math.min(result.score, -targetPenalty(ctx, sim));
    }
    return result;
  }
}

function distanceToSegment(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

export function canPlaceOnTable(sim: RefSimulator, x: number, y: number, z: number): boolean {
  if (![x, y, z].every(Number.isFinite) || Math.abs(y - sim.spotY) > 1e-6) return false;
  const area = new PointSetPolygon();
  area.resetWithAtomPolygon(sim.ground);
  if (!area.projectionInside(x, y, z) || sim.touchBalls(0, new Vec3(x, y, z))) return false;
  const edges = sim.ground.edges;
  if (edges.some((edge, i) => distanceToSegment(x, z, edge.va, edges[(i + 1) % edges.length].va) < sim.ballRadius)) return false;
  return !sim.sidePolyGroups?.polys.some(poly => (poly.sidehard || poly.sidesoft) &&
    poly.edges.some(edge => distanceToSegment(x, z, edge.va, edge.vb) < sim.ballRadius));
}
