import type { PersonController } from "./controller/person-controller.js";
import type { ShotLauncher } from "./controller/shot-controller.js";
import { STICK_SPECS } from "./controller/stick-controller.js";
import { TipMotion } from "./controller/tip-motion.js";
import type { CommandMessage } from "./net/protocol.js";
import type { NetSessionState } from "./net/net-session-state.js";

export interface NetShotDeps {
  readonly session: NetSessionState;
  readonly send: (command: CommandMessage) => void;
  readonly now: () => number;
}

const STAND_DELAY_SECONDS = 0.5;

export class NetShotLauncher implements ShotLauncher {
  readonly motion = new TipMotion();
  private actor: PersonController | null = null;
  private started = false;
  private struck = false;
  private stood = false;
  private animationStartServerMs = 0;
  private touchDuration = 0;
  private elapsed = 0;
  private contactErrorValue: number | null = null;

  constructor(private readonly deps: NetShotDeps) {}

  get busy(): boolean { return this.actor !== null; }
  get inputLocked(): boolean { return this.actor !== null && !this.struck; }
  get isStruck(): boolean { return this.struck; }
  get launchingController(): PersonController | null { return this.actor; }
  get contactErrorMm(): number | null { return this.contactErrorValue; }

  launch(person: PersonController): boolean {
    if (this.busy || !person.isReadyToStroke() || !this.motion.isReady()) return false;
    const vars = person.getStrokeVars();
    const command = this.deps.session.beginShot(vars, this.deps.now());
    if (!command) return false;
    this.actor = person;
    this.started = false;
    this.struck = false;
    this.stood = false;
    this.animationStartServerMs = 0;
    this.touchDuration = 0;
    this.elapsed = 0;
    this.motion.reset();
    this.contactErrorValue = this.measureContactError(vars, person);
    this.deps.send(command);
    return true;
  }

  update(nowMs: number, displayServerMs: number): void {
    const person = this.actor;
    if (!person) return;
    const phase = this.deps.session.pendingPhase;
    if (phase === "idle" || this.deps.session.connectionState !== "ready") { this.finish(); return; }
    if (!this.started) {
      const touchAt = this.deps.session.touchAtServerMs;
      if (phase === "awaiting-ack" || touchAt === null) return;
      this.touchDuration = this.motion.launch(person.stick, person.strokePower);
      this.animationStartServerMs = touchAt - this.touchDuration * 1000;
      this.started = true;
      person.camera.beginShotView();
    }
    const targetElapsed = Math.max(0, (displayServerMs - this.animationStartServerMs) / 1000);
    let remaining = Math.max(0, targetElapsed - this.elapsed);
    while (remaining > 0 && this.motion.needsUpdate) {
      const step = this.motion.tick(remaining);
      remaining -= step;
      this.elapsed += step;
      if (step <= 0) break;
    }
    this.motion.updateLength(person.simulator.getCueBallPosition(), person.radius);
    person.stick.leadingSpace = this.motion.length;
    if (!this.struck && targetElapsed >= this.touchDuration) {
      this.struck = true;
      person.camera.shotView.struck = true;
      this.deps.session.noteAnimationTouch(nowMs);
    }
    if (!this.motion.needsUpdate && this.struck && !this.stood &&
        targetElapsed - this.elapsed >= STAND_DELAY_SECONDS) {
      this.stood = true;
      person.gotoState0();
    }
    if (phase === "settled" && this.stood) this.finish();
  }

  finish(): void {
    const person = this.actor;
    this.actor = null;
    this.started = false;
    this.struck = false;
    const stood = this.stood;
    this.stood = false;
    this.elapsed = 0;
    this.touchDuration = 0;
    this.motion.reset();
    if (!person) return;
    if (person.camera.shotView.active) {
      const target = person.camera.shotView.target;
      person.camera.shotView.end();
      person.camera.lookTo(target.x, target.z, false);
      person.camera.unfollow();
    } else {
      person.camera.unfollow();
    }
    if (!stood) person.gotoState0();
  }

  private measureContactError(vars: Float32Array, person: PersonController): number | null {
    const cue = this.deps.session.latestSnapshot?.balls[0];
    if (!cue) return null;
    const distance = Math.hypot(vars[0] - cue.x, vars[1] - cue.y, vars[2] - cue.z);
    return Math.round((distance - (person.radius + STICK_SPECS.tipRadius)) * 10_000) / 10;
  }
}
