import { afterEach, describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../src/core/math/vec3.js";
import { SeededRandom, setCoreRandom } from "../../src/core/rng.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { AIController } from "../../src/core/ai/task-pipeline.js";
import { RouteCache, type AIRoute } from "../../src/core/ai/route-cache.js";
import { AI_PROFILES, type AIProfile } from "../../src/core/ai/profiles.js";
import { createGameView, PlayArea, type GameView } from "../../src/core/ai/play-area.js";
import { applyChaos, checkPocket } from "../../src/core/ai/pot-route.js";
import { checkBanks } from "../../src/core/ai/bank-route.js";
import { isSegmentSafe } from "../../src/core/ai/geometry.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";
import { makePocketTable } from "../fixtures/table.js";

afterEach(() => { setCoreRandom(null); vi.restoreAllMocks(); });

function makeSim(ballSet = [0, 0.2, 0.5, 1, 0.1, -0.4]): Simulator {
  const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet });
  settle(sim);
  return sim;
}

function settle(sim: Simulator): void {
  for (let count = 0; sim.nAwakened && count < 200; ++count) sim.step(0.1);
  expect(sim.nAwakened).toBe(0);
}

function findRoute(ai: AIController, view: GameView, sim: Simulator): AIRoute {
  for (let count = 0; count < 1000; ++count) {
    const route = ai.step(view, sim);
    if (route) return { ...route };
  }
  throw new Error("AI route pipeline failed to finish");
}

