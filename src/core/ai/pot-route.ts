import { Vec3 } from "../math/vec3.js";
import { coreRandom } from "../rng.js";
import type { Simulator } from "../simulator/simulator.js";
import type { Ball } from "../simulator/ball.js";
import { intersectSphereRay, isSegmentSafe } from "./geometry.js";
import type { GameView, PlayArea } from "./play-area.js";
import type { AIProfile } from "./profiles.js";
import type { RouteCache, CachedRoute } from "./route-cache.js";

// PCOL L2748-2807
export function checkPocket(
  cue: Ball, target: Ball, pkIndex: number, area: PlayArea, sim: Simulator, view: GameView, cache: RouteCache
): void {
  const pocket = area.pockets[pkIndex];
  const path = pocket.position.clone().sub(target.position);
  path.y = 0;
  const towardPocket = path.clone().normalize();
  if (towardPocket.dot(pocket.normal) > pocket.maxHalfOpen) return;
  const pocketDistance = path.length();
  const balls = sim.getBalls();
  if (!isSegmentSafe(target.position, towardPocket, pocketDistance, target.radius, balls, cue, target)) return;
  const ghost = towardPocket.clone().scale(-target.radius - cue.radius).add(target.position);
  if (!view.pointProjectionOnTable(ghost.x, ghost.y, ghost.z)) return;
  const direction = ghost.clone().sub(cue.position);
  const cueDistance = direction.length();
  direction.scale(1 / cueDistance);
  const cut = direction.dot(towardPocket);
  if (cut < -Vec3.EPSILON) return;
  if (!isSegmentSafe(cue.position, direction, cueDistance - 0.002, cue.radius + Vec3.EPSILON, balls, cue, target)) return;
  const reflection = towardPocket.clone().scale(direction.dot(towardPocket) * (0.97 - 0.31 * Math.min(1, cueDistance / 2)));
  reflection.subVectors(direction, reflection).normalize();
  let throat = 0;
  for (let index = 0; index < area.pockets.length; ++index) {
    const position = area.pockets[index].position;
    if (position.distanceToSq(ghost) < 0.34) {
      const offset = position.clone().sub(ghost);
      offset.y = 0;
      if (offset.dot(reflection) > 0 && intersectSphereRay(position, cue.radius + pocket.radius, ghost, reflection) !== null) {
        throat = pkIndex === index ? 1 : 2;
        break;
      }
    }
  }
  if (throat === 2) return;
  const s = pocketDistance / area.diagonal;
  const c = cueDistance / area.diagonal;
  let fbSpin = 0;
  let power = 0.2 * (c + s) * 0.5 + (1 - cut) * s * 0.7;
  if (throat === 1) { fbSpin = -0.99; power = Math.max(power, 0.7 * c); }
  const priority = (0.5 * (1 - c) + 0.45 * (1 - s)) * cut + 0.05 * target.number;
  const route = cache.next(direction.x, direction.y, direction.z, fbSpin, power, priority);
  route.ballBIndex = target.index;
  route.pkIndex = pkIndex;
}

// PCOL L2710-2744
export function applyChaos(route: CachedRoute, view: GameView, sim: Simulator, profile: AIProfile): void {
  if (coreRandom() < 0.05) return;
  const cue = sim.getBallAtIndex(0);
  const target = sim.getBallAtIndex(route.ballBIndex);
  const pocket = view.playArea.pockets[route.pkIndex];
  const cueDistance = cue.position.distanceTo(target.position);
  const direction = new Vec3(route.dx, route.dy, route.dz);
  const path = pocket.position.clone().sub(target.position);
  path.y = 0;
  const distance = path.length();
  const towardPocket = path.clone().scale(1 / distance);
  const cut = direction.dot(towardPocket);
  const cutFactor = 1 / (1 + Math.pow(Math.E, -(distance - 1.8 * cut * cut) / 0.5)) * profile.bcf;
  let aimFactor = Math.min(1, cueDistance / profile.range) * profile.abf;
  aimFactor *= aimFactor;
  let error = (1 - Math.pow(coreRandom(), profile.chaoticSeed)) * (aimFactor + cutFactor);
  const offset = new Vec3().crossVectors(path, Vec3.UNIT_Y).normalize();
  if (coreRandom() > 0.5) error *= -1;
  offset.scale((pocket.radius + target.radius) * error);
  if (route.pkIndex === 2 || route.pkIndex === 3) error *= profile.mpm;
  else if (error < 1) error *= profile.bpm;
  path.add(offset);
  towardPocket.normalizeVector(path);
  const ghost = towardPocket.scale(-target.radius - cue.radius).add(target.position);
  direction.subVectors(ghost, cue.position).normalize();
  route.dx = direction.x;
  route.dy = direction.y;
  route.dz = direction.z;
}
