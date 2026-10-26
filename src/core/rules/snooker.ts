import { Vec3 } from "../math/vec3.js";
import { FOUL } from "./foul.js";
import { DiscRegion, PointSetPolygon, sections, type CollisionPolygonLike, Plane } from "./region.js";

// PCOL L9932-9948（原模 29）：场景 D 区参数。
const SCENE_D_AREA: Record<string, { cx: number; cz: number; sx: number; sz: number }> = {
  tigerClubSno: { cx: -1.04, cz: 0, sx: -1.33, sz: 0 }
};

// PCOL L12659-12822 头部（原模 54）：ballOn 位掩码语义。
export const BALL_ON = {
  RED: 2,
  YELLOW: 4,
  BLACK: 128,
  COLOR_ALL: 252
} as const;

export interface BallRefLike {
  readonly position: Vec3;
  readonly spot: Vec3;
  readonly number: number;
  readonly index: number;
  active: boolean;
}

/** 模 54 消费的模拟器契约面（结构化可由 Simulator 实现满足——注册差异在 AGENTS.md）。 */
export interface RefSimulator {
  readonly sceneId: string;
  readonly ground: CollisionPolygonLike & {
    centerPosition: { x: number; y: number; z: number };
    size: { x: number };
  };
  readonly ballRadius: number;
  readonly spotY: number;
  readonly result: {
    firstKissIndex: number;
    pottedIndices: number[];
    outOfBoundsIndices: number[];
  };
  getBallAtIndex(t: number): BallRefLike;
  getBalls(): BallRefLike[];
  touchBalls(t: number, spot: Vec3, distance?: number): boolean;
  respotIndexDefault(t: number): void;
  resetBallPosition(t: BallRefLike, spot: Vec3): void;
  resetBallXYZ(t: BallRefLike, x: number, y: number, z: number): void;
}

export interface RulesContext {
  inHand: 0 | 1 | 2;
  ballOn: number;
  nominatedBallIndex?: number;
}

// PCOL L12611-12659（原模 53）：Ref 基类。
export abstract class Ref {
  static readonly SYS_RESERVED_BALL_ON = 65535;

  protected _sceneId = "";
  protected readonly _playArea = new PointSetPolygon();

  get validRegionGeoCenter(): Vec3 | null {
    return this._playArea.geoCenter;
  }

  get sysReservedBallOn(): number {
    return Ref.SYS_RESERVED_BALL_ON;
  }

  /** 仅地面多边形投影区（生成应用事件驱动子类覆写时一并处理）。 */
  syncAreaWithSimulator(t: RefSimulator): void {
    if (this._sceneId !== t.sceneId) {
      this._sceneId = t.sceneId;
      this._playArea.resetWithAtomPolygon(t.ground);
    }
  }

  intersectionRayValidRegionPlane(t: Vec3, e: Vec3, i: Vec3): boolean {
    return this._playArea.intersectionWithRay(t, e, i, 10);
  }

  projectionInSideValidRegion(t: number, e: number, i: number): boolean {
    return this._playArea.projectionInside(t, e, i);
  }

  /** 架构补充封装（PCOL L3725-3734 reqRespotCueball 的规则侧校验）。 */
  placeCueBallCheck(x: number, y: number, z: number, sim: RefSimulator): boolean {
    return this.projectionInSideValidRegion(x, y, z) && !sim.touchBalls(0, new Vec3(x, y, z));
  }

  abstract resetGContext(ctx: RulesContext): void;
  abstract checkResult(ctx: RulesContext, sim: RefSimulator, out: { score: number; foulCode: number }): void;
}

// PCOL L12659-12822（原模 54）：斯诺克规则引擎。
export class SnookerRef extends Ref {
  protected readonly _dArea = new DiscRegion();
  private readonly _tmpArray: BallRefLike[] = [];
  private readonly _tmpOccupiedSpots: number[] = [];
  private readonly _tmpSections: number[] = [];
  private readonly _tmpA = new Vec3();
  private readonly _tmpB = new Vec3();
  private readonly _respotColorBallsSortHandler = (t: BallRefLike, e: BallRefLike): number => t.number - e.number;

  /** 覆写：地面投影区 + D 区同步（PCOL L12685-12698）。 */
  override syncAreaWithSimulator(t: RefSimulator): void {
    if (this._sceneId !== t.sceneId) {
      this._sceneId = t.sceneId;
      const dArea = SCENE_D_AREA[this._sceneId];
      const ground = t.ground;
      this._playArea.resetWithAtomPolygon(ground);
      this._dArea.resetWithCenterTopNormal(
        dArea.cx, ground.centerPosition.y, dArea.cz, dArea.sx, ground.centerPosition.y, dArea.sz, ground.normal
      );
    }
  }

  override intersectionRayValidRegionPlane(t: Vec3, e: Vec3, i: Vec3): boolean {
    return this._dArea.intersectionWithRay(t, e, i, 10);
  }

