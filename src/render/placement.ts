import * as B from "babylonjs/es6.js";
import { createTableMaterial, createTablePlane, tintTablePlane, TABLE_COLORS } from "./table-overlay.js";

type Point = Readonly<{ x: number; z: number }>;

// PCOL L1854-1859, L1917-1918, L1938-1944, L4311-4328
export class PlacementMarkers {
  readonly origin: B.Mesh;
  readonly preview: B.Mesh;
  private readonly material: B.ShaderMaterial;
  private wasActive = false;
  private angle = 0;

  constructor(scene: B.Scene, atlas: B.Texture, mask: B.Texture) {
    this.material = createTableMaterial(scene, atlas, mask);
    this.origin = createTablePlane(scene, this.material, "respot-origin", [221, 244, 166, 166], .11);
    this.preview = createTablePlane(scene, this.material, "respot-preview", [383, 383, 120, 120], .08);
    this.origin.isVisible = this.preview.isVisible = false;
  }

  sync(cue: Point, state: { active: boolean; visible: boolean; valid: boolean; spot: Point }): void {
    if (state.active && !this.wasActive) {
      this.origin.position.x = cue.x; this.origin.position.z = cue.z;
    }
    this.wasActive = state.active;
    if (state.active) { this.angle += .06; this.origin.rotation.y = this.angle; }
    tintTablePlane(this.origin, TABLE_COLORS.white, state.active ? .75 : 0);
    this.preview.position.x = state.spot.x; this.preview.position.z = state.spot.z;
    tintTablePlane(this.preview, state.valid ? TABLE_COLORS.green : TABLE_COLORS.red,
      state.active && state.visible ? .8 : 0);
  }

  dispose(): void { this.origin.dispose(); this.preview.dispose(); this.material.dispose(); }
}