describe("AI（PCOL L2497-2886）", () => {
  it("三档档案与原作常量一致，PlayArea 六袋几何与对角线", () => {
    expect(Object.values(AI_PROFILES).map(p => [p.name, p.level, p.range, p.abf, p.bcf, p.chaoticSeed, p.mpm, p.bpm]))
      .toEqual([["AI-1", 2.5, 1.9, 1.2, 1.6, 3, 0.8, 1.2], ["AI-2", 4, 2.5, 1, 1, 3, 0.7, 1], ["AI-3", 5, 3.3, 0.72, 0.82, 2, 0.45, 0.8]]);
    const area = new PlayArea();
    expect(area.diagonal).toBeCloseTo(Math.hypot(3.66, 1.859), 12);
    expect(area.pockets).toHaveLength(6);
    expect(area.pockets[2].position.z).toBeCloseTo(-0.9095, 12);
    expect(area.pockets[2].maxHalfOpen).toBeCloseTo(-Math.cos(65 * Math.PI / 180), 12);
  });

  it("RouteCache 重用记录并清除袋号、目标号，超过 20 条扩容", () => {
    const cache = new RouteCache();
    const first = cache.next(1, 0, 0, 0, 0.2, 0.5);
    first.pkIndex = 2;
    first.ballBIndex = 3;
    cache.clear();
    expect(cache.next(0, 0, 1, 0, 0.3, 0.2)).toBe(first);
    expect(first.pkIndex).toBe(-1);
    expect(first.ballBIndex).toBe(-1);
    for (let i = 0; i < 25; ++i) cache.next(1, 0, 0, 0, 0.2, i);
    expect(cache.length).toBe(26);
    expect(cache.getAtIndex(25).priority).toBe(24);
  });

  it("路线缓存只随 evolution 重启；ballOn 变化本身不重启", () => {
    const sim = makeSim();
    const ai = new AIController();
    expect(ai.checkRestart(sim, { ballOn: 2, inHand: 0 })).toBe(true);
    expect(ai.checkRestart(sim, { ballOn: 128, inHand: 0 })).toBe(false);
    sim.reset(false, false);
    expect(ai.checkRestart(sim, { ballOn: 128, inHand: 0 })).toBe(true);
  });

  it("进球路线优先，按 priority 选最大项，搜索不调用物理预测", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    setCoreRandom({ next: () => 0 });
    const sim = makeSim([0, 0.2, 0.5, 1, 0.1, -0.4, 7, 0.8, 0.2]);
    const predict = vi.spyOn(sim, "predict");
    const view = createGameView(sim);
    const cache = new RouteCache();
    for (const ball of sim.getBalls().slice(1)) {
      for (let index = 0; index < 6; ++index) checkPocket(sim.getBallAtIndex(0), ball, index, view.playArea, sim, view, cache);
    }
    const expected = Array.from({ length: cache.length }, (_, i) => cache.getAtIndex(i))
      .sort((a, b) => b.priority - a.priority)[0];
    expect(expected).toBeDefined();
    const ai = new AIController();
    ai.checkRestart(sim, { ballOn: 65535, inHand: 0 });
    const route = findRoute(ai, view, sim);
    expect(route.priority).toBe(expected.priority);
    expect(route.dx).toBe(expected.dx);
    expect(predict).not.toHaveBeenCalled();
  });

  it("0.02ms 时间切片保留袋下标，续跑后有路线", () => {
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time += 0.03);
    const sim = makeSim();
    const ai = new AIController();
    ai.checkRestart(sim, { ballOn: 2, inHand: 0 });
    const view = createGameView(sim);
    expect(ai.step(view, sim)).toBeNull();
    expect(findRoute(ai, view, sim).powerFactor).toBeGreaterThan(0);
  });

  it("ballOn 排除不合法目标；没有进球线则降级安全球", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    setCoreRandom(new SeededRandom(42));
    const sim = makeSim([0, 0.2, 0.5, 1, 0.1, -0.4, 7, 0.8, 0.2]);
    const view = createGameView(sim);
    view.playArea.pockets.length = 0;
    const ai = new AIController();
    ai.checkRestart(sim, { ballOn: 128, inHand: 0 });
    const route = findRoute(ai, view, sim);
    expect(route.priority).toBeLessThan(0.1);
    const target = sim.getBallAtIndex(2).position;
    expect(new Vec3(route.dx, route.dy, route.dz).dot(target.clone().sub(sim.getCueBallPosition()).normalize())).toBeGreaterThan(0.99);
  });

  it("无目标走随机解围，种子可重放且原作仅生成第一象限方向", () => {
    const sim = makeSim();
    function run(): AIRoute {
      setCoreRandom(new SeededRandom(123));
      const ai = new AIController();
      ai.checkRestart(sim, { ballOn: 128, inHand: 0 });
      return findRoute(ai, createGameView(sim), sim);
    }
    const route = run();
    expect(run()).toEqual(route);
    expect(route.dx).toBeGreaterThanOrEqual(0);
    expect(route.dz).toBeGreaterThanOrEqual(0);
    expect(route.powerFactor).toBeLessThan(0.6);
    expect(route.priority).toBeLessThan(0.05);
  });

  it("遮挡检测排除自身/目标，失活球不阻挡", () => {
    const sim = makeSim([0, -1, 0, 1, 1, 0, 2, 0, 0]);
    const [cue, target, blocker] = sim.getBalls();
    expect(isSegmentSafe(cue.position, Vec3.UNIT_X, 2, cue.radius, sim.getBalls(), cue, target)).toBe(false);
    blocker.active = false;
    expect(isSegmentSafe(cue.position, Vec3.UNIT_X, 2, cue.radius, sim.getBalls(), cue, target)).toBe(true);
  });

  it("库边反弹两段畅通才收，低杆与距离优先级保真", () => {
    const sim = makeSim([0, -0.6, 0.2, 1, 0.6, 0.2]);
    const cache = new RouteCache();
    checkBanks(sim.getBallAtIndex(0), sim.getBallAtIndex(1), sim, cache);
    expect(cache.length).toBeGreaterThan(0);
    for (let index = 0; index < cache.length; ++index) {
      const route = cache.getAtIndex(index);
      expect(route.fbSpin).toBeLessThanOrEqual(0);
      expect(route.powerFactor).toBeGreaterThan(0.2);
      expect(route.priority).toBeLessThan(1);
      expect(Math.hypot(route.dx, route.dy, route.dz)).toBeCloseTo(1, 12);
    }
  });

  it("直线被球挡住时流水线进入库边反弹任务", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const sim = makeSim([0, -0.6, 0.2, 1, 0.6, -0.2, 2, 0, 0]);
    const view = createGameView(sim);
    view.playArea.pockets.length = 0;
    const ai = new AIController();
    ai.checkRestart(sim, { ballOn: 2, inHand: 0 });
    const route = findRoute(ai, view, sim);
    expect(route.fbSpin).toBeLessThan(0);
    expect(route.priority).toBeGreaterThan(0.1);
    expect(Math.abs(route.dz)).toBeGreaterThan(0.1);
  });

  it("chaos 的 abf 在平方内，mpm/bpm 修改在缩放后不影响方向", () => {
    const sim = makeSim();
    const view = createGameView(sim);
    const cache = new RouteCache();
    checkPocket(sim.getBallAtIndex(0), sim.getBallAtIndex(1), 2, view.playArea, sim, view, cache);
    const initial = { ...cache.getAtIndex(0) };
    expect(initial.pkIndex).toBe(2);
    const run = (profile: AIProfile) => {
      const sequence = [0.5, 0.4, 0.8];
      setCoreRandom({ next: () => sequence.shift()! });
      const route = { ...initial };
      applyChaos(route, view, sim, profile);
      return route;
    };
    const profile = AI_PROFILES.NORMAL;
    const route = run(profile);
    expect(run({ ...profile, mpm: 999, bpm: 999 })).toEqual(route);
    const cue = sim.getBallAtIndex(0);
    const target = sim.getBallAtIndex(1);
    const path = view.playArea.pockets[2].position.clone().sub(target.position);
    path.y = 0;
    const cut = new Vec3(initial.dx, initial.dy, initial.dz).dot(path.clone().normalize());
    const strength = (Math.min(1, cue.position.distanceTo(target.position) / profile.range) * profile.abf) ** 2
      + profile.bcf / (1 + Math.exp(-(path.length() - 1.8 * cut * cut) / 0.5));
    const offset = new Vec3().crossVectors(path, Vec3.UNIT_Y).normalize()
      .scale(-(0.05 + target.radius) * (1 - 0.4 ** profile.chaoticSeed) * strength);
    const expected = path.add(offset).normalize().scale(-target.radius - cue.radius)
      .add(target.position).sub(cue.position).normalize();
    expect(route.dx).toBeCloseTo(expected.x, 12);
    expect(route.dz).toBeCloseTo(expected.z, 12);
  });

  it("百局真实击球：有限数值、活跃球留台内，AI-1 进球率显著低于 AI-3", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const rates: number[] = [];
    for (const profile of [AI_PROFILES.EASY, AI_PROFILES.HARD]) {
      let potted = 0;
      for (let seed = 1; seed <= 100; ++seed) {
        setCoreRandom(new SeededRandom(seed));
        const layout = new SeededRandom(2026 + seed);
        const target = new Vec3(0.1 + 0.6 * layout.next(), 0, -0.1 + 0.3 * layout.next());
        const line = new Vec3().subVectors(new Vec3(0, 0, -0.9095), target).normalize();
        const cue = target.clone().addScaled(line, -0.4 - 0.25 * layout.next());
        const sim = makeSim([0, cue.x, cue.z, 1, target.x, target.z]);
        const view = createGameView(sim);
        view.playArea.pockets.splice(0, 6, view.playArea.pockets[2]);
        const ai = new AIController(profile);
        ai.checkRestart(sim, { ballOn: 2, inHand: 0 });
        const route = findRoute(ai, view, sim);
        expect(Object.values(route).every(Number.isFinite)).toBe(true);
        const vars = makeStrokeVars(sim, route);
        expect(Array.from(vars).every(Number.isFinite)).toBe(true);
        sim.stroke(vars);
        settle(sim);
        if (sim.getResult().pottedIndices.includes(1)) potted++;
        for (const ball of sim.getBalls()) {
          expect([ball.position.x, ball.position.y, ball.position.z, ball.v.lengthSq(), ball.w.lengthSq()].every(Number.isFinite)).toBe(true);
          if (ball.active) {
            expect(Math.abs(ball.position.x)).toBeLessThanOrEqual(1.8);
            expect(Math.abs(ball.position.z)).toBeLessThanOrEqual(0.9);
            expect(ball.position.y).toBeGreaterThanOrEqual(0.88);
          }
        }
      }
      rates.push(potted);
    }
    expect(rates[1]).toBeGreaterThan(rates[0] + 15);
    console.log(`百局进球：AI-1=${rates[0]}/100，AI-3=${rates[1]}/100`);
  }, 30000);
});
