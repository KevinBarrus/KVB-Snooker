import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { BodySphere } from "../../src/core/physics/ball.js";
import { MeshBody } from "../../src/core/physics/mesh-body.js";
import { ContactSP } from "../../src/core/physics/sp-contact.js";
import { Solver } from "../../src/core/physics/solver.js";
import { WorldClient } from "../../src/core/physics/world-client.js";
import { PCOL_TABLE_TUNING, TABLE_TUNING } from "../../src/core/physics/table-tuning.js";

const radius = 0.02625;

function withTuning<T>(settings: typeof TABLE_TUNING, run: () => T): T {
  const previous = { ...TABLE_TUNING };
  Object.assign(TABLE_TUNING, settings);
  try { return run(); }
  finally { Object.assign(TABLE_TUNING, previous); }
}

function makeTable(flag = "ground"): MeshBody {
  return new MeshBody({
    ground: {
      p: [-100, 0, -100, 100, 0, -100, 100, 0, 100, -100, 0, 100],
      q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: [flag] }]
    }
  });
}

function markDirty(ball: BodySphere): void {
  ball.vProp_dirty = true;
  ball.wProp_dirty = true;
  ball.__vStateDirty = true;
  ball.vChangedCount++;
}

function roll(): { distance: number; spinAfterSecond: number; stopped: boolean } {
  const world = new WorldClient();
  world.stepSize = 0.0167;
  world.setMeshBody(makeTable());
  const ball = new BodySphere(radius, 1.5, 0, radius, 0);
  world.addBall(ball);
  world.reset();
  ball.v.set(3, 0, 0);
  ball.w.set(0, 100, -3 / radius);
  markDirty(ball);
  let spinAfterSecond = 0;
  for (let step = 0; step < 2400 && !ball.asleep; step++) {
    world.step(0.0167);
    if (step === 59) spinAfterSecond = ball.w.y;
    expect(Number.isFinite(ball.position.x + ball.w.y)).toBe(true);
  }
  return { distance: ball.position.x, spinAfterSecond, stopped: ball.asleep };
}

function bounce(spin: number): Vec3 {
  const world = new WorldClient();
  world.stepSize = 0.0167;
  const ball = new BodySphere(radius, 1.5);
  ball.restitution = 0.985;
  ball.friction = 0.01;
  ball.v.set(3, 0, 0);
  ball.w.set(0, spin, 0);
  markDirty(ball);
  const poly = makeTable("sidehard").groups[0].polys[0];
  const contact = new ContactSP(null, 0);
  contact.resetPendingWithToiPeneNormal(ball, poly, 0, 0, new Vec3(-1, 0, 0));
  contact.startResting();
  new Solver().solveContact(contact);
  return ball.v.clone();
}

describe("table tuning", () => {
  it("rolls farther and retains more sidespin while still coming to rest", () => {
    const baseline = withTuning(PCOL_TABLE_TUNING, roll);
    const tuned = roll();
    expect(baseline.stopped && tuned.stopped).toBe(true);
    expect(tuned.distance).toBeGreaterThan(baseline.distance);
    expect(tuned.spinAfterSecond).toBeGreaterThan(baseline.spinAfterSecond);
    console.table({ baseline, tuned });
  });

  it("retains more rebound speed and transfers strong sidespin symmetrically", () => {
    const baseline = withTuning(PCOL_TABLE_TUNING, () => bounce(300));
    const left = bounce(300);
    const right = bounce(-300);
    const center = bounce(0);
    expect(Math.abs(left.x)).toBeGreaterThan(Math.abs(baseline.x));
    expect(Math.abs(left.z)).toBeGreaterThan(Math.abs(baseline.z));
    expect(left.x).toBeCloseTo(right.x, 6);
    expect(left.z).toBeCloseTo(-right.z, 6);
    expect(center.z).toBeCloseTo(0, 6);
    expect(Math.abs(center.x)).toBeLessThan(3);
    console.table({ baseline, left, right, center });
  });

  it.each(["sidesoft", "tunnel", "pocket"])("preserves %s material and resets pooled rolling friction", flag => {
    const table = makeTable(flag);
    const poly = table.groups[0].polys[0];
    const expected = { sidesoft: 0.45, tunnel: 0, pocket: 0.002 };
    expect(poly.friction).toBe(0.15);
    expect(poly.restitution).toBe(expected[flag as keyof typeof expected]);
    const ball = new BodySphere(radius, 1.5);
    const contact = new ContactSP(null, 0);
    contact.resetPendingWithToiPeneNormal(ball, makeTable().ground!, 0, 0, new Vec3(0, 1, 0));
    contact.startResting();
    expect(contact.rollingFriction).toBe(TABLE_TUNING.clothRollingFriction);
    contact.resetPendingWithToiPeneNormal(ball, poly, 0, 0, new Vec3(0, 1, 0));
    contact.startResting();
    expect(contact.rollingFriction).toBe(0.013);
  });
});
