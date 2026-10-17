import { Vec3 } from "../math/vec3.js";

/** PCOL L8932-8968（原模 16）：物理常量表，逐值 1:1。 */
export interface RestitutionKeys {
  ball: number;
  ground: number;
  sidehard: number;
  sidesoft: number;
  tunnel: number;
  pocket: number;
  default: number;
}

export const PHYSICS = {
  gravity: new Vec3(0, -19, 0),
  tPrecision: 3e-4,
  islandUpdMinDisSq: 0.1,
  airAngularDamping: 0.99,
  /** Sphere. */
  frictionS: 0.01,
  /** 多边形（台面/库边）。 */
  frictionP: 0.15,
  restitution: {
    ball: 0.985,
    ground: 0.3,
    sidehard: 0.92,
    sidesoft: 0.45,
    tunnel: 0,
    pocket: 0.002,
    default: 0.5
  } satisfies RestitutionKeys
} as const;

type GravityVector = Vec3;

let cachedGravityDir: Vec3 | null = null;

export function getGravityDir(): GravityVector {
  return (cachedGravityDir ??= new Vec3().normalizeVector(PHYSICS.gravity));
}

export interface FrictionTarget {
  friction: number;
  restitution: number;
}

export function setBallFrictionAndRestitution(t: FrictionTarget): void {
  t.restitution = PHYSICS.restitution.ball;
  t.friction = PHYSICS.frictionS;
}

/** 库边/台面：标记旗标（ground/sidehard/sidesoft/tunnel/pocket，同名字段存在性）→ 恢复系数查表。 */
export function setPolyFrictionAndRestitution(t: { [key: string]: unknown; friction: number; restitution: number }): void {
  t.friction = PHYSICS.frictionP;
  const table = PHYSICS.restitution as RestitutionKeys;
  for (const key in table) {
    if ((t as { [key: string]: unknown })[key]) {
      t.restitution = table[key as keyof RestitutionKeys];
      return;
    }
  }
  t.restitution = table.default;
}
