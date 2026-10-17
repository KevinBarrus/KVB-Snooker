import { Vec3 } from "../math/vec3.js";
import { Matrix3 } from "../math/matrix3.js";
import { Quaternion } from "../math/quaternion.js";
import { PHYSICS } from "./constants.js";
import { coreRandom } from "../rng.js";

/**
 * PCOL L11324-11576（原模 35）：刚体基类，语义 1:1。
 * dispose() 未实现：原作仅置空引用，属销毁路径，待 World 池机制落地时统一处理（见 AGENTS.md）。
 */
export const BODY_VSTATE = {
  ZERO: 0,
  SLOWER: 1,
  FASTER: 2,
  DIR_CHANGE: 3
} as const;

/** 序列化字段表（PCOL L11336：uid/active 特殊处理，其余按 typeof 逐字段）。 */
const SERIAL_FIELDS = [
  "uid",
  "active",
  "acc",
  "cdRound",
  "v",
  "vProp_dir",
  "vProp_sq",
  "vProp_dirty",
  "vChangedCount",
  "vProp0_dir",
  "vProp0_sq",
  "__vState",
  "__vStateDirty",
  "w",
  "wProp_sq",
  "wProp_dirty",
  "position",
  "orientation",
  "predictionDirty",
  "steppedLenSq",
  "canSleep",
  "asleep",
  "energy"
] as const;

export class Body {
  uid = -1;
  active = true;
  /** 碰撞半径（Sphere 覆写；接触/CCD 力臂计算需要，基类默认 0）。 */
  radius = 0;
  radiusSq = 0;
  mass: number;
  invMass: number;
  acc = PHYSICS.gravity.clone();
  cdRound = 0;
  v = new Vec3();
  vProp_dir = new Vec3();
  vProp_sq = 0;
  vProp_dirty = false;
  vChangedCount = 0;
  vProp0_dir = new Vec3();
  vProp0_sq = 0;
  __vState = 0;
  __vStateDirty = false;
  w = new Vec3(0, 0, 0);
  wProp_sq = 0;
  wProp_dirty = false;
  invInertia = new Matrix3();
  airAngularDamping = PHYSICS.airAngularDamping;
  rfPower = 0;
  rfDir = new Vec3(0, 0, 0);
  position: Vec3;
  orientation: Quaternion;
  predictionDirty = false;
  steppedLenSq = 0;
  canSleep = true;
  asleep = false;
  /** 构造时取 statics 值（World.stepSize 未设定前为 NaN，与原作一致）。 */
  energy = NaN;
  userData: unknown = null;
  restitution = 0;
  friction = 0;
  peneOffset = new Vec3(0, 0, 0);
  penetration = 0;
  serializable = true;
  collisionGroup = 1;
  collisionMask = 0;

  // 静态睡眠参数（PCOL L11565-11568：World.stepSize setter 赋 minEnergy 系）
  static baseSleepBias = 0.3;
  static minEnergy = NaN;
  static maxEnergy = NaN;
  static wakeUpEnergy = NaN;
  static vStates = BODY_VSTATE;

  constructor(
    mass: number,
    x?: number,
    y?: number,
    z?: number,
    eulerX?: number,
    eulerY?: number,
    eulerZ?: number
  ) {
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.position = new Vec3(x ?? 0, y ?? 0, z ?? 0);
    this.orientation = new Quaternion().setFromEuler(eulerX ?? 0, eulerY ?? 0, eulerZ ?? 0);
    // 原作构造时取 statics（PCOL L11355）
    this.energy = Body.minEnergy;
  }

  get wSq(): number {
    if (this.wProp_dirty) {
      this.wProp_dirty = false;
      this.wProp_sq = this.w.lengthSq();
    }
    return this.wProp_sq;
  }

  get vDir(): Vec3 {
    if (this.vProp_dirty) this.updateVProps();
    return this.vProp_dir;
  }

  get vSq(): number {
    if (this.vProp_dirty) this.updateVProps();
    return this.vProp_sq;
  }

  get vState(): number {
    if (this.__vStateDirty) this.updateVState();
    return this.__vState;
  }

  serialize(t: number[]): void {
    if (!this.serializable) {
      // 原作为 Math.random；改用播种 RNG（AGENTS 怪癖 6，登记差异）
      t.push(-1 - Math.floor(10 * coreRandom()));
      return;
    }
    t.push(this.uid);
    t.push(this.active ? 1 : 0);
    if (!this.active) return;
    const fields = SERIAL_FIELDS;
    for (let i = 2, n = fields.length; i !== n; ++i) {
      const value = this[fields[i]] as unknown;
      switch (typeof value) {
        case "number":
          t.push(value);
          break;
        case "boolean":
          t.push(value ? 1 : 0);
          break;
        case "object":
          (value as Vec3 | Quaternion).toArray(t, t.length);
          break;
      }
    }
  }

  deserialize(t: number[], e: number): number {
    if (t[e] < 0) return e + 1;
    if (t[e + 1] === 0) {
      this.active = false;
      return e + 2;
    }
    this.active = true;
    e += 2;
    const fields = SERIAL_FIELDS;
    for (let i = 2, n = fields.length; i !== n; ++i) {
      const key = fields[i];
      const current = this[key] as unknown;
      switch (typeof current) {
        case "number":
          this[key] = t[e++] as unknown as never;
          break;
        case "boolean":
          this[key] = (t[e++] !== 0) as unknown as never;
          break;
        case "object":
          e += (current as Vec3 | Quaternion).fromArray(t as number[], e);
          break;
      }
    }
    return e;
  }

