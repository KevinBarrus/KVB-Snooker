import type { EventBus } from "../core/event-bus.js";
import type { Simulator } from "../core/simulator/simulator.js";
import type { PredictionContext } from "../core/simulator/shot-result.js";
import { CameraRig } from "./camera-rig.js";
import { StickController } from "./stick-controller.js";

// PCOL L5680-5901
export class PersonController {
  readonly camera: CameraRig;
  readonly stick: StickController;
  active = true;
  prediction: PredictionContext | null = null;
  private power = 0.5;
  private predictionDirty = true;

  constructor(readonly simulator: Pick<Simulator, "getBallCount" | "getBallView" | "getCueBallPosition" | "getResult" | "predict">,
    bus: EventBus, readonly radius: number, readonly playerIndex = 0) {
    this.camera = new CameraRig(bus, simulator.getCueBallPosition());
    this.stick = new StickController(simulator, radius);
    this.activate();
  }

  get strokePower(): number { return this.power; }
  set strokePower(value: number) {
    value = Math.min(1, Math.max(0, value));
    if (value !== this.power) { this.power = value; this.predictionDirty = true; }
  }

  activate(): void {
    this.active = true;
    const cue = this.simulator.getCueBallPosition();
    this.camera.resetCue(cue);
    this.stick.resetAimPoint(cue);
    this.stick.clearTip();
    this.stick.setAngleV(0);
    this.stick.leadingSpace = -0.015;
    this.strokePower = 0.5;
    this.predictionDirty = true;
    this.prediction = null;
    this.update(0);
  }

  gotoState0(instant = false): void { this.camera.setState(0, instant); }
  gotoState1(instant = false): void { if (this.active) this.camera.setState(1, instant); }
  isReadyToStroke(): boolean { return this.active && this.camera.state === 1 && this.stick.isReadyToStroke(); }
  getStrokeVars(): Float32Array { return this.stick.getStrokeVars(this.strokePower); }

  update(dt: number): void {
    this.camera.update(dt);
    this.stick.syncPerson(this.camera.bodyPosition, this.camera.azimuth, this.camera.stateRatio);
    this.stick.update();
    this.camera.shotView.track(this.simulator);
    this.camera.updateHead(this.stick.angleH1, this.stick.rotationZ1, dt);
    if (this.stick.consumePredictionChanged()) this.predictionDirty = true;
  }

  updatePrediction(): boolean {
    if (!this.active || this.camera.state !== 1 || !this.predictionDirty) return false;
    this.predictionDirty = false;
    this.prediction = this.simulator.predict(this.getStrokeVars(), 1.6);
    return true;
  }
}
