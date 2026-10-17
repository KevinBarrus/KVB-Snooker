import { Vec3 } from "../math/vec3.js";
import { Matrix3 } from "../math/matrix3.js";
import { Body } from "./body.js";

/** 池宿主接口（Contact 从对象池分配时的弱引用宿主，见原模 38）。 */
export interface ContactPoolRef {
  freeIndex(poolIndex: number): void;
}

/**
 * PCOL L9418-9632（原模 22）：接触基类（单体侧语义）。
 * bi/bj 可空：free()/dispose() 后由池回收，脏标记惰性重建。
 */
export class ContactBase {
  __weakParent: ContactPoolRef | null;
  poolIndex: number;
  inUse = false;
  next: ContactBase | null = null;
  prev: ContactBase | null = null;
  isSS = false;
  markedAsKilled = false;
  bi: Body | null = null;
  bj: Body | null = null;
  idi = NaN;
  idj = NaN;
  cdRoundI = NaN;
  cdRoundJ = NaN;
  restitution = 0;
  friction = 0;
  toi = 0;
  life = 0;
  protected _penetration = 0;
  protected restingCheckPosI = new Vec3(0, 0, 0);
  protected restingCheckPosJ = new Vec3(0, 0, 0);
  normalUpdateHandler: (() => void) | null = null;
  protected armDirty = false;
  protected _armI = new Vec3(0, 0, 0);
  protected _armLenI = 0;
  protected bounceThresholdDirty = false;
  protected _bounceThreshold = 0;
  protected relVelDirty = false;
  protected _closeSpeed = 0;
  protected relativeVelW = new Vec3();
  protected relVelWJ = new Vec3();
  protected vChangedCountI = -1;
  protected vChangedCountJ = -1;
  protected spaceTransformDirty = false;
  protected _m_loc2Wor = new Matrix3();
  protected _m_wor2Loc = new Matrix3();
  protected impulseTransformDirty = false;
  protected _m_locVel2Imp = new Matrix3();
  protected _m_imp2LocVel = new Matrix3();
  protected m_imp2WorVel = new Matrix3();
  protected m_imp2LocVel2 = new Matrix3();
  protected skewSymmetric = new Matrix3();
  protected normalDirty = false;
  protected _normal = new Vec3(0, 0, 0);
  rollingFriction = 0.013;

  /** spec 01 §4.2：gt = 2.3·stepSize·gravity，由 World.stepSize setter 写入。 */
  static gt = new Vec3();

  constructor(weakParent: ContactPoolRef | null, poolIndex: number) {
    this.__weakParent = weakParent;
    this.poolIndex = weakParent ? poolIndex : -1;
  }

  get label(): string {
    return `${this.idi}->${this.idj}`;
  }

  get penetration(): number {
    return this._penetration;
  }

  get normal(): Vec3 {
    if (this.normalDirty) this.normalUpdateHandler!();
    return this._normal;
  }

  get bounceThreshold(): number {
    if (this.bounceThresholdDirty) {
      this.bounceThresholdDirty = false;
      this._bounceThreshold = ContactBase.gt.dot(this.normal);
    }
    return this._bounceThreshold;
  }

  get armI(): Vec3 {
    if (this.armDirty) this.updateForceArm();
    return this._armI;
  }

  get armLenI(): number {
    if (this.armDirty) this.updateForceArm();
    return this._armLenI;
  }

  get spaceTransformL2W(): Matrix3 {
    if (this.spaceTransformDirty) this.updateSpaceTransform();
    return this._m_loc2Wor;
  }

  get spaceTransformW2L(): Matrix3 {
    if (this.spaceTransformDirty) this.updateSpaceTransform();
    return this._m_wor2Loc;
  }

  get transformImp2LocVel(): Matrix3 {
    if (this.impulseTransformDirty) this.updateImpulseTransform();
    return this._m_imp2LocVel;
  }

  get transformLocVel2Imp(): Matrix3 {
    if (this.impulseTransformDirty) this.updateImpulseTransform();
    return this._m_locVel2Imp;
  }

  toString(): string {
    return `${this.label}: {toi:${this.toi}, life:${this.life}, outdated:${this.isOutdated()}, isSS:${this.isSS}}`;
  }

  free(): void {
    this.bi = null;
    this.bj = null;
    this.inUse = false;
    this.__weakParent?.freeIndex(this.poolIndex);
  }

  dispose(): void {
    this.bi = null;
    this.bj = null;
    this.inUse = false;
    this.__weakParent = null;
  }

  activate(): this {
    this.inUse = true;
    this.life = 0;
    this.toi = Number.MAX_VALUE;
    this._penetration = 0;
    return this;
  }

