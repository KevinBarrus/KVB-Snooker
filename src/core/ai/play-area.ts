import { Vec3 } from "../math/vec3.js";
import { PointSetPolygon } from "../rules/region.js";
import type { Simulator } from "../simulator/simulator.js";

export interface Pocket {
  position: Vec3;
  normal: Vec3;
  radius: number;
  maxHalfOpen: number;
}

export interface GameView {
  playArea: PlayArea;
  pointProjectionOnTable(x: number, y: number, z: number): boolean;
}

// PCOL L1731-1773
export class PlayArea {
  readonly position: Vec3;
  readonly size: { w: number; h: number };
  readonly diagonal: number;
  readonly pockets: Pocket[];

  constructor(x = 0, y = 0.88, z = 0, width = 3.66, height = 1.859) {
    this.position = new Vec3(x, y, z);
    this.size = { w: width, h: height };
    this.diagonal = Math.sqrt(width * width + height * height);
    const a = 0.5 * width - 0.05;
    const b = 0.5 * height - 0.05;
    const c = 0.5 * height - 0.05 * 0.4;
    const open = -Math.cos(65 * Math.PI / 180);
    const pocket = (px: number, pz: number, nx: number, nz: number, maxHalfOpen: number): Pocket => ({
      position: new Vec3(px, y, pz), normal: new Vec3(nx, 0, nz).normalize(), radius: 0.05, maxHalfOpen
    });
    this.pockets = [
      pocket(x - a, z - b, 1, 1, 0), pocket(x - a, z + b, 1, -1, 0),
      pocket(x, z - c, 0, 1, open), pocket(x, z + c, 0, -1, open),
      pocket(x + a, z - b, -1, 1, 0), pocket(x + a, z + b, -1, -1, 0)
    ];
  }
}

// PCOL L12632-12648
export function createGameView(sim: Simulator): GameView {
  const table = new PointSetPolygon();
  table.resetWithAtomPolygon(sim.ground);
  return { playArea: new PlayArea(), pointProjectionOnTable: (x, y, z) => table.projectionInside(x, y, z) };
}
