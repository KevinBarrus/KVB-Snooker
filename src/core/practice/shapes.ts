import type { FrameSetup, PracticeOptions } from "../frame-setup.js";
import type { Simulator } from "../simulator/simulator.js";
import { practiceTable, type PracticeTable } from "./table-geometry.js";
import type { PracticeLayout } from "./shape-types.js";
import { sLayout, snakeLayout, tLayout, yLayout } from "./layout-reds.js";
import {
  clearanceLayout, doubleDragonLayout, fiveSpotsLayout, pyramidLayout, stapleLayout, xLayout
} from "./layout-mixed.js";

export const PRACTICE_SHAPE_IDS = [
  "snake", "s-shape", "t-shape", "y-shape", "staple",
  "x-shape", "pyramid", "double-dragon", "clearance", "five-spots"
] as const;

export type PracticeShapeId = typeof PRACTICE_SHAPE_IDS[number];

export interface PracticeShapeConfig {
  readonly setup: FrameSetup;
  readonly practice: PracticeOptions;
}

const LAYOUTS: Record<PracticeShapeId, (table: PracticeTable) => PracticeLayout> = {
  snake: snakeLayout,
  "s-shape": sLayout,
  "t-shape": tLayout,
  "y-shape": yLayout,
  staple: stapleLayout,
  "x-shape": xLayout,
  pyramid: pyramidLayout,
  "double-dragon": doubleDragonLayout,
  clearance: clearanceLayout,
  "five-spots": fiveSpotsLayout
};

export function makePracticeLayout(id: PracticeShapeId, table: PracticeTable): PracticeLayout {
  const builder = LAYOUTS[id];
  if (!builder) throw new Error(`Unknown practice shape: ${id}`);
  return builder(table);
}

function practiceOptionsFor(id: PracticeShapeId): PracticeOptions {
  if (id === "x-shape") return { cuePlacement: "d-area" };
  if (id === "five-spots") {
    return { cuePlacement: "anywhere", respotTargetBallNumber: 5, targetBallOn: 32, score: false };
  }
  if (id === "clearance") return { cuePlacement: "anywhere", score: false };
  return { cuePlacement: "anywhere" };
}

export function makePracticeShapeConfig(id: PracticeShapeId, simulator: Simulator): PracticeShapeConfig {
  const layout = makePracticeLayout(id, practiceTable(simulator));
  return {
    setup: {
      balls: layout.balls.map(ball => ({ index: ball.index, x: ball.x, z: ball.z, active: ball.active })),
      ballOn: layout.ballOn,
      inHand: 2,
      playerIndex: 0,
      scores: [0]
    },
    practice: practiceOptionsFor(id)
  };
}

export function makePracticeSetup(id: PracticeShapeId, simulator: Simulator): FrameSetup {
  return makePracticeShapeConfig(id, simulator).setup;
}