  isOutdated(): boolean {
    return this.cdRoundI !== this.bi!.cdRound || this.markedAsKilled;
  }

  startResting(): void {
    const bi = this.bi!;
    const bj = this.bj!;
    this.restingCheckPosI.copy(bi.position);
    this.restingCheckPosJ.copy(bj.position);
    this.restitution = bi.restitution > bj.restitution ? bj.restitution : bi.restitution;
    this.friction = bi.friction > bj.friction ? bi.friction : bj.friction;
  }

  needsUpdateResting(): boolean {
    return (
      !this.restingCheckPosI.almostEquals(this.bi!.position) ||
      !this.restingCheckPosJ.almostEquals(this.bj!.position)
    );
  }

  resetRestingWithPeneNormal(depth: number, normal: Vec3): void {
    this._penetration = depth > -Vec3.EPSILON ? 0 : depth;
    this.restingCheckPosI.copy(this.bi!.position);
    this.normalDirty = false;
    if (!this._normal.almostEquals(normal)) {
      this._normal.copy(normal);
      this.markNormalRelatedDirty();
    }
  }

  stopResting(): void {
    this.bi!.wakeUp();
    this.bj!.wakeUp();
  }

  resetWithBiBj(bi: Body, bj: Body | null): void {
    if (this.bi !== bi || this.bj !== bj) {
      this.bi = bi;
      this.idi = bi.uid;
      this.bj = bj;
      this.idj = bj ? bj.uid : NaN;
      this.markObjectChanged();
    }
  }

  getCloseSpeed(): number {
    if (this.relVelDirty || this.vChangedCountI !== this.bi!.vChangedCount) this.updateRelVelocity();
    return this._closeSpeed;
  }

  getRelativeVelocity(): Vec3 {
    this.getCloseSpeed();
    return this.relativeVelW;
  }

  /** 单体版相对速度（此单体法向分量）；SS 版重写加 J 侧。 */
  protected updateRelVelocity(): void {
    this.vChangedCountI = this.bi!.vChangedCount;
    this.relVelDirty = false;
    this.relativeVelW.setCrossThenAdd(this.bi!.w, this.armI, this.bi!.v);
    this._closeSpeed = this.relativeVelW.dot(this.normal);
  }

  markNormalRelatedDirty(): void {
    this.bounceThresholdDirty = true;
    this.spaceTransformDirty = true;
    this.armDirty = true;
    this.relVelDirty = true;
    this.impulseTransformDirty = true;
  }

  markNormalDirty(): void {
    this.normalDirty = true;
    this.markNormalRelatedDirty();
  }

  markObjectChanged(): void {
    this.armDirty = true;
    this.relVelDirty = true;
    this.impulseTransformDirty = true;
  }

  protected updateForceArm(): void {
    this.armDirty = false;
    console.log("BaseContact.updateForceArm: Overwrite me!!!"); // 原作哨兵（L9580）
  }

  /** 法线 → 正交基（局部 x 轴 = 法线）；分支构造避免除零；公式照抄（PCOL L9595-9613）。 */
  protected updateSpaceTransform(): void {
    this.spaceTransformDirty = false;
    const n = this.normal;
    const a = new Vec3();
    const o = new Vec3();
    if (Math.abs(n.x) > Math.abs(n.y)) {
      const inv = 1 / Math.sqrt(n.z * n.z + n.x * n.x);
      a.set(n.z * inv, 0, -n.x * inv);
      o.set(n.y * a.z, n.z * a.x - n.x * a.z, -n.y * a.x);
    } else {
      const inv = 1 / Math.sqrt(n.z * n.z + n.y * n.y);
      a.set(0, -n.z * inv, n.y * inv);
      o.set(n.y * a.z - n.z * a.y, -n.x * a.z, n.x * a.y);
    }
    this._m_loc2Wor.setComponents(n, a, o);
    this._m_wor2Loc.setTranspose(this._m_loc2Wor);
  }

  /** 冲量-等效速度矩阵 B = W2L·(−Σ I⁻¹·[arm]×²)·L2W + invMass·I → invert（单体版）。 */
  protected updateImpulseTransform(): void {
    this.impulseTransformDirty = false;
    const m = this._m_imp2LocVel;
    const skew = this.skewSymmetric.setSkewSymmetric(this.armI);
    const i = this.m_imp2WorVel.copy(skew);
    i.multiply(this.bi!.invInertia);
    i.multiply(skew);
    i.multiplyScalar(-1);
    m.copy(this.spaceTransformW2L);
    m.multiply(i);
    m.multiply(this.spaceTransformL2W);
    m.addToDiagonal(this.bi!.invMass);
    this._m_locVel2Imp.setInverse(m);
  }
}

