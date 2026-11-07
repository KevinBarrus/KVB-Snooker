import type { GameSession } from "../core/game.js";
import type { Simulator } from "../core/simulator/simulator.js";

/**
 * 核心合法放置：母球失活且手中球时，先尝试母球默认点，再扫描台面，
 * 直到 GameSession.placeCueBall 的规则校验（D 区/不贴球）通过。
 */
export function ensureCueBallActive(session: GameSession, simulator: Simulator): boolean {
  const cueBall = simulator.getBallAtIndex(0);
  if (cueBall.active) return true;
  if (session.context.inHand === 0) return false;
  if (session.placeCueBall(cueBall.spot.x, simulator.spotY, cueBall.spot.z)) return true;
  const ground = simulator.ground;
  const center = ground.centerPosition;
  const radius = simulator.ballRadius;
  const halfWidth = ground.size.x / 2;
  const halfDepth = Math.max(ground.size.z / 2, radius);
  for (let dx = -halfWidth + radius; dx <= halfWidth; dx += radius) {
    for (let dz = -halfDepth + radius; dz <= halfDepth; dz += radius) {
      if (session.placeCueBall(center.x + dx, simulator.spotY, center.z + dz)) return true;
    }
  }
  return false;
}
