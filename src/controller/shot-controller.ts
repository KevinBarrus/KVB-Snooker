import type { EventBus } from "../core/event-bus.js";
import type { PersonController } from "./person-controller.js";
import { TipMotion } from "./tip-motion.js";

export interface ShotCommands {
  begin(playerIndex: number): boolean;
  stroke(playerIndex: number, vars: Float32Array): boolean;
  step(dt: number): void;
}

// PCOL L6338-6423
export class ShotController {
  readonly motion = new TipMotion();
  private actor: PersonController | null = null;
  private strokeDelay = -1;
  private standDelay = -1;

  constructor(private readonly bus: EventBus, private readonly commands: ShotCommands) {}

  get launchingController(): PersonController | null { return this.actor; }
  get inputLocked(): boolean { return this.actor?.locallyControlled === true && this.strokeDelay >= 0; }
  get canJudge(): boolean { return this.actor !== null && !this.motion.needsUpdate && this.actor.camera.stateRatio === 0; }
  get busy(): boolean { return this.actor !== null; }

  launch(person: PersonController): boolean {
    if (this.busy || !person.isReadyToStroke() || !this.motion.isReady() || !this.commands.begin(person.playerIndex)) return false;
    this.actor = person;
    this.bus.emit("sim/shooting-start", { playerIndex: person.playerIndex });
    if (person.locallyControlled) person.camera.beginShotView();
    this.standDelay = 0.5;
    this.strokeDelay = this.motion.launch(person.stick, person.strokePower);
    return true;
  }

  update(dt: number, updatePeople: (dt: number) => void): void {
    const person = this.actor;
    let remaining = dt;
    if (person) {
      while (this.motion.needsUpdate && remaining > 1e-6) {
        let slice = this.motion.tick(remaining);
        remaining -= slice;
        if (this.strokeDelay >= 0) {
          if (this.strokeDelay <= slice) {
            const excess = slice - this.strokeDelay;
            remaining += excess;
            this.motion.rewind(excess);
            slice = this.strokeDelay;
            if (!this.commands.stroke(person.playerIndex, person.getStrokeVars())) throw new Error("Reserved shot rejected at contact");
            person.camera.shotView.struck = true;
            this.strokeDelay = -1;
          } else this.strokeDelay -= slice;
        }
        this.commands.step(slice);
        this.motion.updateLength(person.simulator.getCueBallPosition(), person.radius);
        person.stick.leadingSpace = this.motion.length;
        updatePeople(slice);
        if (remaining < 1e-6) return;
      }
      if (this.motion.needsUpdate) return;
    }
    this.commands.step(remaining);
    if (person && this.standDelay >= 0 && (this.standDelay -= remaining) < 0) person.gotoState0();
    updatePeople(remaining);
  }

  finish(): void {
    this.actor?.camera.endShotView();
    this.actor?.camera.unfollow();
    this.actor = null;
    this.motion.reset();
    this.strokeDelay = this.standDelay = -1;
  }
}
