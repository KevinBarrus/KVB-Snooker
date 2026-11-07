import { describe, expect, it } from "vitest";
import { makePocketTable } from "../fixtures/table.js";
import { copyFrameSetup } from "../../src/core/frame-setup.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import {
  PRACTICE_SHAPE_IDS, makePracticeLayout, makePracticeSetup, type PracticeShapeId
} from "../../src/core/practice/shapes.js";
import { practiceTable } from "../../src/core/practice/table-geometry.js";
import { COLOUR_INDICES, RED_INDICES } from "../../src/core/practice/shape-utils.js";

function makeSimulator(): Simulator {
  return new Simulator(makePocketTable(), DEFAULT_SCENE);
}

const EXPECTED_REDS: Record<PracticeShapeId, number> = {
  snake: 15, "s-shape": 15, "t-shape": 15, "y-shape": 15, staple: 15,
  "x-shape": 15, pyramid: 15, "double-dragon": 15, clearance: 0, "five-spots": 0
};

describe("practice shape layouts", () => {
  it("generates every shape deterministically, inside the table and without overlaps", () => {
    const simulator = makeSimulator();
    const table = practiceTable(simulator);
    const diameter = 2 * table.ballRadius;
    for (const id of PRACTICE_SHAPE_IDS) {
      const first = makePracticeLayout(id, table);
      const second = makePracticeLayout(id, table);
      expect(second.balls.map(ball => [ball.index, ball.x, ball.z, ball.active]))
        .toEqual(first.balls.map(ball => [ball.index, ball.x, ball.z, ball.active]));
      expect(first.balls).toHaveLength(simulator.getBallCount());

      const active = first.balls.filter(ball => ball.active);
      for (const ball of active) {
        expect(ball.x).toBeGreaterThanOrEqual(table.minX - 1e-9);
        expect(ball.x).toBeLessThanOrEqual(table.maxX + 1e-9);
        expect(ball.z).toBeGreaterThanOrEqual(table.minZ - 1e-9);
        expect(ball.z).toBeLessThanOrEqual(table.maxZ + 1e-9);
      }
      for (let left = 0; left < active.length; left++) {
        for (let right = left + 1; right < active.length; right++) {
          const distance = Math.hypot(active[left].x - active[right].x, active[left].z - active[right].z);
          expect(distance).toBeGreaterThanOrEqual(diameter - 1e-6);
        }
      }
      expect(first.balls[0].active).toBe(true);
      expect(first.balls[0].x).toBeCloseTo(first.cue.x, 9);
      expect(first.balls[0].z).toBeCloseTo(first.cue.z, 9);
    }
  });

  it("keeps colours on their standard spots and reds at the prescribed counts", () => {
    const simulator = makeSimulator();
    const table = practiceTable(simulator);
    for (const id of PRACTICE_SHAPE_IDS) {
      const layout = makePracticeLayout(id, table);
      const reds = layout.balls.filter(ball => ball.active && RED_INDICES.includes(ball.index));
      expect(reds).toHaveLength(EXPECTED_REDS[id]);
      const colours = layout.balls.filter(ball => ball.active && (COLOUR_INDICES as readonly number[]).includes(ball.index));
      const expectedColours: number[] = id === "five-spots" ? [COLOUR_INDICES[3]] : [...COLOUR_INDICES];
      expect(colours.map(ball => ball.index)).toEqual(expectedColours);
      for (const ball of colours) {
        expect(ball.x).toBeCloseTo(table.spots[ball.index].x, 9);
        expect(ball.z).toBeCloseTo(table.spots[ball.index].z, 9);
      }
    }
  });

  it("builds a valid frame setup for every shape", () => {
    const simulator = makeSimulator();
    for (const id of PRACTICE_SHAPE_IDS) {
      const setup = makePracticeSetup(id, simulator);
      const copied = copyFrameSetup(setup, simulator.getBallCount(), 1);
      expect(copied.balls).toHaveLength(simulator.getBallCount());
      expect(copied.inHand).toBe(2);
      expect(copied.playerIndex).toBe(0);
      expect(copied.scores).toEqual([0]);
      expect(copied.balls.filter(ball => ball.active && ball.index === 0)).toHaveLength(1);
    }
    expect(makePracticeSetup("clearance", simulator).ballOn).toBe(4);
    expect(makePracticeSetup("five-spots", simulator).ballOn).toBe(32);
    expect(makePracticeSetup("snake", simulator).ballOn).toBe(2);
  });

  it("places the snake reds on the centre line and the T crossbar symmetrically", () => {
    const simulator = makeSimulator();
    const table = practiceTable(simulator);
    const snake = makePracticeLayout("snake", table);
    const snakeReds = snake.balls.filter(ball => ball.active && RED_INDICES.includes(ball.index));
    expect(snakeReds.every(ball => Math.abs(ball.z) < 1e-9)).toBe(true);

    const tShape = makePracticeLayout("t-shape", table);
    const pink = table.spots[20];
    const tReds = tShape.balls.filter(ball => ball.active && RED_INDICES.includes(ball.index));
    const left = tReds.filter(ball => ball.z > 0).map(ball => +(ball.z - pink.z).toFixed(6)).sort((a, b) => a - b);
    const right = tReds.filter(ball => ball.z < 0).map(ball => +(pink.z - ball.z).toFixed(6)).sort((a, b) => a - b);
    expect(left).toEqual(right);
  });

  it("keeps the double-dragon rows parallel and offset by half a ball", () => {
    const simulator = makeSimulator();
    const table = practiceTable(simulator);
    const layout = makePracticeLayout("double-dragon", table);
    const reds = layout.balls.filter(ball => ball.active && RED_INDICES.includes(ball.index));
    const upper = reds.filter(ball => ball.z > 0).sort((a, b) => a.x - b.x);
    const lower = reds.filter(ball => ball.z < 0).sort((a, b) => a.x - b.x);
    expect(upper).toHaveLength(8);
    expect(lower).toHaveLength(7);
    expect(upper.every(ball => Math.abs(ball.z - upper[0].z) < 1e-9)).toBe(true);
    expect(lower.every(ball => Math.abs(ball.z - lower[0].z) < 1e-9)).toBe(true);
    const gap = upper[0].z - lower[0].z;
    expect(gap).toBeCloseTo(1.5 * 2 * table.ballRadius, 9);
    expect(lower[0].x - upper[0].x).toBeCloseTo(table.ballRadius, 9);
  });
});