  override projectionInSideValidRegion(t: number, e: number, i: number): boolean {
    return this._dArea.projectionInside(t, e, i);
  }

  get dArea(): DiscRegion {
    return this._dArea;
  }

  override resetGContext(t: RulesContext): void {
    t.inHand = 2;
    t.ballOn = BALL_ON.RED;
  }

  // PCOL L12703-12739：checkResult 全量。
  override checkResult(t: RulesContext, e: RefSimulator, i: { score: number; foulCode: number }): void {
    const result = e.result;
    i.score = 0;
    i.foulCode = 0;
    let potScore = 0;
    const firstKiss = e.getBallAtIndex(result.firstKissIndex).number;
    if (t.ballOn === this.sysReservedBallOn) {
      this._liveRespot(result.pottedIndices, result.outOfBoundsIndices, e);
      t.inHand = 1;
      return;
    }
    let foulCandidate = 0;
    let legalNumber = 0;
    if (t.ballOn === BALL_ON.COLOR_ALL) {
      if (t.nominatedBallIndex !== undefined) {
        legalNumber = e.getBallAtIndex(t.nominatedBallIndex).number;
        if (firstKiss !== legalNumber) {
          i.foulCode |= firstKiss === 0 ? FOUL.MISS_TARGET : FOUL.ILLEGAL_FIRST_HIT;
          foulCandidate = Math.min(-firstKiss, -legalNumber, -4);
        }
      } else if (firstKiss <= 1) {
        i.foulCode |= firstKiss === 0 ? FOUL.MISS_TARGET : FOUL.ILLEGAL_FIRST_HIT;
        foulCandidate = -7;
      } else {
        legalNumber = firstKiss;
      }
    } else if (Math.pow(2, firstKiss) !== t.ballOn) {
      i.foulCode |= firstKiss === 0 ? FOUL.MISS_TARGET : FOUL.ILLEGAL_FIRST_HIT;
      foulCandidate = Math.min(-firstKiss, -Math.log2(t.ballOn), -4);
    } else {
      legalNumber = firstKiss;
    }
    const outOfBounds = result.outOfBoundsIndices;
    let obCandidate = 0;
    for (let k = 0, n = outOfBounds.length; k !== n; ++k) {
      const number = e.getBallAtIndex(outOfBounds[k]).number;
      obCandidate = Math.min(obCandidate, -number, -legalNumber, -4);
      i.foulCode |= FOUL.OFF_TABLE;
    }
    const potted = result.pottedIndices;
    let potCandidate = 0;
    for (let k = 0, n = potted.length; k !== n; ++k) {
      const number = e.getBallAtIndex(potted[k]).number;
      if (number !== 0 && number === legalNumber) potScore += number;
      else {
        potCandidate = Math.min(potCandidate, -number, -legalNumber, -4);
        i.foulCode |= number === 0 ? FOUL.POTTING_CUE_BALL : FOUL.ILLEGAL_POTTING;
      }
    }
    const worst = Math.min(foulCandidate, obCandidate, potCandidate);
    i.score = worst === 0 ? potScore : worst;
    t.inHand = 0;
    if (t.ballOn === BALL_ON.BLACK && i.score !== 0) {
      t.ballOn = 0;
    } else {
      if (i.score <= 0 || t.ballOn === BALL_ON.RED || t.ballOn === BALL_ON.COLOR_ALL) {
        if (!e.getBallAtIndex(0).active) t.inHand = 2;
        this._liveRespot(result.pottedIndices, result.outOfBoundsIndices, e);
      }
      if (i.score > 0) {
        if (t.ballOn === BALL_ON.RED) t.ballOn = BALL_ON.COLOR_ALL;
        else if (t.ballOn === BALL_ON.COLOR_ALL) {
          t.ballOn = this._nActiveReds(e) === 0 ? BALL_ON.YELLOW : BALL_ON.RED;
        } else t.ballOn = t.ballOn << 1;
      } else if (t.ballOn === BALL_ON.RED || t.ballOn === BALL_ON.COLOR_ALL) {
        t.ballOn = this._nActiveReds(e) === 0 ? BALL_ON.YELLOW : BALL_ON.RED;
      }
    }
  }

  /** PCOL L12764-12786：进袋/出界球的重置（仅彩球与母球；红球消失）。 */
  private _liveRespot(t: number[], e: number[], i: RefSimulator): void {
    const colorBalls = this._tmpArray;
    let respotCue = false;
    for (let k = 0, n = t.length; k !== n; ++k) {
      const ball = i.getBallAtIndex(t[k]);
      if (ball.number > 1) colorBalls.push(ball);
      else if (ball.number === 0) respotCue = true;
    }
    for (let k = 0, n = e.length; k !== n; ++k) {
      const ball = i.getBallAtIndex(e[k]);
      if (ball.number > 1) colorBalls.push(ball);
      else if (ball.number === 0) respotCue = true;
    }
    if (colorBalls.length !== 0) {
      this._liveRespotColorBalls(colorBalls, i);
      colorBalls.length = 0;
    }
    if (respotCue) this._liveRespotCueBall(i);
  }

