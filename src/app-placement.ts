import type { GameSession } from "./core/game.js";
import type { Simulator } from "./core/simulator/simulator.js";
import type { PlacementCommands } from "./controller/in-hand.js";
import { constrainPlacement } from "./controller/placement-path.js";
import type { Point3 } from "./controller/stick-obstacles.js";

export function placementCommands(sim: Simulator, session: () => GameSession, player: () => number,
  allowed: () => boolean, ray: PlacementCommands["ray"], changed: () => void, notice: (text: string) => void): PlacementCommands {
  const valid = (point: Point3) => session().canPlaceCueBall(point.x, sim.spotY, point.z);
  const origin = (): Point3 | null => {
    if (!session().clock) return null;
    const cue = sim.getBallView(0);
    if (cue.active && valid(cue.position)) return { ...cue.position };
    let best: Point3 | null = null, distance = Infinity;
    for (let x = -1.7; x <= 1.7; x += .05) for (let z = -.8; z <= .8; z += .05) {
      const point = { x, y: sim.spotY, z };
      const delta = (x - cue.position.x) ** 2 + (z - cue.position.z) ** 2;
      if (delta < distance && valid(point)) { best = point; distance = delta; }
    }
    return best;
  };
  const place = (point: Point3): boolean => {
    const game = session();
    if (!allowed()) return false;
    if (!game.placeCueBall(point.x, sim.spotY, point.z)) {
      notice("当前位置无法放球，请移动到合法区域");
      return false;
    }
    if (game.clock && !game.confirmPlacement(player())) return false;
    changed();
    return true;
  };
  return {
    ray, valid, place,
    begin: () => !session().clock || session().beginPlacement(player()),
    origin,
    constrain: (from, to) => session().clock ? constrainPlacement(from, to,
      Array.from({ length: sim.getBallCount() }, (_, i) => sim.getBallView(i)), sim.ballRadius, valid) : to,
    confirmCurrent: () => {
      const cue = sim.getBallView(0);
      if (!cue.active || !valid(cue.position)) {
        notice("母球需要重新放置，请移动预览点后点击确认");
        return false;
      }
      return place(cue.position);
    }
  };
}
