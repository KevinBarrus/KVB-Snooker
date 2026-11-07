import type { PracticePoint } from "./table-geometry.js";

export interface PracticeBall {
  index: number;
  x: number;
  z: number;
  active: boolean;
}

export interface PracticeLayout {
  readonly balls: readonly PracticeBall[];
  readonly cue: PracticePoint;
  readonly ballOn: number;
}
