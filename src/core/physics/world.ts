import { Vec3 } from "../math/vec3.js";
import { ActiveContactSet } from "./actings.js";
import { ccd } from "./ccd.js";
import { ContactBase } from "./contact.js";
import { ContactSP } from "./sp-contact.js";
import { ContactSS } from "./contact.js";
import { Body } from "./body.js";
import { PHYSICS, setBallFrictionAndRestitution } from "./constants.js";
import { ObjectPool } from "./pool.js";
import { ScenePendings } from "./pendings.js";
import type { MeshBody } from "./mesh-body.js";
import { Solver } from "./solver.js";
import { TipContact } from "./tip-contact.js";

const NOOP = (): void => undefined;

// PCOL L11776-12105（原模 39）：物理世界。模 20 性能统计省略（登记差异）。
export class World {
  accumulator = 0;
  meshBody: MeshBody | null = null;
  balls: Body[] = [];
  protected qCDSP: Body[] = [];
  protected qCDSS: Body[] = [];
  protected ssSkips: number[] = [];
  protected p2a: ContactBase[] = [];
  protected rechecks: ContactBase[] = [];
  nRechecks = 0;
  protected cActings = new ActiveContactSet(44);
  protected cPendings = new ScenePendings();
  protected spPool = new ObjectPool<ContactSP>("sp", ContactSP, 70);
  protected ssPool = new ObjectPool<ContactSS>("ss", ContactSS, 70);
  protected _environmentReady = false;
  protected internalStep: () => void = this.__internalStep_error;
  nAwakened = 0;
  touchPresolveHandler: (t: ContactBase) => void = NOOP;
  outOfBoundsHandler: (ball: Body) => void = NOOP;
  useStrictMode = true;
  solver: Solver = Solver.sharedInstance;
  lowestBoundY = -Number.MAX_VALUE;
  protected _maxSteps = 10;
  protected _stepSize = 0;
  protected _evolution = 0;

  get stepSize(): number {
    return this._stepSize;
  }

  set stepSize(t: number) {
    if (this._stepSize === t) return;
    this._stepSize = t;
    Body.minEnergy =
      Math.round(
        PHYSICS.gravity.length() * t * (1 - Math.pow(Body.baseSleepBias, t)) * 0.5 * 1e3
      ) / 1e3;
    Body.maxEnergy = 4.5 * Body.minEnergy;
    Body.wakeUpEnergy = 1.4 * Body.minEnergy;
    ContactBase.gt.scaleVector(2.3 * t, PHYSICS.gravity);
  }

  get environmentReady(): boolean {
    return this._environmentReady;
  }

  get timestamp(): number {
    throw new Error("No more timestamp, use evolution");
  }

  get evolution(): number {
    return this._evolution;
  }

  static makeSerialData(): { balls: number[]; mbid: string; evolution: number } {
    const data = Object.create(null) as { balls: number[]; mbid: string; evolution: number };
    data.balls = [];
    data.mbid = "";
    data.evolution = 0;
    return data;
  }

  static copySerialDataAToB(
    t: { evolution: number; mbid: string; balls: number[] },
    e: { evolution: number; mbid: string; balls: number[] }
  ): void {
    e.evolution = t.evolution;
    e.mbid = t.mbid;
    for (let i = 0, s = t.balls.length; i !== s; ++i) e.balls[i] = t.balls[i];
    e.balls.length = t.balls.length;
  }

  onTouchPresolve(t: (contact: ContactBase) => void): void {
    if (t !== undefined) this.touchPresolveHandler = t;
  }

  onOutOfBounds(t: (ball: Body) => void): void {
    if (t !== undefined) this.outOfBoundsHandler = t;
  }

  clearCallbacks(): void {
    this.touchPresolveHandler = NOOP;
    this.outOfBoundsHandler = NOOP;
  }

  shoot(t: Body, e: ArrayLike<number>): void {
    this.tipContact ??= new TipContact(0.15);
    this.tipContact.resetTip(t, e);
    this.solver.solveContact(this.tipContact);
    this.tipContact.free();
    t.wakeUp();
  }

  private tipContact: TipContact | null = null;

  _breakEnvironment(): void {
    this._environmentReady = false;
    this.internalStep = this.__internalStep_error;
    this.cPendings.freeAll();
    this.cActings.freeAll();
    this.spPool.freeAll();
    this.ssPool.freeAll();
    this.qCDSP.length = 0;
    this.qCDSS.length = 0;
    this.ssSkips.length = 0;
    this.p2a.length = 0;
  }

  _rebuildEnvironment(): void {
    this._environmentReady = true;
    const balls = this.balls;
    let count = this.meshBody!.nPolygons;
    const polyCount = count;
    for (let i = 0, n = balls.length; i !== n; ++i) {
      balls[i].uid = count++;
      setBallFrictionAndRestitution(balls[i]);
    }
    this.cActings.resize(count, polyCount);
    this.internalStep = this.__internalStep__;
  }

