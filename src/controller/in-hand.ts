import type { CameraRig } from "./camera-rig.js";
import type { Point3 } from "./stick-obstacles.js";

export interface PlacementCommands {
  ray(x: number, y: number): { origin: Point3; direction: Point3 };
  valid(point: Point3): boolean;
  place(point: Point3): boolean;
  begin?(): boolean;
  focus?(): Point3 | null;
  /** P/ESC 结束摆球模式；返回 false 表示当前位置不能接受，保持打开。 */
  end?(): boolean;
}

// PCOL L4177-4345
export class InHand {
  active = false;
  visible = false;
  valid = false;
  readonly spot = { x: 0, y: 0.88, z: 0 };
  private mouseX = NaN;
  private mouseY = NaN;
  private dirty = false;
  private focusPending = false;

  constructor(private readonly camera: CameraRig, private readonly commands: PlacementCommands) {}

  enter(): void {
    if (this.commands.begin?.() === false) return;
    this.active = true; this.visible = this.valid = false;
    this.mouseX = this.mouseY = NaN; this.dirty = false;
    this.focusPending = true;
    this.camera.setState(0);
  }

  /** 强制结束摆球模式，不改变母球位置或手中球资格。 */
  exit(): void {
    this.active = this.visible = this.valid = false;
    this.dirty = false; this.focusPending = false;
  }

  move(x: number, y: number): void { this.mouseX = x; this.mouseY = y; this.dirty = true; }

  click(x: number, y: number): boolean {
    if (!this.active) return false;
    this.mouseX = x; this.mouseY = y; this.dirty = false;
    if (!this.pick() || !this.valid) return false;
    const done = this.commands.place(this.spot);
    if (done) this.exit();
    return done;
  }

  update(): void {
    if (!this.active || this.camera.stateRatio !== 0) return;
    if (this.focusPending) { this.focusPending = false; this.focus(); }
    if (!this.dirty) return;
    this.dirty = false;
    this.pick();
  }

  private focus(): void {
    const point = this.commands.focus?.();
    if (!point) return;
    const body = this.camera.bodyPosition;
    const dx = point.x - body.x, dy = point.y - body.y, dz = point.z - body.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-6) return;
    const forward = this.camera.azimuth.forward;
    if ((dx * forward.x + dz * forward.z) / length < 0.84) this.camera.lookTo(point.x, point.z);
  }

  private pick(): boolean {
    if (!Number.isFinite(this.mouseX) || !Number.isFinite(this.mouseY)) {
      this.visible = this.valid = false;
      return false;
    }
    const { origin, direction } = this.commands.ray(this.mouseX, this.mouseY);
    if (!Number.isFinite(direction.y) || Math.abs(direction.y) < 1e-9) {
      this.visible = this.valid = false;
      return false;
    }
    const distance = (this.spot.y - origin.y) / direction.y;
    if (!Number.isFinite(distance) || distance < 0) {
      this.visible = this.valid = false;
      return false;
    }
    this.spot.x = origin.x + distance * direction.x;
    this.spot.z = origin.z + distance * direction.z;
    this.visible = true;
    this.valid = this.commands.valid(this.spot);
    return true;
  }
}
