import type { EventBus } from "../core/event-bus.js";
import type { PersonController } from "./person-controller.js";
import type { ShotController } from "./shot-controller.js";

export interface RouteView { dx: number; dz: number; fbSpin: number; powerFactor: number }
export interface AIDecisions {
  restart(): boolean;
  next(): RouteView | null;
  random(): number;
}

// PCOL L7594-7627
export class AIRunner {
  private thinkingDelay = -1;
  private shootingDelay = -1;
  private thinking = false;

  constructor(private readonly person: PersonController, private readonly shots: ShotController,
    private readonly bus: EventBus, private readonly decisions: AIDecisions) {}

  activate(): void {
    this.person.activate();
    if (this.decisions.restart()) {
      this.person.gotoState0(true);
      this.thinkingDelay = 1 + this.decisions.random();
      this.shootingDelay = -1;
      this.thinking = true;
    }
  }

  update(dt: number): void {
    if (!this.person.active || this.shots.busy) return;
    if (this.thinkingDelay >= 0) this.thinkingDelay -= dt;
    else if (this.thinking) {
      const route = this.decisions.next();
      if (!route) return;
      this.thinking = false;
      this.person.camera.resetWithKissDir(route.dx, route.dz);
      this.person.strokePower = 0.3 + route.powerFactor;
      this.person.stick.setTipPercent(0, route.fbSpin);
      this.person.stick.setAngleV(route.fbSpin < 0 ? 0.025 * Math.PI : 0);
      this.person.gotoState1();
      this.shootingDelay = 1 + this.decisions.random();
    } else if (this.person.isReadyToStroke() && this.shootingDelay >= 0 && (this.shootingDelay -= dt) < 0) {
      this.shootingDelay = -1;
      this.bus.emit("ai/shot", undefined);
      this.shots.launch(this.person);
    }
  }
}