  setSleep(): this {
    if (!this.asleep) {
      this.asleep = true;
      this.energy = 0;
      this.vProp0_dir.set(0, 0, 0);
      this.vProp0_sq = 0;
      this.v.set(0, 0, 0);
      this.w.set(0, 0, 0);
      this.__vStateDirty = true;
      this.vProp_dirty = true;
      this.wProp_dirty = true;
    }
    return this;
  }

  wakeUp(): this {
    if (this.asleep) {
      this.asleep = false;
      this.energy = Body.wakeUpEnergy;
    }
    return this;
  }

  applyForce(f: Vec3): this {
    this.acc.addScaled(f, this.invMass);
    return this.wakeUp();
  }

  applyForce2(scale: number, force: Vec3): this {
    this.acc.addScaled(force, this.invMass * scale);
    return this.wakeUp();
  }

  /** PCOL L11433：rfDir 被复用为"归一化力"（先归一自身，后钳制各轴 w），逐步置零 —— 保留原作复用技巧。 */
  predVelocities(dt: number): void {
    this.predictionDirty = false;
    if (this.asleep) return;
    this.v.addScaled(this.acc, dt);
    if (this.rfPower !== 0) {
      const rf = this.rfDir.normalize().scale(this.rfPower);
      const rx = rf.x >= 0 ? rf.x : -rf.x;
      const ry = rf.y >= 0 ? rf.y : -rf.y;
      const rz = rf.z >= 0 ? rf.z : -rf.z;
      const w = this.w;
      w.x = w.x > rx ? w.x - rx : w.x < -rx ? w.x + rx : 0;
      w.y = w.y > ry ? w.y - ry : w.y < -ry ? w.y + ry : 0;
      w.z = w.z > rz ? w.z - rz : w.z < -rz ? w.z + rz : 0;
      this.rfPower = 0;
      rf.set(0, 0, 0);
    }
    this.w.scale(this.airAngularDamping);
    this.__vStateDirty = true;
    this.vProp_dirty = true;
    this.vChangedCount++;
  }

  /** t=冲量 e=力臂 i=滚动冲量：w += invInertia·(e×t)，rfPower=max(rfPower,i)，rfDir += e×t。 */
  applyImpulseAtPoint(t: Vec3, e: Vec3, i: number): void {
    this.v.addScaled(t, this.invMass);
    const torque = new Vec3().crossVectors(e, t);
    this.invInertia.transform(torque, torque); // 原作 transform(s, s) 同参：读后再写，安全
    this.w.add(torque);
    if (i > this.rfPower) this.rfPower = i;
    this.rfDir.add(torque);
    this.__vStateDirty = true;
    this.vProp_dirty = true;
    this.wProp_dirty = true;
    this.vChangedCount++;
    this.wakeUp();
    this.canSleep = true;
  }

  /** 返回 true 表示本步后已睡眠/保持睡眠；_false 默认继续活动。 */
  step(dt: number): boolean {
    if (this.asleep) {
      this.steppedLenSq = 0;
      this.penetration = 0;
      return true;
    }
    this.position.addScaled(this.v, dt);
    if (this.penetration !== 0) {
      this.position.add(this.peneOffset);
      this.penetration = 0;
      this.canSleep = false;
    }
    this.orientation.integrate(this.w, dt);
    this.acc.copy(PHYSICS.gravity);
    this.steppedLenSq = this.vSq * dt;
    const bias = Math.pow(Body.baseSleepBias, dt);
    let energy = bias * this.energy + (1 - bias) * this.getMotion();
    if (energy > Body.maxEnergy) {
      energy = Body.maxEnergy;
    } else if (energy < Body.minEnergy && this.canSleep) {
      this.setSleep();
      return true;
    }
    this.energy = energy;
    this.vProp0_dir.copy(this.vDir);
    this.vProp0_sq = this.vSq;
    return false;
  }

  /** PCOL L11436-11445：仅置空引用（池销毁路径；原作类型为动态语言置 null）。 */
  dispose(): void {
    const n = null as unknown as Vec3;
    this.acc = n;
    this.v = n;
    this.vProp_dir = n;
    this.vProp0_dir = n;
    this.w = n;
    this.invInertia = n as unknown as never;
    this.position = n;
    this.orientation = n as unknown as never;
    this.userData = null;
  }

  addPeneOffset(depth: number, offset: Vec3): void {
    if (depth < this.penetration) {
      this.penetration = depth;
      this.peneOffset.copy(offset);
      if (depth < -0.001) this.wakeUp();
    }
  }

  reset(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    this.vProp0_dir.set(0, 0, 0);
    this.vProp0_sq = 0;
    this.acc.copy(PHYSICS.gravity);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.__vStateDirty = true;
    this.vProp_dirty = true;
    this.wProp_dirty = true;
    return this.wakeUp();
  }

  /** v 向量平方低于 EPSILON 时原地归零（PCOL L11537-11542 怪癖）。 */
  updateVProps(): void {
    this.vProp_dirty = false;
    this.vProp_sq = this.v.lengthSq();
    const dir = this.vProp_dir;
    if (this.vProp_sq < Vec3.EPSILON) {
      this.vProp_sq = 0;
      dir.set(0, 0, 0);
      this.v.set(0, 0, 0);
    } else {
      dir.scaleVector(1 / Math.sqrt(this.vProp_sq), this.v);
    }
  }

  updateVState(): void {
    this.__vStateDirty = false;
    const v = this.vSq;
    if (v === 0) {
      this.__vState = BODY_VSTATE.ZERO;
      return;
    }
    if (v > this.vProp0_sq) {
      this.__vState = BODY_VSTATE.FASTER;
      return;
    }
    this.__vState =
      1 - Vec3.EPSILON > this.vDir.dot(this.vProp0_dir)
        ? BODY_VSTATE.DIR_CHANGE
        : BODY_VSTATE.SLOWER;
  }

  getMotion(): number {
    return this.vSq + this.wSq;
  }
}
