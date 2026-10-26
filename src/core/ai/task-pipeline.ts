import { Vec3 } from "../math/vec3.js";
import { coreRandom } from "../rng.js";
import type { RulesContext } from "../rules/snooker.js";
import type { Simulator } from "../simulator/simulator.js";
import type { Ball } from "../simulator/ball.js";
import { checkBanks } from "./bank-route.js";
import { isSegmentSafe } from "./geometry.js";
import type { GameView } from "./play-area.js";
import { AI_PROFILES, type AIProfile } from "./profiles.js";
import { applyChaos, checkPocket } from "./pot-route.js";
import { sharedRouteCache, type AIRoute } from "./route-cache.js";

// PCOL L2536-2744
export class AIController {
  private simEvolution = -1;
  private readonly ballOnIndices: number[] = [];
  private ballCheckIndex = 0;
  private pocketIndex = 0;
  private readonly cache = sharedRouteCache;
  private isBreakDirty = false;
  private isBreak = false;
  private taskIndex = -1;

  constructor(private readonly profile: AIProfile = AI_PROFILES.NORMAL) {}

  checkRestart(sim: Simulator, ctx: RulesContext): boolean {
    if (this.simEvolution === sim.evolution) return false;
    this.simEvolution = sim.evolution;
    this.ballOnIndices.length = 0;
    this.cache.clear();
    const balls = sim.getBalls();
    for (let index = 1; index !== balls.length; ++index) {
      if (balls[index].active && (Math.pow(2, balls[index].number) & ctx.ballOn)) this.ballOnIndices.push(index);
    }
    this.ballCheckIndex = this.pocketIndex = 0;
    this.taskIndex = 0;
    this.isBreakDirty = true;
    return true;
  }

  step(view: GameView, sim: Simulator): AIRoute | null {
    if (this.taskIndex === -1) return null;
    const completed = this.taskIndex === 0 ? this.pocketTask(view, sim)
      : this.taskIndex === 1 ? this.safetyTask(view, sim) : this.bankTask(sim);
    if (!completed) return null;
    if (this.cache.length === 0) {
      if (++this.taskIndex >= 3) {
        this.taskIndex = -1;
        const direction = new Vec3(coreRandom(), 0, coreRandom()).normalize();
        this.cache.next(direction.x, direction.y, direction.z, 0, 0.6 * coreRandom(), 0.05 * coreRandom()).ballBIndex = this.ballOnIndices[0] ?? -1;
        return this.cache.getAtIndex(0);
      }
      this.ballCheckIndex = this.pocketIndex = 0;
      return null;
    }
    this.taskIndex = -1;
    let maxPriority = -1;
    let route = null;
    for (let index = 0; index !== this.cache.length; ++index) {
      const candidate = this.cache.getAtIndex(index);
      if (candidate.priority > maxPriority) { maxPriority = candidate.priority; route = candidate; }
    }
    if (route && route.pkIndex !== -1 && route.ballBIndex !== -1) applyChaos(route, view, sim, this.profile);
    return route;
  }

  private pocketTask(view: GameView, sim: Simulator): boolean {
    const started = performance.now();
    const cue = sim.getBallAtIndex(0);
    while (this.ballCheckIndex < this.ballOnIndices.length) {
      const target = sim.getBallAtIndex(this.ballOnIndices[this.ballCheckIndex]);
      while (this.pocketIndex < view.playArea.pockets.length) {
        checkPocket(cue, target, this.pocketIndex++, view.playArea, sim, view, this.cache);
        if (performance.now() - started > 0.02) return false;
      }
      this.ballCheckIndex++;
      this.pocketIndex = 0;
    }
    return true;
  }

  private getIsBreak(sim: Simulator): boolean {
    if (this.isBreakDirty) {
      this.isBreakDirty = false;
      this.isBreak = true;
      for (const index of this.ballOnIndices) {
        const ball = sim.getBallAtIndex(index);
        if (ball.position.distanceToSq(ball.spot) > 0.0025) { this.isBreak = false; break; }
      }
    }
    return this.isBreak;
  }

  private safetyTask(view: GameView, sim: Simulator): boolean {
    const started = performance.now();
    const cue = sim.getBallAtIndex(0);
    const isBreak = this.getIsBreak(sim);
    const extension = (isBreak ? 2 : -0.5) * cue.radius;
    const spread = isBreak ? 0.85 + 0.14 * coreRandom() : 0.99 + 0.009 * coreRandom();
    const distancePower = isBreak ? 0.4 : 0.6;
    const total = isBreak ? 1 : 5;
    while (this.ballCheckIndex < this.ballOnIndices.length) {
      const target = sim.getBallAtIndex(this.ballOnIndices[this.ballCheckIndex]);
      if (this.checkPass(cue, target, view, sim, extension, spread, distancePower, total)) return true;
      this.ballCheckIndex++;
      if (performance.now() - started > 0.02) return false;
    }
    return true;
  }

  // PCOL L2808-2822
  private checkPass(
    cue: Ball, target: Ball, view: GameView, sim: Simulator,
    extension: number, spread: number, distancePower: number, total: number
  ): boolean {
    const direction = target.position.clone().sub(cue.position);
    const perpendicular = new Vec3().crossVectors(direction, Vec3.UNIT_Y).normalize();
    const start = (-target.radius - cue.radius) * spread;
    const end = -start;
    const step = 0.2 * (end - start);
    for (let offset = start; offset <= end; offset += step) {
      const point = perpendicular.clone().scale(offset).add(target.position);
      direction.subVectors(point, cue.position);
      const length = direction.length();
      direction.scale(1 / length);
      if (isSegmentSafe(cue.position, direction, length + extension,
        cue.radius + Vec3.EPSILON, sim.getBalls(), cue, target)) {
        this.cache.next(direction.x, direction.y, direction.z, 0,
          0.1 * coreRandom() + length / view.playArea.diagonal * distancePower, 0.1 * coreRandom()).ballBIndex = target.index;
        return this.cache.length >= total;
      }
    }
    return false;
  }

  private bankTask(sim: Simulator): boolean {
    if (this.ballCheckIndex >= this.ballOnIndices.length) return true;
    checkBanks(sim.getBallAtIndex(0), sim.getBallAtIndex(this.ballOnIndices[this.ballCheckIndex++]), sim, this.cache);
    return false;
  }
}
