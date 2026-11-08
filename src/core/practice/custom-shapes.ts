import type { FrameSetup } from "../frame-setup.js";
import type { PracticeOptions } from "../frame-setup.js";
import type { Simulator } from "../simulator/simulator.js";
import { practiceTable } from "./table-geometry.js";

export const CUSTOM_SHAPE_LIMIT = 50;
export const CUSTOM_SHAPE_NAME_MAX = 30;
export const CUSTOM_SHAPE_RECYCLE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CustomShapeBall {
  readonly index: number;
  readonly x: number;
  readonly z: number;
}

export interface CustomShapesSnapshot {
  readonly active: readonly CustomShapeRecord[];
  readonly recycle: readonly CustomShapeRecord[];
}

export interface CustomShapeRecord {
  readonly id: string;
  readonly name: string;
  readonly balls: readonly CustomShapeBall[];
  readonly createdAt: number;
  readonly deletedAt: number | null;
}

export function normalizeShapeName(name: string): string {
  return name.trim();
}

export function isValidShapeName(name: string): boolean {
  const value = normalizeShapeName(name);
  return value.length >= 1 && value.length <= CUSTOM_SHAPE_NAME_MAX;
}

export function isCustomShapeExpired(record: CustomShapeRecord, now: number): boolean {
  return record.deletedAt !== null && record.deletedAt + CUSTOM_SHAPE_RECYCLE_MS <= now;
}

export function purgeExpiredShapes(records: readonly CustomShapeRecord[], now: number): CustomShapeRecord[] {
  return records.filter(record => !isCustomShapeExpired(record, now));
}

function isCustomShapeBall(value: unknown): value is CustomShapeBall {
  if (!value || typeof value !== "object") return false;
  const ball = value as Record<string, unknown>;
  return typeof ball.index === "number" && Number.isInteger(ball.index) && ball.index >= 1 && ball.index <= 21 &&
    typeof ball.x === "number" && Number.isFinite(ball.x) &&
    typeof ball.z === "number" && Number.isFinite(ball.z);
}

export function validateCustomShapeBalls(balls: readonly CustomShapeBall[]): boolean {
  const reds = balls.filter(ball => ball.index <= 15);
  const colours = new Set(balls.filter(ball => ball.index >= 16).map(ball => ball.index));
  if (reds.length > 15 || colours.size !== balls.filter(ball => ball.index >= 16).length) return false;
  for (let left = 0; left < balls.length; left++) {
    for (let right = left + 1; right < balls.length; right++) {
      if (Math.hypot(balls[left].x - balls[right].x, balls[left].z - balls[right].z) < 0.0525 - 1e-6) return false;
    }
  }
  return true;
}

/** 从 localStorage 等外部数据恢复一条记录；非法记录返回 null。 */
export function parseCustomShape(value: unknown): CustomShapeRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.name !== "string" || !isValidShapeName(record.name)) return null;
  if (!Array.isArray(record.balls) || !record.balls.every(isCustomShapeBall)) return null;
  const balls = record.balls.map(ball => ({ index: ball.index, x: ball.x, z: ball.z }));
  if (!validateCustomShapeBalls(balls)) return null;
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return null;
  if (record.deletedAt !== null && (typeof record.deletedAt !== "number" || !Number.isFinite(record.deletedAt))) return null;
  return {
    id: record.id,
    name: normalizeShapeName(record.name),
    balls,
    createdAt: record.createdAt,
    deletedAt: record.deletedAt === null ? null : record.deletedAt
  };
}

function findCueSpot(table: ReturnType<typeof practiceTable>, balls: readonly CustomShapeBall[],
  radius: number): { x: number; z: number } {
  const free = (point: { x: number; z: number }): boolean => balls.every(ball =>
    Math.hypot(ball.x - point.x, ball.z - point.z) >= 2 * radius - 1e-6);
  if (free(table.spots[0])) return { x: table.spots[0].x, z: table.spots[0].z };
  for (let x = table.minX; x <= table.maxX; x += .2) {
    for (let z = table.minZ; z <= table.maxZ; z += .2) {
      if (free({ x, z })) return { x, z };
    }
  }
  return table.spots[0];
}

export function toCustomShapeSetup(record: CustomShapeRecord, simulator: Simulator): FrameSetup {
  const table = practiceTable(simulator);
  const cue = findCueSpot(table, record.balls, simulator.ballRadius);
  const placed = new Map(record.balls.map(ball => [ball.index, ball]));
  const balls = table.spots.map((spot, index) => {
    const ball = placed.get(index);
    return { index, x: index === 0 ? cue.x : ball?.x ?? spot.x, z: index === 0 ? cue.z : ball?.z ?? spot.z,
      active: index === 0 || ball !== undefined };
  });
  return { balls, ballOn: 2, inHand: 2, playerIndex: 0, scores: [0] };
}

export function toCustomPracticeOptions(): PracticeOptions {
  return { cuePlacement: "anywhere", freeScoring: true };
}
