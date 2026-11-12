import * as B from "babylonjs/es6.js";
import { CINEMA_STYLE } from "./cinema-style.js";

export class CinemaCamera {
  private yaw = 2.35;
  private pitch = 0.6;
  private distance = 6.2;
  private top = false;
  private active = false;
  private readonly target = new B.Vector3(0, 0.88, 0);
  private readonly savedEye = B.Vector3.Zero();
  private readonly savedTarget = B.Vector3.Zero();
  private readonly originalUp: B.Vector3;
  private readonly originalFov: number;
  private readonly originalMode: number;
  private readonly lamps: { mesh: B.AbstractMesh; visible: boolean }[];

  constructor(private readonly camera: B.TargetCamera) {
    this.originalUp = camera.upVector.clone();
    this.originalFov = camera.fov;
    this.originalMode = camera.mode;
    this.lamps = camera.getScene().meshes.filter(mesh => mesh.name === "cinema-structure-geometry" ||
      mesh.name === "cinema-light-panel").map(mesh => ({ mesh, visible: mesh.isVisible }));
  }

  begin(view: "top" | "display"): void {
    if (!this.active) this.capture();
    this.active = true;
    this.top = view === "top";
    this.yaw = 2.35;
    this.pitch = this.top ? Math.PI / 2 - 0.0001 : 0.6;
    const aspect = this.camera.getScene().getEngine().getAspectRatio(this.camera);
    this.distance = this.top ? Math.max(2.15, 1.15 / aspect) / Math.tan(CINEMA_STYLE.displayFov / 2)
      : Math.max(6.2, 4.8 / aspect);
  }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = Math.max(-0.11, Math.min(1.55, this.pitch + dy * 0.005));
    this.top = false;
  }

  zoom(delta: number): void {
    this.distance = Math.max(1, Math.min(12, this.distance * Math.exp(delta * 0.001)));
  }

  private capture(): void {
    this.savedEye.copyFrom(this.camera.position);
    const target: unknown = this.camera.lockedTarget;
    this.savedTarget.copyFrom(target instanceof B.Vector3 ? target : this.camera.getTarget());
  }

  apply(): void {
    if (!this.active) return;
    this.capture();
    this.camera.fov = CINEMA_STYLE.displayFov;
    this.camera.upVector.copyFromFloats(this.top ? -1 : 0, this.top ? 0 : 1, 0);
    this.camera.mode = this.top ? B.Camera.ORTHOGRAPHIC_CAMERA : B.Camera.PERSPECTIVE_CAMERA;
    const height = this.distance * Math.tan(CINEMA_STYLE.displayFov / 2);
    const aspect = this.camera.getScene().getEngine().getAspectRatio(this.camera);
    this.camera.orthoTop = height; this.camera.orthoBottom = -height;
    this.camera.orthoLeft = -height * aspect; this.camera.orthoRight = height * aspect;
    const horizontal = this.distance * Math.cos(this.pitch);
    this.camera.position.set(Math.cos(this.yaw) * horizontal,
      Math.max(0.15, this.target.y + Math.sin(this.pitch) * this.distance), Math.sin(this.yaw) * horizontal);
    if (this.top) this.camera.position.set(0, 3.1, 0.0001);
    this.camera.lockedTarget = this.target;
    for (const lamp of this.lamps) lamp.mesh.isVisible = lamp.visible && (this.top || this.pitch < 1.05);
  }

  release(restorePose = true): void {
    if (!this.active) return;
    this.active = false;
    this.camera.fov = this.originalFov;
    this.camera.mode = this.originalMode;
    this.camera.upVector.copyFrom(this.originalUp);
    for (const lamp of this.lamps) lamp.mesh.isVisible = lamp.visible;
    if (restorePose) {
      this.camera.position.copyFrom(this.savedEye);
      this.camera.lockedTarget = this.savedTarget;
    }
  }
}
