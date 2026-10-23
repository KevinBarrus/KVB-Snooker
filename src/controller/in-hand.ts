import type { CameraRig } from "./camera-rig.js";
import type { Point3 } from "./stick-obstacles.js";

export interface PlacementCommands {
  ray(x: number, y: number): { origin: Point3; direction: Point3 };
  valid(point: Point3): boolean;
  place(point: Point3): boolean;
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

  constructor(private readonly camera: CameraRig, private readonly commands: PlacementCommands) {}

  enter(): void {
    this.active = true; this.visible = this.valid = false;
    this.mouseX = this.mouseY = NaN; this.dirty = this.looked = false;
    this.camera.setState(0);
  }
  exit(): void { this.active = this.visible = this.valid = false; }
  move(x: number, y: number): void { this.mouseX = x; this.mouseY = y; this.dirty = true; }
  press(x: number, y: number): boolean {
    if (Number.isNaN(this.mouseX) || Number.isNaN(this.mouseY)) { this.move(x, y); return false; }
    return this.active && this.valid && !this.dirty && this.commands.place(this.spot);
  }

  update(): void {
    if (!this.active || this.camera.stateRatio !== 0) return;
    if (!this.looked) {
      this.looked = true;
      const p = this.camera.bodyPosition;
      const dx = -1.185 - p.x, dy = 0.88 - p.y, dz = -p.z;
      const forward = this.camera.azimuth.forward;
      if ((dx * forward.x + dz * forward.z) / Math.hypot(dx, dy, dz) < 0.84) this.camera.lookTo(-1.185, 0);
    }
    if (!this.dirty) return;
    this.dirty = false;
    const { origin, direction } = this.commands.ray(this.mouseX, this.mouseY);
    const distance = (0.88 - origin.y) / direction.y;
    this.visible = Number.isFinite(distance) && distance >= 0;
    if (this.visible) {
      this.spot.x = origin.x + distance * direction.x;
      this.spot.z = origin.z + distance * direction.z;
    }
    this.valid = this.visible && this.commands.valid(this.spot);
  }
}
