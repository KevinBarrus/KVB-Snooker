import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { makePocketTable } from "../fixtures/table.js";

function makeSim(): Simulator {
  return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, .5, .5] });
}

function shot(sim: Simulator, speed = 40): Float32Array {
  const p = sim.getCueBallPosition();
  return new Float32Array([p.x - sim.ballRadius - .005, p.y, p.z, 1, 0, 0, speed, .005]);
}

function run(sim: Simulator): void { for (let i = 0; i < 400 && sim.nAwakened; ++i) sim.step(.0167); }

describe("real cushion evidence", () => {
  it("records ordinary cushions with audio disabled and never counts ground", () => {
    const sim = makeSim();
    expect(sim.getCushionEvidence()).toBeNull();
    sim.stroke(shot(sim));
    sim.step(.0167);
    expect(sim.getCushionEvidence()?.contacts).toEqual([]);
    run(sim);
    expect(sim.getCushionEvidence()?.contacts.some(c => c.ballIndex === 0 && c.kind === "cushion")).toBe(true);
  });

  it("excludes predictions, preserves observations and clears explicit restores", () => {
    const sim = makeSim();
    sim.stroke(shot(sim)); run(sim);
    const before = sim.getCushionEvidence();
    expect(before?.contacts.length).toBeGreaterThan(0);
    const saved = sim.serialize();
    sim.predict(shot(sim));
    expect(sim.serialize()).toEqual(saved);
    expect(sim.getCushionEvidence()).toEqual(before);
    expect(sim.getCushionEvidence()?.contacts[0]).not.toBe(before?.contacts[0]);
    sim.restore(saved);
    expect(sim.getCushionEvidence()).toBeNull();
    sim.stroke(shot(sim, 0));
    expect(sim.getCushionEvidence()?.contacts).toEqual([]);
    sim.reset(false, true);
    expect(sim.getCushionEvidence()).toBeNull();
  });

  it("stationary cushion touching does not meet the collision obligation", () => {
    const sim = makeSim();
    sim.respotIndexXYZ(0, 1.8 - sim.ballRadius, sim.spotY, 0);
    sim.reset(false, true);
    sim.stroke(shot(sim, 0)); run(sim);
    expect(sim.getCushionEvidence()?.contacts).toEqual([]);
  });

  it("observing sounds changes neither the world nor rule evidence", () => {
    const silent = makeSim(), audible = makeSim();
    audible.onImpact(() => {});
    silent.stroke(shot(silent)); audible.stroke(shot(audible));
    run(silent); run(audible);
    expect(silent.serialize()).toEqual(audible.serialize());
    expect(silent.getCushionEvidence()).toEqual(audible.getCushionEvidence());
  });

  it("records object-ball cushions and distinguishes soft jaws", () => {
    const mesh = makePocketTable();
    for (const poly of mesh.getGroupByName("side")!.polys) { poly.sidehard = false; poly.sidesoft = true; }
    const sim = new Simulator(mesh, { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, 1, 0] });
    sim.stroke(shot(sim)); run(sim);
    expect(sim.getCushionEvidence()?.contacts.some(c => c.ballIndex === 1 && c.kind === "jaw")).toBe(true);
    expect(sim.getCushionEvidence()?.contacts.some(c => c.kind === "cushion")).toBe(false);
  });
});
