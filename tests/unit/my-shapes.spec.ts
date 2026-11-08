import { describe, expect, it } from "vitest";
import { makePocketTable } from "../fixtures/table.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import {
  CUSTOM_SHAPE_LIMIT, CUSTOM_SHAPE_RECYCLE_MS, isCustomShapeExpired, isValidShapeName,
  normalizeShapeName, parseCustomShape, toCustomPracticeOptions, toCustomShapeSetup, validateCustomShapeBalls,
  type CustomShapeRecord
} from "../../src/core/practice/custom-shapes.js";
import { MyShapesStore, type KeyValueStorage } from "../../src/app-my-shapes.js";

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function record(id: string, name = id, now = 1000): CustomShapeRecord {
  return { id, name, balls: [{ index: 1, x: 0, z: -0.55 }], createdAt: now, deletedAt: null };
}

function makeStore(now: () => number = () => 1000): MyShapesStore {
  let next = 0;
  return new MyShapesStore(new MemoryStorage(), now, () => `shape-${++next}`);
}

function makeCustomGame(): GameSession {
  const simulator = new Simulator(makePocketTable(), DEFAULT_SCENE);
  const shape: CustomShapeRecord = {
    id: "test", name: "测试", balls: [
      { index: 1, x: 0, z: -0.55 },
      { index: 19, x: 0.1, z: 0.3 }
    ],
    createdAt: 0, deletedAt: null
  };
  return new GameSession(simulator, "practice", {
    setup: toCustomShapeSetup(shape, simulator), practice: toCustomPracticeOptions()
  });
}

function settle(game: GameSession): void {
  for (let step = 0; step < 2000 && game.state === GAME_STATE.SIMULATING; ++step) game.step(.1);
  expect(game.state).toBe(GAME_STATE.READY);
}

function pot(game: GameSession, index: number): void {
  const simulator = game.simulator;
  simulator.respotIndexXYZ(0, 0, simulator.spotY, .15);
  simulator.respotIndexXYZ(index, 0, simulator.spotY, -.55);
  simulator.reset(false, true);
  const vars = makeStrokeVars(simulator, { dx: 0, dy: 0, dz: -1, fbSpin: -.99, powerFactor: .1, priority: 1 });
  expect(game.stroke(game.context.playerIndex, vars)).toBe(true);
  settle(game);
}

describe("custom shape storage", () => {
  it("validates names and stored records", () => {
    expect(normalizeShapeName("  我的球形  ")).toBe("我的球形");
    expect(isValidShapeName("我的球形")).toBe(true);
    expect(isValidShapeName("   ")).toBe(false);
    expect(isValidShapeName("x".repeat(31))).toBe(false);
    expect(isValidShapeName("x".repeat(30))).toBe(true);
    expect(validateCustomShapeBalls([{ index: 1, x: 0, z: 0 }, { index: 2, x: 0, z: 0 }])).toBe(false);
    expect(parseCustomShape(record("a"))?.name).toBe("a");
    expect(parseCustomShape({ ...record("a"), balls: [] })).not.toBeNull();
    expect(parseCustomShape({ ...record("a"), name: " " })).toBeNull();
  });

  it("creates, caps, deletes, restores, renames and permanently purges", () => {
    const store = makeStore();
    for (let index = 0; index < CUSTOM_SHAPE_LIMIT; index++) {
      expect(store.create(`球形 ${index}`, []).ok).toBe(true);
    }
    expect(store.create("第 51 个", []).reason).toBe("full");
    const first = store.load().active[0];
    expect(store.rename(first.id, "  重命名  ")).toBe(true);
    expect(store.load().active.some(item => item.name === "重命名")).toBe(true);
    expect(store.remove(first.id)).toBe(true);
    expect(store.load().active).toHaveLength(CUSTOM_SHAPE_LIMIT - 1);
    expect(store.load().recycle).toHaveLength(1);
    expect(store.create("腾出的位置", []).ok).toBe(true);
    expect(store.create("又一个", []).reason).toBe("full");
    const recycled = store.load().recycle[0];
    expect(store.restore(recycled.id)).toBe("full");
    expect(store.remove(store.load().active[0].id)).toBe(true);
    expect(store.restore(recycled.id)).toBe("ok");
    expect(store.load().active.some(item => item.id === recycled.id)).toBe(true);
    expect(store.purge(recycled.id)).toBe(true);
    expect(store.load().active.some(item => item.id === recycled.id)).toBe(false);
  });

  it("purges recycle entries after 30 days and keeps the original creation order on restore", () => {
    const storage = new MemoryStorage();
    let now = 1000;
    const store = new MyShapesStore(storage, () => now, () => "old");
    const first = store.create("旧球形", []).record!;
    expect(store.remove(first.id)).toBe(true);
    expect(isCustomShapeExpired({ ...first, deletedAt: 1000 }, 1000 + CUSTOM_SHAPE_RECYCLE_MS - 1)).toBe(false);
    const later = new MyShapesStore(storage, () => 1000 + CUSTOM_SHAPE_RECYCLE_MS, () => "new");
    expect(later.load().recycle).toHaveLength(0);
    now = 1000 + CUSTOM_SHAPE_RECYCLE_MS;
    expect(store.load().recycle).toHaveLength(0);
  });

  it("converts a record into a practice setup with cue and inactive unused balls", () => {
    const simulator = new Simulator(makePocketTable(), DEFAULT_SCENE);
    const setup = toCustomShapeSetup(record("a"), simulator);
    expect(setup.balls).toHaveLength(simulator.getBallCount());
    expect(setup.balls.filter(ball => ball.active).map(ball => ball.index)).toEqual([0, 1]);
    expect(setup.inHand).toBe(2);
    expect(toCustomPracticeOptions().freeScoring).toBe(true);
    expect(toCustomPracticeOptions().cuePlacement).toBe("anywhere");
  });
});

describe("custom practice free scoring", () => {
  it("adds ball values to score and break, and restores them on reset", () => {
    const game = makeCustomGame();
    game.context.inHand = 0;
    pot(game, 1);
    expect(game.result).toEqual({ score: 1, foulCode: 0 });
    expect(game.players[0].pts).toBe(1);
    expect(game.players[0].brk).toBe(1);
    pot(game, 19);
    expect(game.result).toEqual({ score: 5, foulCode: 0 });
    expect(game.players[0].pts).toBe(6);
    expect(game.players[0].brk).toBe(6);
    expect(game.restorePreviousShot(0)).toBe(true);
    expect(game.players[0].pts).toBe(1);
    expect(game.players[0].brk).toBe(1);
  });

  it("clears the break on a shot that pots nothing", () => {
    const game = makeCustomGame();
    game.context.inHand = 0;
    pot(game, 1);
    expect(game.players[0].brk).toBe(1);
    const vars = makeStrokeVars(game.simulator, { dx: 0, dy: 0, dz: 1, fbSpin: 0, powerFactor: .1, priority: 1 });
    expect(game.stroke(0, vars)).toBe(true);
    settle(game);
    expect(game.players[0].brk).toBe(0);
    expect(game.players[0].pts).toBe(1);
  });
});
