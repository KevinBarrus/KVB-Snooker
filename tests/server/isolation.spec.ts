import { afterEach, describe, expect, it } from "vitest";
import { Body } from "../../src/core/physics/body.js";
import { getGravityDir } from "../../src/core/physics/constants.js";
import { TABLE_TUNING } from "../../src/core/physics/table-tuning.js";
import { SeededRandom, setCoreRandom } from "../../src/core/rng.js";
import { GAME_STATE, GameSession } from "../../src/core/game.js";
import type { Simulator } from "../../src/core/simulator/simulator.js";
import type { SerialData } from "../../src/core/simulator/shot-result.js";
import { AIController } from "../../src/core/ai/task-pipeline.js";
import { RouteCache, sharedRouteCache, type AIRoute } from "../../src/core/ai/route-cache.js";
import { AI_PROFILES } from "../../src/core/ai/profiles.js";
import { createGameView } from "../../src/core/ai/play-area.js";
import {
  makeSimulator, makeStrokeVarsFor, settleSimulator, takeOverDecision, advanceToSettled, makeTestRoom, TEST_BALL_SET
} from "./helpers.js";

afterEach(() => { setCoreRandom(null); });

const RULES_CONTEXT = { ballOn: 2, inHand: 0 } as const;

interface RoomSnapshot {
  readonly world: SerialData;
  readonly state: number;
  readonly playerIndex: number;
  readonly ballOn: number;
  readonly inHand: 0 | 1 | 2;
  readonly scores: readonly number[];
  readonly result: { readonly score: number; readonly foulCode: number };
}

interface ShotIntent {
  readonly dx: number;
  readonly dz: number;
  readonly speed: number;
  readonly sideOffset?: number;
}

const SCRIPT: readonly ShotIntent[] = [
  { dx: 1, dz: 0.1, speed: 8 },
  { dx: -0.4, dz: 1, speed: 6, sideOffset: 0.004 },
  { dx: -1, dz: 0.3, speed: 9 },
  { dx: 0, dz: -1, speed: 5, sideOffset: -0.004 },
  { dx: 0.8, dz: 0.8, speed: 7 },
  { dx: -0.8, dz: -0.6, speed: 10 }
];

function makeGame(): GameSession {
  const sim = makeSimulator(TEST_BALL_SET);
  settleSimulator(sim);
  return new GameSession(sim, "single-play", { players: ["USER", "USER"], ruleset: "classic" });
}

function capture(game: GameSession): RoomSnapshot {
  const context = game.context;
  return {
    world: game.simulator.serialize(),
    state: game.state,
    playerIndex: context.playerIndex,
    ballOn: context.ballOn,
    inHand: context.inHand,
    scores: [game.getScore(0), game.getScore(1)],
    result: { score: game.result.score, foulCode: game.result.foulCode }
  };
}

/** 经典规则下，红球入袋后 ballOn=252；服务器原型没有提名命令，脚本显式提名首个彩球。 */
function nominateColourIfRequired(game: GameSession): void {
  if (game.context.ballOn !== 252 && !game.freeBallAvailable) return;
  const index = game.context.playerIndex;
  const colour = game.simulator.getBalls().find(ball => ball.active && ball.number > 1);
  if (colour) game.nominate(index, colour.index);
}

function startShot(game: GameSession, intent: ShotIntent): void {
  takeOverDecision(game);
  if (game.finished) return;
  nominateColourIfRequired(game);
  const index = game.context.playerIndex;
  const vars = makeStrokeVarsFor(game.simulator, intent);
  expect(game.stroke(index, vars)).toBe(true);
}

function settleGame(game: GameSession): void {
  advanceToSettled(game, 0.05);
  expect(game.state).not.toBe(GAME_STATE.SIMULATING);
}

function playSolo(): readonly RoomSnapshot[] {
  const game = makeGame();
  const snapshots: RoomSnapshot[] = [];
  for (const intent of SCRIPT) {
    startShot(game, intent);
    settleGame(game);
    snapshots.push(capture(game));
  }
  return snapshots;
}

/** 交替推进：两张台面轮流 step，模拟同一进程里先后服务两个房间的物理步进。 */
function playInterleaved(): readonly (readonly RoomSnapshot[])[] {
  const games = [makeGame(), makeGame()];
  const snapshots: RoomSnapshot[][] = [[], []];
  for (const intent of SCRIPT) {
    for (const game of games) startShot(game, intent);
    let guard = 0;
    while (games.some(game => game.state === GAME_STATE.SIMULATING) && guard++ < 20000) {
      for (const game of games) if (game.state === GAME_STATE.SIMULATING) game.step(0.05);
    }
    expect(guard).toBeLessThan(20000);
    games.forEach((game, index) => {
      expect(game.state).not.toBe(GAME_STATE.SIMULATING);
      snapshots[index].push(capture(game));
    });
  }
  return snapshots;
}

