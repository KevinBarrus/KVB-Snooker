import * as B from "babylonjs/es6.js";
import { Input } from "./controller/input.js";
import { ShotReplay } from "./controller/shot-replay.js";
import { ShotView, type ShotViewMode } from "./controller/shot-view.js";
import type { ReplayCapture } from "./controller/replay-frame.js";
import { ReplayControls, ReplayControlsDom } from "./ui/replay-controls.js";

export class BrowserReplay {
  readonly clip = new ShotReplay();
  readonly view = new ShotView();
  readonly state = new ReplayControls();
  readonly dom: ReplayControlsDom;
  private readonly input: Input;
  private readonly target = B.Vector3.Zero();
  private readonly savedEye = B.Vector3.Zero();
  private readonly savedTarget = B.Vector3.Zero();

  constructor(private readonly camera: B.TargetCamera, private readonly canvas: HTMLCanvasElement,
    private readonly capture: () => ReplayCapture, private readonly canOpen: () => boolean,
    private readonly onActive: (active: boolean) => void, cycleView: () => void) {
    this.dom = new ReplayControlsDom({
      open: () => this.open(), close: () => this.close(),
      toggle: () => { this.clip.toggle(); this.sync(); this.canvas.focus(); },
      slow: () => { this.clip.rate = this.clip.rate === 1 ? .25 : 1; this.sync(); this.canvas.focus(); },
      restart: () => { this.restart(); this.canvas.focus(); },
      seek: progress => { this.clip.seek(progress); this.view.end(); this.update(0); },
      cycleView
    });
    this.input = new Input(canvas, {
      "32": { states: 4, down: () => { this.clip.toggle(); this.sync(); } },
      "27": { states: 4, down: () => this.close() },
      "86": { states: 4, down: cycleView }
    }, { drag: { states: 4, run: (x, y) => this.moveLookAt(x, y) } });
    this.input.state = 4; this.input.enabled = false;
    document.body.append(this.dom.element);
  }

  get active(): boolean { return this.clip.active; }

  begin(): void { this.clip.begin(this.capture()); this.sync(); }
  record(dt: number): void { if (this.clip.isRecording) this.clip.record(dt, this.capture()); }
  finish(): void { if (this.clip.isRecording) this.clip.finish(this.capture()); this.sync(); }
  clear(): void { if (this.active) this.close(); this.clip.clear(); this.sync(); }

  open(): boolean {
    if (!this.canOpen() || !this.clip.open()) return false;
    this.savedEye.copyFrom(this.camera.position);
    const current = this.camera.getTarget();
    this.savedTarget.copyFrom(current);
    this.view.end();
    this.onActive(true); this.input.enabled = true;
    this.update(0); this.canvas.focus();
    return true;
  }

  close(): void {
    if (!this.active) return;
    this.clip.close(); this.view.end(); this.input.enabled = false;
    this.camera.position.copyFrom(this.savedEye);
    this.camera.lockedTarget = this.savedTarget;
    this.onActive(false); this.sync(); this.canvas.focus();
  }

  restart(): void { this.clip.restart(); this.view.end(); this.update(0); }

  setMode(mode: ShotViewMode): void {
    if (!this.view.active) this.view.begin(this.target);
    this.view.setMode(mode, this.target);
  }

  private moveLookAt(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    if (!this.view.active) this.view.begin(this.target);
    this.view.takeManual();
    const eye = this.camera.position;
    const x = this.target.x - eye.x, y = this.target.y - eye.y, z = this.target.z - eye.z;
    const distance = Math.max(.1, Math.hypot(x, y, z));
    const yaw = Math.atan2(z, x) + .0025 * dx;
    const pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(y, Math.hypot(x, z)) - .0025 * dy));
    this.view.target.copyFromFloats(eye.x + Math.cos(yaw) * Math.cos(pitch) * distance,
      eye.y + Math.sin(pitch) * distance, eye.z + Math.sin(yaw) * Math.cos(pitch) * distance);
    this.target.copyFrom(this.view.target);
  }

  update(dt: number): void {
    if (!this.active) { this.sync(); return; }
    this.clip.update(dt);
    const frame = this.clip.current;
    if (!frame) return;
    this.camera.position.copyFromFloats(frame.eye.x, frame.eye.y, frame.eye.z);
    if (this.view.active) {
      this.view.struck = frame.struck;
      this.view.smoothing.aspect = this.camera.getScene().getEngine().getAspectRatio(this.camera);
      this.view.smoothing.verticalFov = this.camera.fov;
      this.view.track(this.clip);
      this.view.update(dt, frame.aimRatio, frame.eye);
      this.target.copyFrom(this.view.target);
    } else this.target.copyFromFloats(frame.target.x, frame.target.y, frame.target.z);
    this.camera.lockedTarget = this.target;
    this.sync();
  }

  sync(): void {
    this.state.available = this.clip.available && this.canOpen();
    this.state.active = this.active; this.state.paused = this.clip.paused;
    this.state.slow = this.clip.rate === .25;
    this.state.progress = this.clip.duration > 0 ? this.clip.playHead / this.clip.duration : 0;
    this.dom.sync(this.state);
  }

  dispose(): void { this.clip.clear(); this.input.dispose(); this.dom.dispose(); }
}
