import { Vec3 } from "../math/vec3.js";
import { Quaternion } from "../math/quaternion.js";
import { Body } from "./body.js";

/** PCOL L11577-11602（原模 36）：球形刚体，语义 1:1。 */
export class BodySphere extends Body {
  radius: number;
  radiusSq: number;
  /** 渲染层插值状态（syncStates 每 WorldClient.step 后驱动视觉平滑）。 */
  states = {
    position: new Vec3(),
    orientation: new Quaternion()
  };

  constructor(
    radius: number,
    mass: number,
    x?: number,
    y?: number,
    z?: number,
    eulerX?: number,
    eulerY?: number,
    eulerZ?: number
  ) {
    super(mass, x, y, z, eulerX, eulerY, eulerZ);
    this.radius = radius;
    this.radiusSq = radius * radius;
    // 实心球惯量 I = 2/5·m·r² → invInertia = 1/(0.4·m·r²)
    const invInertiaScalar = 1 / (0.4 * this.mass * this.radiusSq);
    this.invInertia.set(invInertiaScalar, 0, 0, 0, invInertiaScalar, 0, 0, 0, invInertiaScalar);
  }

  /** 速度型运动量：角速度按半径折算为线速度（PCOL L11595）。 */
  override getMotion(): number {
    return this.vSq + this.wSq * this.radiusSq;
  }

  /** states.position = position + v·t；states.orientation = 跟随 w 的半步积分（美术插值）。 */
  syncStates(t: number): void {
    const state = this.states;
    state.position.interpolate(this.position, this.v, t);
    state.orientation.integrateQuad(this.orientation, this.w, t);
  }
}
