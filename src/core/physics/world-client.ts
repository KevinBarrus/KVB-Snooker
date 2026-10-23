import { Vec3 } from "../math/vec3.js";
import { ContactBase } from "./contact.js";
import { Body } from "./body.js";
import { MeshBody } from "./mesh-body.js";
import { Solver, SolverEngine } from "./solver.js";
import { World } from "./world.js";
import type { BodySphere } from "./ball.js";

/** PCOL L14626-14644（原模 95）：预测上下文——母球路径/最早目标撞击与目标最终静止态快照。 */
class PredictionContext {
  p0 = new Vec3();
  p1 = new Vec3();
  cue = new Vec3();
  cueVSq = 0;
  impactV1 = new Vec3();
  targetNumber = 0;
  p2 = new Vec3();
  target = new Vec3();
  targetVSq = 0;
  b1: Body | null = null;
  b2: Body | null = null;
  impactOccured = false;
  hasImpactTarget = false;

  onPredictionStart(b1: Body): void {
    this.b1 = b1;
    this.b2 = null;
    this.impactOccured = false;
    this.hasImpactTarget = false;
    this.p0.copy(b1.position);
    this.cue.copy(this.p0);
  }

  onStepped(): number {
    const walked = this.cue.distanceTo(this.b1!.position);
    this.cue.copy(this.b1!.position);
    return walked;
  }

  onImpact(target: Body | null): void {
    this.impactOccured = true;
    this.p1.copy(this.b1!.position);
    this.b1!.collisionMask = 12;
    if (target) {
      this.hasImpactTarget = true;
      this.b2 = target;
      this.p2.copy(target.position);
      target.collisionMask = 12;
      this.targetNumber = (target as unknown as { number?: number }).number ?? 0;
    }
  }

  onPredictionEnd(): void {
    this.cueVSq = this.b1!.vSq;
    this.b1!.collisionMask = 0;
    this.b1 = null;
    if (this.b2) {
      this.target.copy(this.b2.position);
      this.targetVSq = this.b2.vSq;
      this.b2.collisionMask = 0;
      this.b2 = null;
    }
  }
}

// PCOL L14609-14745（原模 95）：World 预测客户端。
export class WorldClient extends World {
  predictionCtx = new PredictionContext();
  predictorSolver = SolverEngine.sharedInstance;
  private _serialData = World.makeSerialData();
  private predictorCallback = (contact: ContactBase): boolean => {
    const ctx = this.predictionCtx;
    if (ctx.impactOccured || (contact.bj as unknown as { ground?: boolean }).ground) return false;
    let hit: Body;
    let other: Body;
    if (contact.idi === ctx.b1!.uid) {
      hit = contact.bi as Body;
      other = contact.bj as Body;
    } else {
      hit = contact.bj as Body;
      other = contact.bi as Body;
    }
    this.meshBody = this.simplifiedMeshBody as unknown as MeshBody; // 裸 {groups} 鸭子类型（PCOL L13513）
    ctx.onImpact(contact.isSS ? other : null);
    const balls = this.balls;
    for (let i = 0, n = balls.length; i !== n; ++i) {
      if (balls[i] != hit && balls[i] != other) this.inactivateBall(balls[i]);
    }
    return true;
  };
  originMeshBody: MeshBody | null = null;
  simplifiedMeshBody: { groups: MeshBody["groups"] } | null = null;

  override setMeshBody(t: MeshBody): void {
    super.setMeshBody(t);
    this.originMeshBody = t;
    this.simplifiedMeshBody = t.slice("ground");
  }

  override emptyMeshBody(): void {
    this.simplifiedMeshBody = null;
    this.originMeshBody = null;
    super.emptyMeshBody();
  }

  save(): void {
    this.serialize(this._serialData);
  }

  restore(t?: { balls: number[]; mbid: string; evolution: number }): void {
    if (!this._environmentReady) this._rebuildEnvironment();
    if (t !== undefined) World.copySerialDataAToB(t, this._serialData);
    this.deserialize(this._serialData);
  }

  override step(t: number): number {
    const simulated = super.step(t);
    const balls = this.balls;
    let fraction = this.accumulator;
    if (fraction > this._stepSize) fraction = 0;
    for (let i = 0, n = balls.length; i !== n; ++i) {
      (balls[i] as BodySphere).syncStates(fraction);
    }
    return simulated;
  }

  /** PCOL L14707-14738：简化台面 + 专用 solver 跑预测；结束 restore 还原。 */
  predict(t: Body, e: ArrayLike<number>, i: number): PredictionContext {
    const savedTouchPresolve = this.touchPresolveHandler;
    const savedOutOfBounds = this.outOfBoundsHandler;
    const ctx = this.predictionCtx;
    let distance = 0;
    let iterations = 0;
    this.solver = this.predictorSolver;
    this.touchPresolveHandler = NOOP_PRED;
    this.outOfBoundsHandler = NOOP_PRED;
    this.useStrictMode = false;
    this.predictorSolver.reset(this.predictorCallback);
    ctx.onPredictionStart(t);
    this.shoot(t, e);
    ctx.impactV1.copy(t.v);
    // PCOL L14728-14733
    for (; distance < i && ++iterations < 70;) {
      this.predictorSolver.interrupt = false;
      this.internalStep();
      distance += ctx.onStepped();
      if (!ctx.impactOccured) ctx.impactV1.copy(t.v);
      if (t.getMotion() < 1) break;
    }
    this.meshBody = this.originMeshBody;
    this.touchPresolveHandler = savedTouchPresolve;
    this.outOfBoundsHandler = savedOutOfBounds;
    this.predictorSolver.reset(null);
    this.solver = Solver.sharedInstance;
    this.useStrictMode = true;
    ctx.onPredictionEnd();
    this.restore();
    return ctx;
  }
}

const NOOP_PRED = (): void => undefined;