function findRoute(ai: AIController, sim: Simulator): AIRoute {
  const view = createGameView(sim);
  for (let count = 0; count < 5000; ++count) {
    const route = ai.step(view, sim);
    if (route) return { ...route };
  }
  throw new Error("AI route pipeline failed to finish");
}

function aiRouteWithSeed(seed: number, deps: { routeCache?: RouteCache } = {}): AIRoute {
  setCoreRandom(new SeededRandom(seed));
  const sim = makeSimulator();
  settleSimulator(sim);
  const ai = new AIController(AI_PROFILES.HARD, deps);
  ai.checkRestart(sim, RULES_CONTEXT);
  return findRoute(ai, sim);
}

describe("联机房间隔离审计（架构 §4.8 / 原型设计 §7）", () => {
  it("真实 Simulator+GameSession：两房间交替推进与各自单独推进逐位一致", () => {
    const solo = playSolo();
    const interleaved = playInterleaved();
    expect(interleaved).toHaveLength(2);
    for (let room = 0; room < 2; ++room) {
      for (let step = 0; step < solo.length; ++step) {
        expect(interleaved[room][step]).toEqual(solo[step]);
      }
    }
    expect(solo).toHaveLength(SCRIPT.length);
    expect(solo[0].world.mbid).toBe("six-pocket-test-table");
    // 至少证明不是空跑：每一步之后世界状态与上一杆不同。
    expect(solo.some((snapshot, index) => index > 0 &&
      JSON.stringify(snapshot.world) !== JSON.stringify(solo[index - 1].world))).toBe(true);
  });

  it("默认 AIController 共享全局 coreRandom：对手先搜索会改变本控制器路线", () => {
    const seed = 42;
    const soloRoute = aiRouteWithSeed(seed, { routeCache: new RouteCache() });
    setCoreRandom(new SeededRandom(seed));
    const simA = makeSimulator();
    settleSimulator(simA);
    const aiA = new AIController(AI_PROFILES.HARD, { routeCache: new RouteCache() });
    aiA.checkRestart(simA, RULES_CONTEXT);
    findRoute(aiA, simA);
    const simB = makeSimulator();
    settleSimulator(simB);
    const aiB = new AIController(AI_PROFILES.HARD, { routeCache: new RouteCache() });
    aiB.checkRestart(simB, RULES_CONTEXT);
    const sharedRoute = findRoute(aiB, simB);
    expect(sharedRoute).not.toEqual(soloRoute);
  });

  it("物理步进与球体序列化不消费 coreRandom；非序列化 Body 的兜底路径才消耗", () => {
    let draws = 0;
    setCoreRandom({ next: () => { draws++; return 0.5; } });
    const sim = makeSimulator();
    settleSimulator(sim);
    const game = new GameSession(sim, "single-play", { players: ["USER", "USER"], ruleset: "classic" });
    game.stroke(0, makeStrokeVarsFor(sim, { dx: 1, dz: 0, speed: 5 }));
    advanceToSettled(game, 0.05);
    sim.serialize();
    expect(draws).toBe(0);

    let fallbackDraws = 0;
    setCoreRandom({ next: () => { fallbackDraws++; return 0.5; } });
    const body = new Body(1);
    body.serializable = false;
    const target: number[] = [];
    body.serialize(target);
    expect(fallbackDraws).toBe(1);
    expect(target[0]).toBeLessThan(0);
  });

  it("默认 AIController 共享 sharedRouteCache：另一控制器 checkRestart 会清空路线", () => {
    const sim = makeSimulator();
    settleSimulator(sim);
    const ai = new AIController(AI_PROFILES.HARD);
    ai.checkRestart(sim, RULES_CONTEXT);
    expect(findRoute(ai, sim)).toBeDefined();
    expect(sharedRouteCache.length).toBeGreaterThan(0);

    const otherSim = makeSimulator();
    settleSimulator(otherSim);
    otherSim.reset(false, true);
    new AIController(AI_PROFILES.HARD).checkRestart(otherSim, RULES_CONTEXT);
    expect(sharedRouteCache.length).toBe(0);
  });

  it("修复后每房间独立 RouteCache：另一控制器重启不清空本房间路线", () => {
    const cacheA = new RouteCache();
    const simA = makeSimulator();
    settleSimulator(simA);
    const aiA = new AIController(AI_PROFILES.HARD, { routeCache: cacheA });
    aiA.checkRestart(simA, RULES_CONTEXT);
    expect(findRoute(aiA, simA)).toBeDefined();
    const before = Array.from({ length: cacheA.length }, (_, index) => ({ ...cacheA.getAtIndex(index) }));
    expect(before.length).toBeGreaterThan(0);

    const otherSim = makeSimulator();
    settleSimulator(otherSim);
    otherSim.reset(false, true);
    const aiB = new AIController(AI_PROFILES.HARD, { routeCache: new RouteCache() });
    aiB.checkRestart(otherSim, RULES_CONTEXT);
    const after = Array.from({ length: cacheA.length }, (_, index) => ({ ...cacheA.getAtIndex(index) }));
    expect(after).toEqual(before);
  });

  it("修复后每房间独立随机源：两 AI 交替 step 与各自单独 step 路线完全相同", () => {
    const seedA = 42;
    const seedB = 7;
    function makeIndependent(seed: number): { ai: AIController; sim: Simulator; view: ReturnType<typeof createGameView> } {
      const sim = makeSimulator();
      settleSimulator(sim);
      const seeded = new SeededRandom(seed);
      const ai = new AIController(AI_PROFILES.HARD, { routeCache: new RouteCache(), random: () => seeded.next() });
      ai.checkRestart(sim, RULES_CONTEXT);
      return { ai, sim, view: createGameView(sim) };
    }
    const a = makeIndependent(seedA);
    const b = makeIndependent(seedB);
    let routeA: AIRoute | null = null;
    let routeB: AIRoute | null = null;
    for (let count = 0; count < 5000 && (!routeA || !routeB); ++count) {
      if (!routeA) { const current = a.ai.step(a.view, a.sim); if (current) routeA = { ...current }; }
      if (!routeB) { const current = b.ai.step(b.view, b.sim); if (current) routeB = { ...current }; }
    }
    const soloA = ((): AIRoute => {
      const controller = makeIndependent(seedA);
      return findRoute(controller.ai, controller.sim);
    })();
    const soloB = ((): AIRoute => {
      const controller = makeIndependent(seedB);
      return findRoute(controller.ai, controller.sim);
    })();
    expect(routeA).toEqual(soloA);
    expect(routeB).toEqual(soloB);
  });

  it("服务器每房间注入独立 AI 依赖：RouteCache 实例不同，随机序列互不推进", () => {
    const roomA = makeTestRoom();
    const roomB = makeTestRoom();
    expect(roomA.aiDependencies.routeCache).not.toBe(roomB.aiDependencies.routeCache);
    expect(roomA.aiDependencies.routeCache).toBeInstanceOf(RouteCache);
    const firstA = roomA.aiDependencies.random();
    roomB.aiDependencies.random();
    roomB.aiDependencies.random();
    const secondA = roomA.aiDependencies.random();
    const roomC = makeTestRoom();
    const firstC = roomC.aiDependencies.random();
    const secondC = roomC.aiDependencies.random();
    // 相同种子、各自序列：B 的消耗不影响 A；A 与未被打断的 C 序列一致。
    expect(firstA).toBe(firstC);
    expect(secondA).toBe(secondC);
  });

  it("TABLE_TUNING 运行期不被改写；它是可变模块级对象，改写会串到之后创建的所有房间", () => {
    const before = JSON.stringify(TABLE_TUNING);
    playSolo();
    expect(JSON.stringify(TABLE_TUNING)).toBe(before);

    const saved = { ...TABLE_TUNING };
    try {
      TABLE_TUNING.cushionFriction = 0.99;
      const sideFriction = (): number => makeSimulator().sidePolyGroups?.polys[0].friction ?? -1;
      expect(sideFriction()).toBe(0.99);
      expect(sideFriction()).toBe(0.99);
    } finally {
      Object.assign(TABLE_TUNING, saved);
    }
    expect(JSON.stringify(TABLE_TUNING)).toBe(before);
  });

  it("重力方向缓存是只读共享值；两房间交替推进后数值与同一实例不变", () => {
    const before = { ...getGravityDir() };
    expect(getGravityDir()).toBe(getGravityDir());
    playInterleaved();
    expect(getGravityDir()).toBe(getGravityDir());
    expect({ ...getGravityDir() }).toEqual(before);
  });
});