  private _nActiveReds(t: RefSimulator): number {
    const balls = t.getBalls();
    let count = 0;
    for (let i = 0, n = balls.length; i !== n; ++i) {
      if (balls[i].number === 1 && balls[i].active) count++;
    }
    return count;
  }

  // PCOL L12868-12815：彩球逐个归位（原位→空位→中线扫描）。
  private _liveRespotColorBalls(t: BallRefLike[], e: RefSimulator): void {
    const clearance = 1.05 * e.ballRadius;
    const occupiedSpots = this._tmpOccupiedSpots;
    let ball: BallRefLike;
    occupiedSpots.length = 0;
    for (let i = t.length - 1; i >= 0; --i) {
      ball = t[i];
      if (!e.touchBalls(ball.index, ball.spot, clearance)) {
        t.splice(i, 1);
        e.respotIndexDefault(ball.index);
      }
      occupiedSpots[ball.number] = 1;
    }
    if (t.length === 0) return;
    t.sort(this._respotColorBallsSortHandler);
    const balls = e.getBalls();
    for (let i = balls.length - 1; i >= 0 && !((ball = balls[i]).number < 2); --i) {
      const pending = t[t.length - 1].index;
      if (!occupiedSpots[ball.number] && !e.touchBalls(pending, ball.spot, clearance)) {
        // pop 前 t.length ≥ 1（此处仅剩收尾断言责任）
        e.resetBallPosition(t.pop() as BallRefLike, ball.spot);
        if (t.length === 0) return;
      }
    }
    const ground = e.ground as unknown as GroundSizeLike;
    const tmpA = this._tmpA;
    const tmpB = this._tmpB;
    const tmpSections = this._tmpSections;
    const unitZ = Vec3.UNIT_Z;
    for (let i = t.length - 1; i >= 0; --i) {
      const target = t[i];
      const spot = target.spot;
      tmpA.set(ground.centerPosition.x - ground.size.x / 2 + clearance, spot.y, spot.z);
      tmpB.set(ground.centerPosition.x + ground.size.x / 2 - clearance, spot.y, spot.z);
      let attempts = 10;
      for (; attempts > 0 && !sections.sectionsBallsAB(e.getBalls(), target, clearance, tmpA, tmpB, tmpSections, unitZ); ) {
        tmpA.addScaled(unitZ, tmpSections[0]);
        tmpB.addScaled(unitZ, tmpSections[0]);
        attempts--;
      }
      if (attempts > 0) {
        const offset = sections.findClosestTInSections(spot.x - tmpA.x, tmpSections);
        e.resetBallXYZ(target, tmpA.x + offset, tmpA.y, tmpA.z);
      } else {
        e.resetBallPosition(target, target.spot);
      }
    }
  }

  // PCOL L12787-12813：母球 D 区自动落点（直径线→弧步进）。
  private _liveRespotCueBall(t: RefSimulator): void {
    const clearance = 1.05 * t.ballRadius;
    const cue = t.getBallAtIndex(0);
    if (!t.touchBalls(0, cue.spot, clearance)) return t.respotIndexDefault(0);
    const dArea = this._dArea;
    const A = this._tmpA.copy(dArea.diameterA);
    const B = this._tmpB.copy(dArea.diameterB);
    const sectionResults = this._tmpSections;
    let depth = 0;
    const radius = dArea.radius;
    A.y = cue.spot.y;
    B.y = cue.spot.y;
    for (; !sections.sectionsBallsAB(t.getBalls(), cue, clearance, A, B, sectionResults, dArea.arcDir); ) {
      if ((depth += sectionResults[0]) > radius) return t.respotIndexDefault(0);
      const arcOffset = radius - Math.sqrt(radius * radius - depth * depth);
      A.addScaled(dArea.arcDir, sectionResults[0]).addScaled(dArea.diameterDir, arcOffset);
      B.addScaled(dArea.arcDir, sectionResults[0]).addScaled(dArea.diameterDir, -arcOffset);
    }
    const center = sections.findCenterOfLongestInSections(sectionResults);
    t.resetBallPosition(cue, A.addScaled(dArea.diameterDir, center));
  }
}

interface GroundSizeLike {
  centerPosition: { x: number };
  size: { x: number };
}

// 模 55 实际实现：Ref 单例注册表。
const CACHED: Record<string, SnookerRef> = {};
const CTORS = Object.create(null) as Record<string, typeof SnookerRef>;
CTORS["std-sno"] = SnookerRef;

export const RefRegistry = {
  getInstance(t: string): SnookerRef {
    const cached = CACHED[t];
    if (cached !== undefined) return cached;
    const ctor = CTORS[t];
    if (ctor !== undefined) {
      const created = new ctor();
      CACHED[t] = created;
      return created;
    }
    throw new Error('Ref not found: "' + t + '"');
  }
};
