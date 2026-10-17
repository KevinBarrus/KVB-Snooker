import type { CollisionPolygon } from "./collision-polygon.js";
import type { PoolHost } from "./pool.js";
import { Vec3 } from "../math/vec3.js";
import { ContactBase } from "./contact.js";
import type { Body } from "./body.js";

/**
 * PCOL L14110-14169（原模 92）：球-多边形接触（SP）。
 * 已登记差异：bj 以 Body 槽位存储 CollisionPolygon（类型通道，运行时仅走 poly 分支；
 * isSS=false 的 SS 机制路径对 SP 永不生效）。基类 updateRelVelocity 与原作 SP 重写
 * 版逐字相同，故不再复制声明。
 */
export class ContactSP extends ContactBase {
  contactPoint = new Vec3(0, 0, 0);

  /** CP 法线处理器（原作 ctor 定义为 arrow 字段；SP 默认处理器即 CP 版）。 */
  private readonly normalUpdateCP = () => {
    this.normalDirty = false;
    const bj = this.bjPoly;
    if (bj.hasCustomNormalHandler) {
      bj.customNormalHandler!(this.contactPoint, this._normal);
    } else {
      this._normal.subVectors(this.bi!.position, this.contactPoint);
      const len = this._normal.length();
      if (len < Vec3.EPSILON) {
        this._normal.copy(bj.normal);
      } else {
        this._normal.scale(1 / len);
      }
    }
  };

  constructor(host: PoolHost | null, poolIndex: number) {
    super(host, poolIndex);
    this.normalUpdateHandler = this.normalUpdateCP;
  }

  private get bjPoly(): CollisionPolygon {
    return this.bj as unknown as CollisionPolygon;
  }

  resetRestingWithPeneCP(depth: number, contactPoint: Vec3): void {
    this._penetration = depth > -Vec3.EPSILON ? 0 : depth;
    this.restingCheckPosI.copy(this.bi!.position);
    this.contactPoint.copy(contactPoint);
    this.normalUpdateHandler = this.normalUpdateCP;
    this.markNormalDirty();
  }

  resetPendingWithToiPeneNormal(bi: Body, poly: CollisionPolygon, toi: number, penetration: number, normal: Vec3): void {
    this.resetWithBiBj(bi, poly as unknown as Body);
    this.toi = toi;
    this._penetration = penetration > -Vec3.EPSILON ? 0 : penetration;
    this.cdRoundI = bi.cdRound;
    this.life = 0;
    this.normalDirty = false;
    if (!this._normal.almostEquals(normal)) {
      this._normal.copy(normal);
      this.markNormalRelatedDirty();
    }
  }

  resetPendingWithToiPeneCP(bi: Body, poly: CollisionPolygon, toi: number, penetration: number, contactPoint: Vec3): void {
    this.resetWithBiBj(bi, poly as unknown as Body);
    this.toi = toi;
    this._penetration = penetration > -Vec3.EPSILON ? 0 : penetration;
    this.cdRoundI = bi.cdRound;
    this.life = 0;
    this.contactPoint.copy(contactPoint);
    this.normalUpdateHandler = this.normalUpdateCP;
    this.markNormalDirty();
  }

  protected override updateForceArm(): void {
    this.armDirty = false;
    this._armLenI = this.bi!.radius;
    this._armI.scaleVector(-this._armLenI, this.normal);
  }
}
