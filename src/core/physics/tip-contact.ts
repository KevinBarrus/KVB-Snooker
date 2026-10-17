import { Matrix3 } from "../math/matrix3.js";
import { Body } from "./body.js";
import { Vec3 } from "../math/vec3.js";
import { ContactSS } from "./contact.js";

function zeroInertia(): Matrix3 {
  const m = new Matrix3();
  m.set(0, 0, 0, 0, 0, 0, 0, 0, 0); // 角动量通道关闭（PCOL L13662：3x3 全零）
  return m;
}

/**
 * PCOL L13645-13684（原模 86）：皮头击球接触——击球被建模为一次接触求解。
 * restitution 0（皮头不反弹）+ friction 0.9（高摩擦咬球）——塞经偏心触点的切向冲量传递（spec 02 §5）。
 *
 * 已登记差异：原作 bj 为裸对象（无 Body 字段）；本实现 bj 用真实
 * Body 实例 + 零惯量矩阵，与接触系统内部读取（bj.w/invInertia/invMass/radius）结构等价，
 * 同时保持类型通顺。tip 不入池、free 仅清 bi。
 */
export class TipContact extends ContactSS {
  // bj 类型继承自 ContactBase（Body|null）；dispose 置 null（原作 L13680）
  constructor(tipMass: number) {
    super(null, 0); // poolIndex = -1
    this.isSS = false;
    this.restitution = 0;
    this.friction = 0.9;

    const bj = new Body(tipMass);
    bj.invInertia.copy(zeroInertia());
    this.bj = bj;
  }

  /**
   * 输入契约（spec 02 §4 击球链路）：
   * e[0..2]=皮头触点世界坐标 / e[3..5]=方向单位向量 / e[6]=力度标量 / e[7]=皮头半径。
   */
  resetTip(ball: Body, e: ArrayLike<number>): void {
    this.bi = ball; // 原作直赋（L13667），不等价于 resetWithBiBj
    const bj = this.bj!;
    bj.radius = e[7];
    bj.v.set(e[3], e[4], e[5]).scale(e[6]);
    const pos = ball.position;
    this._normal.set(pos.x - e[0], pos.y - e[1], pos.z - e[2]).normalize();
    this.markNormalRelatedDirty();
  }

  override free(): void {
    this.bi = null;
  }

  override dispose(): void {
    this.bi = null;
    this.bj = null;
  }
}
