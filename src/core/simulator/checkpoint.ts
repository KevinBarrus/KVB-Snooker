import { readResting, type RestingIslandState } from "../physics/resting-state.js";
import { choice, finite, integer, list, nullable, record, requireCheckpoint, text } from "../checkpoint-validation.js";
import type { SerialData, ShotResult } from "./shot-result.js";
import type { ContactEvidence, CushionEvidence } from "./contact-evidence.js";

export interface BallResidual {
  readonly rollingPower: number;
  readonly rollingDirection: readonly number[];
  readonly penetration: number;
  readonly penetrationOffset: readonly number[];
}

export interface SimulatorCheckpoint {
  readonly format: 1;
  readonly configuration: string;
  readonly world: SerialData;
  readonly accumulatorSeconds: number;
  readonly resting: readonly RestingIslandState[];
  readonly residuals: readonly BallResidual[];
  readonly poses: readonly (readonly number[])[];
  readonly result: ShotResult;
  readonly contacts: ContactEvidence | null;
  readonly cushions: CushionEvidence | null;
}

export function readSerialData(value: unknown, mbid: string, count: number): SerialData {
  const data = record(value);
  requireCheckpoint(text(data.mbid) === mbid);
  const balls = list(data.balls, item => finite(item), count * 2, count * 38);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    integer(balls[offset]);
    const active = choice(balls[offset + 1], [0, 1]);
    if (active) {
      requireCheckpoint(balls[offset + 36] === 1 && balls[offset + 37] === 0);
      for (const slot of [13, 20, 25, 33, 35]) choice(balls[offset + slot], [0, 1]);
      for (const slot of [5, 14]) integer(balls[offset + slot]);
      for (const slot of [12, 18, 24, 34]) finite(balls[offset + slot], 0);
      for (const slot of [6, 7, 8, 21, 22, 23]) requireCheckpoint(balls[offset + slot] === 0);
    }
    if (active) requireCheckpoint(Math.abs(Math.hypot(...balls.slice(offset + 29, offset + 33)) - 1) < .001);
    offset += active ? 38 : 2;
  }
  requireCheckpoint(offset === balls.length);
  return { mbid, evolution: integer(data.evolution), balls };
}

export function readSimulatorCheckpoint(value: unknown, configuration: string, mbid: string, count: number, polygonCount: number): SimulatorCheckpoint {
  const data = record(value);
  requireCheckpoint(data.format === 1 && data.configuration === configuration);
  const index = (item: unknown) => integer(item, 0, count - 1);
  const indices = (items: unknown) => list(items, index);
  const result = record(data.result);
  const contacts = nullable(data.contacts, item => {
    const contact = record(item);
    return { touchingIndices: indices(contact.touchingIndices), firstContactIndices: indices(contact.firstContactIndices),
      pushedIndices: indices(contact.pushedIndices) };
  });
  const cushions = nullable(data.cushions, item => ({ contacts: list(record(item).contacts, entry => {
    const contact = record(entry);
    return { ballIndex: index(contact.ballIndex), kind: choice(contact.kind, ["cushion", "jaw"]),
      x: finite(contact.x), z: finite(contact.z) };
  }) }));
  const poses = list(data.poses, item => {
    const pose = list(item, number => finite(number), 7, 7);
    requireCheckpoint(Math.abs(Math.hypot(...pose.slice(3)) - 1) < .001);
    return pose;
  }, count, count);
  const residuals = list(data.residuals, item => {
    const residual = record(item);
    return { rollingPower: finite(residual.rollingPower, 0), penetration: finite(residual.penetration),
      rollingDirection: list(residual.rollingDirection, component => finite(component), 3, 3),
      penetrationOffset: list(residual.penetrationOffset, component => finite(component), 3, 3) };
  }, count, count);
  const world = readSerialData(data.world, mbid, count);
  let offset = 0;
  const activeIds = new Set<number>();
  for (const [index, pose] of poses.entries()) {
    requireCheckpoint(world.balls[offset] === polygonCount + index);
    const active = world.balls[offset + 1] === 1;
    if (active) activeIds.add(world.balls[offset]);
    if (active) requireCheckpoint(pose.every((number, index) => number === world.balls[offset + 26 + index]));
    offset += active ? 38 : 2;
  }
  const resting = readResting(data.resting, count, polygonCount);
  requireCheckpoint(resting.every(island => island.contacts.every(contact =>
    activeIds.has(contact.idi) && (!contact.isSS || activeIds.has(contact.idj)))));
  return { format: 1, configuration, world, poses, residuals, resting, accumulatorSeconds: finite(data.accumulatorSeconds, 0, .0167),
    result: { nKissed: integer(result.nKissed), firstKissIndex: index(result.firstKissIndex),
      pottedIndices: indices(result.pottedIndices), outOfBoundsIndices: indices(result.outOfBoundsIndices) }, contacts, cushions };
}
