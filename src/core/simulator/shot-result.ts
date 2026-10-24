import type { Vec3 } from "../math/vec3.js";

export type StrokeVars = Float32Array;

export interface ShotResult {
  nKissed: number;
  firstKissIndex: number;
  pottedIndices: number[];
  outOfBoundsIndices: number[];
}

export interface SerialData {
  balls: number[];
  mbid: string;
  evolution: number;
}

export interface BallView {
  index: number;
  number: number;
  active: boolean;
  position: Vec3;
  async: boolean;
  readonly renderPosition: Readonly<{ x: number; y: number; z: number }>;
  readonly renderOrientation: Readonly<{ x: number; y: number; z: number; w: number }>;
}

export interface PredictionContext {
  impactV1: Vec3;
  impactOccured: boolean;
  readonly p0: Readonly<{ x: number; y: number; z: number }>;
  readonly p1: Readonly<{ x: number; y: number; z: number }>;
  readonly cue: Readonly<{ x: number; y: number; z: number }>;
  readonly cueVSq: number;
  readonly p2: Readonly<{ x: number; y: number; z: number }>;
  readonly target: Readonly<{ x: number; y: number; z: number }>;
  readonly targetVSq: number;
  readonly targetNumber: number;
  readonly hasImpactTarget: boolean;
}

// PCOL L9270-9277
export function makeShotResult(): ShotResult {
  return { nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] };
}