/**
 * PCOL L11603-11707（原模 37）：球-球接触（双体侧：J 侧字段 + 对称冲量变换）。
 */
export class ContactSS extends ContactBase {
  protected _armJ = new Vec3(0, 0, 0);
  protected _armLenJ = 0;

  constructor(weakParent: ContactPoolRef | null, poolIndex: number) {
    super(weakParent, poolIndex);
    this.isSS = true;
    this.rollingFriction = 0; // SS 无滚动摩擦（spec 02 §5 摩擦表）
    // 默认法线：bi − bj 归一，退化取 (0,1,0)（PCOL L11632-11640）
    this.normalUpdateHandler = () => {
      this.normalDirty = false;
      this._normal.subVectors(this.bi!.position, this.bj!.position);
      const len = this._normal.length();
      if (len < Vec3.EPSILON) {
        this._normal.set(0, 1, 0);
      } else {
        this._normal.scale(1 / len);
      }
    };
  }

  get armJ(): Vec3 {
    if (this.armDirty) this.updateForceArm();
    return this._armJ;
  }

  get armLenJ(): number {
    if (this.armDirty) this.updateForceArm();
    return this._armLenJ;
  }

  override isOutdated(): boolean {
    return (
      this.cdRoundI !== this.bi!.cdRound ||
      this.cdRoundJ !== this.bj!.cdRound ||
      this.markedAsKilled
    );
  }

  override needsUpdateResting(): boolean {
    return super.needsUpdateResting() || !this.restingCheckPosJ.almostEquals(this.bj!.position);
  }

  override resetRestingWithPeneNormal(depth: number, normal: Vec3): void {
    this.restingCheckPosJ.copy(this.bj!.position);
    super.resetRestingWithPeneNormal(depth, normal);
  }

  resetPendingWithToiPene(bi: Body, bj: Body, toi: number, penetration: number): void {
    this.resetWithBiBj(bi, bj);
    this.toi = toi;
    this._penetration = penetration > -Vec3.EPSILON ? 0 : penetration;
    this.cdRoundI = bi.cdRound;
    this.cdRoundJ = bj.cdRound;
    this.life = 0;
    this.markNormalDirty();
  }

  protected override updateForceArm(): void {
    this.armDirty = false;
    const bi = this.bi!;
    const bj = this.bj!;
    this._armLenI = bi.radius;
    this._armLenJ = bj.radius;
    // 法线指向 bi 外侧：I 侧力臂 = −lenI·normal（指向接触面），J 侧反向
    this._armI.scaleVector(-this._armLenI, this.normal);
    this._armJ.scaleVector(this._armLenJ, this.normal);
  }

  override getCloseSpeed(): number {
    if (
      this.relVelDirty ||
      this.vChangedCountI !== this.bi!.vChangedCount ||
      this.vChangedCountJ !== this.bj!.vChangedCount
    ) {
      this.updateRelVelocity();
    }
    return this._closeSpeed;
  }

  protected override updateRelVelocity(): void {
    this.vChangedCountI = this.bi!.vChangedCount;
    this.vChangedCountJ = this.bj!.vChangedCount;
    this.relVelDirty = false;
    this.relativeVelW.setCrossThenAdd(this.bi!.w, this.armI, this.bi!.v);
    this.relativeVelW.sub(this.relVelWJ.setCrossThenAdd(this.bj!.w, this.armJ, this.bj!.v));
    this._closeSpeed = this.relativeVelW.dot(this.normal);
  }

  /** 双体版：两侧各自的 B(-) 相加后再变换（PCOL L11670-11686）。 */
  protected override updateImpulseTransform(): void {
    this.impulseTransformDirty = false;
    const m = this._m_imp2LocVel;
    let skew = this.skewSymmetric.setSkewSymmetric(this.armI);
    const i = this.m_imp2WorVel.copy(skew);
    i.multiply(this.bi!.invInertia);
    i.multiply(skew);
    i.multiplyScalar(-1);
    skew = this.skewSymmetric.setSkewSymmetric(this.armJ);
    const j = this.m_imp2LocVel2.copy(skew);
    j.multiply(this.bj!.invInertia);
    j.multiply(skew);
    j.multiplyScalar(-1);
    i.add(j);
    m.copy(this.spaceTransformW2L);
    m.multiply(i);
    m.multiply(this.spaceTransformL2W);
    m.addToDiagonal(this.bi!.invMass + this.bj!.invMass);
    this._m_locVel2Imp.setInverse(m);
  }
}
