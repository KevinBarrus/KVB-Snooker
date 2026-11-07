import type { Simulator } from "../simulator/simulator.js";

export interface PracticePoint {
  x: number;
  z: number;
}

export interface PracticeTable {
  readonly ballRadius: number;
  /** 母球球心可以到达的边界（已含球半径），由台面碰撞网格推出。 */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** 按球索引取得标准置球点（x,z）；红球与母球点也有初值。 */
  readonly spots: readonly PracticePoint[];
}

const AXIS_EPSILON = 1e-9;
const MIN_EDGE_LENGTH = 0.5;

function faceCoordinates(edges: readonly { va: { x: number; z: number }; vb: { x: number; z: number } }[]): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const edge of edges) {
    const dx = edge.vb.x - edge.va.x;
    const dz = edge.vb.z - edge.va.z;
    if (Math.hypot(dx, dz) < MIN_EDGE_LENGTH) continue;
    if (Math.abs(dx) <= AXIS_EPSILON) xs.push(edge.va.x);
    else if (Math.abs(dz) <= AXIS_EPSILON) zs.push(edge.va.z);
  }
  return { xs, zs };
}

function fallbackCoordinates(edges: readonly { va: { x: number; z: number }; vb: { x: number; z: number } }[]): { xs: number[]; zs: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const edge of edges) {
    xs.push(edge.va.x, edge.vb.x);
    zs.push(edge.va.z, edge.vb.z);
  }
  return { xs, zs };
}

/** 从真实台面网格读取库边内沿，换算出球心合法范围；不修改物理台面。 */
export function practiceTable(simulator: Simulator): PracticeTable {
  const edges = simulator.ground.edges;
  let { xs, zs } = faceCoordinates(edges);
  if (xs.length < 2 || zs.length < 2) ({ xs, zs } = fallbackCoordinates(edges));
  const ballRadius = simulator.ballRadius;
  const spots: PracticePoint[] = [];
  for (let index = 0; index < simulator.getBallCount(); index++) {
    const spot = simulator.getBallAtIndex(index).spot;
    spots.push({ x: spot.x, z: spot.z });
  }
  return {
    ballRadius,
    minX: Math.min(...xs) + ballRadius,
    maxX: Math.max(...xs) - ballRadius,
    minZ: Math.min(...zs) + ballRadius,
    maxZ: Math.max(...zs) - ballRadius,
    spots
  };
}
