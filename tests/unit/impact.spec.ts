import { describe, expect, it } from "vitest";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import type { ImpactEvent } from "../../src/core/simulator/impact.js";
import { MeshBody } from "../../src/core/physics/mesh-body.js";

function makeSim(): Simulator {
  const mesh = new MeshBody({ ground: {
    p: [-10, .88, -10, 10, .88, -10, 10, .88, 10, -10, .88, 10],
    q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
  } });
  mesh.id = "impact-test";
  return new Simulator(mesh, { ...DEFAULT_SCENE, ballSet: [0, 0, 0, 1, .3, 0] });
}
function shot(sim: Simulator, offset = 0): Float32Array {
  const r = sim.ballRadius + .005;
  return new Float32Array([-Math.sqrt(r * r - offset * offset), sim.spotY + offset, 0, 1, 0, 0, 20, .005]);
}

describe("Simulator impact observations", () => {
  it("publishes actual cue and ball impacts without changing world or result", () => {
    const observed = makeSim(), baseline = makeSim();
    const events: ImpactEvent[] = [];
    observed.onImpact(event => { expect(Object.isFrozen(event)).toBe(true); events.push(event); });
    observed.stroke(shot(observed)); baseline.stroke(shot(baseline));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "cue", speed: 20, tipHeight: 0 });
    for (let i = 0; i < 100; ++i) { observed.step(.0167); baseline.step(.0167); }
    expect(events.some(e => e.kind === "ball" && e.speed > 0)).toBe(true);
    expect(events.some(e => e.kind === "surface")).toBe(false);
    expect(observed.serialize()).toEqual(baseline.serialize());
    expect(observed.getResult()).toEqual(baseline.getResult());
  });

  it("keeps predictions silent and allows unsubscribe", () => {
    const sim = makeSim(), events: ImpactEvent[] = [];
    const off = sim.onImpact(event => events.push(event));
    const before = sim.serialize();
    sim.predict(shot(sim));
    expect(events).toEqual([]);
    expect(sim.serialize()).toEqual(before);
    off(); off();
    sim.stroke(shot(sim)); sim.step(.1);
    expect(events).toEqual([]);
  });

  it.each([-.01, .01])("reports actual signed tip offset %s", offset => {
    const sim = makeSim(), events: ImpactEvent[] = [];
    sim.onImpact(event => events.push(event));
    sim.stroke(shot(sim, offset));
    const event = events[0];
    expect(event.kind).toBe("cue");
    if (event.kind === "cue") expect(event.tipHeight).toBeCloseTo(offset / (sim.ballRadius + .005), 5);
  });
});
