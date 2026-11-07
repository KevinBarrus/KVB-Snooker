/**
 * 联机开发原型出杆动画器：实现控制器窄接口 ShotLauncher。
 * 只发送 prepare-shot 意图并播放受认可的球杆动画；不施加冲量、不推进物理、不产生本地声音/结算。
 * 动画触球只标记 camera.shotView.struck；球运动完全来自 RemoteView 的权威快照。
 */
import type { PersonController } from "./controller/person-controller.js";
import type { ShotLauncher } from "./controller/shot-controller.js";
import { TipMotion } from "./controller/tip-motion.js";
import type { CommandMessage } from "./net/protocol.js";
import type { NetSessionState } from "./net/net-session-state.js";

export interface NetShotDeps {
  readonly session: NetSessionState;
  readonly send: (command: CommandMessage) => void;
  readonly now: () => number;
}

/** 最多把动画加速到 3 倍；超出时按原速播放并记录与投影触球时刻的偏差。 */
const MAX_SPEED_UP = 3;
/** 最多放慢到 0.2 倍，避免异常提前量把出杆拖成慢动作。 */
const MIN_SPEED_UP = 0.2;

export class NetShotLauncher implements ShotLauncher {
  readonly motion = new TipMotion();
  private actor: PersonController | null = null;
  private started = false;
  private struck = false;
  private animationSpeed = 1;
  private touchDuration = 0;
  private elapsed = 0;

  constructor(private readonly deps: NetShotDeps) {}

  get busy(): boolean { return this.actor !== null; }
  get inputLocked(): boolean { return this.actor !== null && !this.struck; }
  get isStruck(): boolean { return this.struck; }
  get launchingController(): PersonController | null { return this.actor; }

  launch(person: PersonController): boolean {
    if (this.busy || !person.isReadyToStroke() || !this.motion.isReady()) return false;
    const command = this.deps.session.beginShot(person.getStrokeVars(), this.deps.now());
    if (!command) return false;
    this.actor = person;
    this.started = false;
    this.struck = false;
    this.animationSpeed = 1;
    this.touchDuration = 0;
    this.elapsed = 0;
    this.motion.reset();
    this.deps.send(command);
    return true;
  }

  /** 每帧调用：等待确认 → 按投影触球时刻缩放 dt 播放后拉/出杆 → 结算后收尾。 */
  update(dt: number, nowMs: number): void {
    const person = this.actor;
    if (!person) return;
    const phase = this.deps.session.pendingPhase;
    if (phase === "idle") { this.finish(); return; }
    if (phase === "settled") { this.finish(); return; }
    if (!this.started) {
      if (phase !== "prepared" && phase !== "fired") return;
      // 本帧 dt 属于动画开始之前，不消费；下一帧才推进后拉。
      this.beginAnimation(person, nowMs);
      return;
    }
    if (!this.motion.needsUpdate) return;
    // 帧内动画时间与真实 dt 线性对应：先记录帧初状态，触球跨帧时换算精确真实时刻。
    const frameStartElapsed = this.elapsed;
    const animationDelta = dt * this.animationSpeed;
    let remaining = animationDelta;
    while (remaining > 0 && this.motion.needsUpdate) {
      const step = this.motion.tick(remaining);
      remaining -= step;
      this.elapsed += step;
      this.motion.updateLength(person.simulator.getCueBallPosition(), person.radius);
      person.stick.leadingSpace = this.motion.length;
      if (step <= 0) break;
    }
    if (!this.struck && this.touchDuration > 0 && frameStartElapsed < this.touchDuration &&
        frameStartElapsed + animationDelta >= this.touchDuration) {
      this.struck = true;
      person.camera.shotView.struck = true;
      const crossingMs = (this.touchDuration - frameStartElapsed) / this.animationSpeed * 1_000;
      this.deps.session.noteAnimationTouch(nowMs - dt * 1_000 + crossingMs);
    }
  }

  finish(): void {
    const person = this.actor;
    this.actor = null;
    this.started = false;
    this.struck = false;
    this.elapsed = 0;
    this.touchDuration = 0;
    this.motion.reset();
    if (!person) return;
    person.camera.endShotView();
    person.camera.unfollow();
    person.gotoState0();
  }

  private beginAnimation(person: PersonController, nowMs: number): void {
    const projectedTouch = this.deps.session.projectedTouchAtMs();
    const touchDuration = this.motion.launch(person.stick, person.strokePower);
    this.touchDuration = touchDuration;
    this.started = true;
    this.elapsed = 0;
    person.camera.beginShotView();
    if (projectedTouch === null) {
      this.animationSpeed = 1;
      return;
    }
    const remainingSeconds = (projectedTouch - nowMs) / 1000;
    if (remainingSeconds <= 0) {
      // 剩余时间不足：照常按原速播放，触球会晚于服务器权威触球，偏差由时序记录体现。
      this.animationSpeed = 1;
      return;
    }
    const speed = touchDuration / remainingSeconds;
    this.animationSpeed = speed > MAX_SPEED_UP ? 1 : Math.max(MIN_SPEED_UP, speed);
  }
}
