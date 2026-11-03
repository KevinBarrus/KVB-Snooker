import type { CameraRig } from "./camera-rig.js";
import type { Point3 } from "./stick-obstacles.js";

export interface PlacementCommands {
  ray(x: number, y: number): { origin: Point3; direction: Point3 };
  valid(point: Point3): boolean;
  place(point: Point3): boolean;
  confirmCurrent?(): boolean;
  begin?(): boolean;
  origin?(): Point3 | null;
  constrain?(from: Point3, to: Point3): Point3;
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
  private looked = false;
  private constrained = false;

  constructor(private readonly camera: CameraRig, private readonly commands: PlacementCommands) {}

  enter(): void {
    if (this.commands.begin?.() === false) return;
    this.active = true; this.visible = this.valid = false;
    this.mouseX = this.mouseY = NaN; this.dirty = this.looked = false;
    const origin = this.commands.origin?.();
    this.constrained = !!origin;
    if (origin) {
      Object.assign(this.spot, origin);
      this.visible = this.valid = this.commands.valid(this.spot);
    }
    this.camera.setState(0);
  }
  exit(): void { this.active = this.visible = this.valid = false; }
  confirm(): boolean {
    if (!this.active) return false;
    const done = this.constrained && this.valid ? this.commands.place(this.spot) : this.commands.confirmCurrent?.() ?? false;
    if (done) this.exit();
    return done;
  }
  move(x: number, y: number): void { this.mouseX = x; this.mouseY = y; this.dirty = true; }
  press(x: number, y: number): boolean {
    if (x !== this.mouseX || y !== this.mouseY) { this.move(x, y); return false; }
    const done = this.active && this.valid && !this.dirty && this.commands.place(this.spot);
    if (done && this.constrained) this.exit();
    return done;
  }

  update(): void {
    if (!this.active || this.camera.stateRatio !== 0) return;
    if (!this.looked) {
      this.looked = true;
      const p = this.camera.bodyPosition;
      const focus = this.commands.origin?.() ?? { x: -1.185, y: .88, z: 0 };
      const dx = focus.x - p.x, dy = focus.y - p.y, dz = focus.z - p.z;
      const forward = this.camera.azimuth.forward;
      if ((dx * forward.x + dz * forward.z) / Math.hypot(dx, dy, dz) < 0.84) this.camera.lookTo(focus.x, focus.z);
    }
    if (!this.dirty) return;
    this.dirty = false;
    const { origin, direction } = this.commands.ray(this.mouseX, this.mouseY);
    const distance = (0.88 - origin.y) / direction.y;
    this.visible = Number.isFinite(distance) && distance >= 0;
    if (this.visible) {
      const next = { x: origin.x + distance * direction.x, y: this.spot.y, z: origin.z + distance * direction.z };
      Object.assign(this.spot, this.constrained ? this.commands.constrain?.(this.spot, next) ?? next : next);
    }
    this.valid = this.visible && this.commands.valid(this.spot);
  }
}
