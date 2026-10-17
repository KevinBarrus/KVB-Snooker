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
}

export interface PredictionContext {
  impactV1: Vec3;
  impactOccured: boolean;
}

// PCOL L9270-9277
export function makeShotResult(): ShotResult {
  return { nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] };
}
