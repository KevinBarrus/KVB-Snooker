import type { GameSession } from "./core/game.js";
import type { Simulator } from "./core/simulator/simulator.js";
import type { PlacementCommands } from "./controller/in-hand.js";
import type { Point3 } from "./controller/stick-obstacles.js";

export function placementCommands(sim: Simulator, session: () => GameSession, player: () => number,
  allowed: () => boolean, ray: PlacementCommands["ray"], changed: () => void, notice: (text: string) => void): PlacementCommands {
  const valid = (point: Point3) => session().canPlaceCueBall(point.x, sim.spotY, point.z);
  const cuePoint = (): Point3 | null => {
    const cue = sim.getBallView(0);
    return cue.active ? { x: cue.position.x, y: cue.position.y, z: cue.position.z } : null;
  };
  const place = (point: Point3): boolean => {
    const game = session();
    if (!allowed()) return false;
    if (!game.placeCueBall(point.x, sim.spotY, point.z)) {
      notice("当前位置无法放球，请移动到合法区域");
      return false;
    }
    if (game.clock && !game.confirmPlacement(player())) {
      notice("摆球状态已变化，请重新摆球");
      return false;
    }
    changed();
    return true;
  };
  const end = (): boolean => {
    const game = session();
    if (!allowed() || !cuePoint()) {
      notice("母球需要先放到合法位置");
      return false;
    }
    if (game.clock && !game.confirmPlacement(player())) {
      notice("母球需要先放到合法位置");
      return false;
    }
    return true;
  };
  return {
    ray, valid, place, end, focus: cuePoint,
    begin: () => !session().clock || session().beginPlacement(player())
  };
}