  emptyMeshBody(): void {
    if (this._environmentReady) this._breakEnvironment();
    this.meshBody = null;
  }

  emptyBalls(): void {
    if (this._environmentReady) this._breakEnvironment();
    for (let i = 0, n = this.balls.length; i !== n; ++i) this.balls[i].dispose();
    this.balls.length = 0;
  }

  reset(): void {
    const balls = this.balls;
    const meshBody = this.meshBody;
    if (this._environmentReady) {
      this.cPendings.freeAll();
      this.cActings.freeAll();
      this.spPool.freeAll();
      this.ssPool.freeAll();
      if (this.nRechecks !== 0) {
        throw new Error("logic error: nRechecks not zero when reset");
      }
    } else {
      this._rebuildEnvironment();
    }
    ccd.initIslands(balls, meshBody!, this.cActings, this.ssPool, this.spPool);
    this._evolution++;
  }

  serialize(t: { balls: number[]; mbid: string; evolution: number }): typeof t {
    if (!this._environmentReady) {
      throw new Error("serialize should be called after environmentReady");
    }
    t.balls.length = 0;
    const balls = this.balls;
    for (let i = 0, n = balls.length; i !== n; ++i) balls[i].serialize(t.balls);
    t.evolution = this._evolution;
    t.mbid = this.meshBody!.id;
    return t;
  }

  deserialize(t: { balls: number[]; mbid: string; evolution: number }): void {
    if (!this._environmentReady) {
      throw new Error("deserialize should be called after environmentReady");
    }
    if (t.mbid !== this.meshBody!.id) {
      throw new Error("deserialize data error: mbid not match: " + t.mbid + ", " + this.meshBody!.id);
    }
    const balls = this.balls;
    this.nAwakened = 0;
    let offset = 0;
    for (let i = 0, n = balls.length; i !== n; ++i) {
      offset = balls[i].deserialize(t.balls, offset);
      if (balls[i].active && !balls[i].asleep) this.nAwakened++;
    }
    this.reset();
    this._evolution = t.evolution;
  }

  addBall(t: Body): void {
    if (this._environmentReady) throw new Error("addBall after environmentReady");
    this.balls.push(t);
  }

  setMeshBody(t: MeshBody): void {
    if (this._environmentReady) throw new Error("setMeshBody after environmentReady");
    this.meshBody = t;
    this.lowestBoundY = t.lowestPosition.y;
  }

  inactivateBall(t: Body): void {
    if (!t.active) return;
    const uid = t.uid;
    t.active = false;
    (this.cActings as { removeAllContactsWithId(t: number): void }).removeAllContactsWithId(uid);
    const stack = this.cPendings.stack;
    for (let i = 0, n = stack.length; i !== n; ++i) {
      const contact = stack[i];
      if (contact.idi === uid || contact.idj === uid) contact.markedAsKilled = true;
    }
  }

  step(t: number): number {
    const stepSize = this._stepSize;
    const maxSteps = this._maxSteps;
    let steps = 0;
    for (this.accumulator += t; this.accumulator >= stepSize && steps < maxSteps; ) {
      this.accumulator -= stepSize;
      steps++;
      this.internalStep();
    }
    if (steps === 0) {
      this.nAwakened = 0;
      const balls = this.balls;
      for (let i = 0, n = balls.length; i !== n; ++i) {
        if (balls[i].active && !balls[i].asleep) this.nAwakened++;
      }
    }
    return steps * stepSize;
  }

  markRecheck(t: ContactBase): void {
    this.nRechecks++;
    this.rechecks.push(t);
  }

  /** PCOL L12001-12020：复检挂起接触；bi/bj 已在本轮 SS 队列的双 (dd) 或双方均速为零或复检失败者释放。 */
  protected flushRechecks(qCDSS: Body[], cap: number): void {
    let contact: ContactBase;
    const rechecks = this.rechecks;
    const pendings = this.cPendings;
    for (let i = 0, n = rechecks.length; i !== n; ++i) {
      contact = rechecks[i];
      if (contact.isOutdated()) {
        contact.free();
      } else if (contact.isSS) {
        if (
          !contact.bi!.active ||
          !contact.bj!.active ||
          qCDSS.indexOf(contact.bi!) !== -1 ||
          qCDSS.indexOf(contact.bj!) !== -1 ||
          (contact.bi!.vState === 0 && contact.bj!.vState === 0) ||
          !ccd.ccdSS(contact.bi as BodySphereAlias, contact.bj as BodySphereAlias, cap, contact as never)
        ) {
          contact.free();
          continue;
        }
        pendings.add(contact);
      } else {
        if (
          contact.bi!.active &&
          contact.bi!.vState !== 0 &&
          ccd.ccdSP(contact.bi as BodySphereAlias, contact.bj as never, Number.MAX_VALUE, contact as never)
        ) {
          pendings.add(contact);
        } else {
          contact.free();
        }
      }
    }
    rechecks.length = 0;
    this.nRechecks = 0;
  }

  private __internalStep_error(): void {
    throw new Error("Reset should be called explicitly before any simulation start");
  }

  // PCOL L12046-12105：事件驱动 CCD 子步进。
  protected __internalStep__(): void {
    const balls = this.balls;
    const actings = this.cActings;
    const pendings = this.cPendings;
    const solver = this.solver;
    const ssPool = this.ssPool;
    const spPool = this.spPool;
    const p2a = this.p2a;
    const qCDSP = this.qCDSP;
    const qCDSS = this.qCDSS;
    const ssSkips = this.ssSkips;
    const islandUpdMinDisSq = PHYSICS.islandUpdMinDisSq;
    let vStateBaseline: number = Body.vStates.ZERO;
    const SLOWER = Body.vStates.SLOWER;
    let ball: Body;
    const strict = this.useStrictMode;
    let elapsed = 0;
    let guard = 0;
    const total = this._stepSize;

    this._evolution++;
    if (strict) pendings.removeAllSS();
    else vStateBaseline = SLOWER;
    ccd.updateIslands(actings, true);
    for (let i = 0, n = balls.length; i !== n; ++i) {
      if (balls[i].active) balls[i].predVelocities(total);
    }
    solver.solveList(actings, true);
    for (let i = 0, n = balls.length; i !== n; ++i) {
      ball = balls[i];
      if (ball.active) {
        if (ball.vState > SLOWER) {
          ball.cdRound++;
          qCDSP.push(ball);
          qCDSS.push(ball);
        } else if (ball.vState > vStateBaseline) {
          qCDSS.push(ball);
        }
      }
    }
    while (elapsed < total || qCDSP.length !== 0) {
      let remaining = total - elapsed;
      const cap = strict ? remaining : Number.MAX_VALUE;
      if (++guard > 100) throw new Error("Loop overflow: " + guard);
      if (qCDSP.length !== 0) {
        for (let i = 0, n = qCDSP.length; i < n; ++i) {
          ccd.updateSPToi(qCDSP[i], this.meshBody!, spPool, actings, pendings);
        }
        qCDSP.length = 0;
      }
      if (this.nRechecks !== 0) this.flushRechecks(qCDSS, cap);
      if (qCDSS.length !== 0) {
        for (let i = 0, n = qCDSS.length; i < n; ++i) {
          ccd.updateSSToi(qCDSS[i], balls, ssPool, actings, ssSkips, cap, pendings);
          ssSkips.push(qCDSS[i].uid);
        }
        qCDSS.length = 0;
        ssSkips.length = 0;
      }
      remaining = pendings.step2(remaining, p2a);
      if (p2a.length === 0) {
        this.nAwakened = 0;
        const lowestBoundY = this.lowestBoundY;
        for (let i = 0, n = balls.length; i !== n; ++i) {
          ball = balls[i];
          if (ball.active) {
            if (!ball.step(remaining)) this.nAwakened++;
            if (ball.position.y < lowestBoundY) {
              this.inactivateBall(ball);
              this.outOfBoundsHandler(ball);
            }
          }
        }
        if (this.nAwakened === 0) {
          pendings.freeAll();
          this.accumulator = 0;
        }
        break;
      }
      if (remaining > 0) {
        elapsed += remaining;
        this.nAwakened = 0;
        for (let i = 0, n = balls.length; i !== n; ++i) {
          ball = balls[i];
          if (ball.active && !ball.step(remaining)) this.nAwakened++;
        }
        for (let i = 0, n = p2a.length; i !== n; ++i) {
          const contact = p2a[i];
          if (contact.bi!.steppedLenSq > islandUpdMinDisSq) actings.markReupdate(contact.idi);
          if (contact.isSS && contact.bj!.steppedLenSq > islandUpdMinDisSq) {
            actings.markReupdate(contact.idj);
          }
        }
        ccd.updateIslands(actings, false);
        for (let i = 0, n = balls.length; i !== n; ++i) {
          ball = balls[i];
          if (ball.active && ball.predictionDirty) ball.predVelocities(total - elapsed);
        }
      }
      for (let i = 0, n = p2a.length; i !== n; ++i) {
        const contact = p2a[i];
        if (!contact.bi!.active || (contact.isSS && !contact.bj!.active)) {
          contact.free();
        } else if (contact.life === 0) {
          actings.add(contact);
          contact.startResting();
          this.touchPresolveHandler(contact);
        } else {
          this.markRecheck(contact);
        }
      }
      p2a.length = 0;
      solver.solveList(actings, false);
      for (let i = 0, n = balls.length; i !== n; ++i) {
        ball = balls[i];
        if (ball.active) {
          if (ball.vState > SLOWER) {
            ball.cdRound++;
            qCDSP.push(ball);
            qCDSS.push(ball);
          } else if (ball.vState > vStateBaseline) {
            pendings.outdateAllSSWithId(ball.uid);
            qCDSS.push(ball);
          }
        }
      }
    }
  }
}

type BodySphereAlias = Body & { collisionMask: number; collisionGroup: number };
