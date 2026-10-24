import * as B from "babylonjs/es6.js";
import type { PredictionContext } from "../core/simulator/shot-result.js";
import { createTableMaterial, createTablePlane, tintTablePlane, TABLE_COLORS } from "./table-overlay.js";
import { SightLine } from "./sight-line.js";

// PCOL L1529-1555, L1677-1730
export class Gunsight {
  private readonly material: B.ShaderMaterial;
  private readonly incoming: SightLine;
  private readonly outgoing: SightLine;
  private readonly targetLine: SightLine;
  private readonly cueMark: B.Mesh;
  private readonly targetMark: B.Mesh;
  private readonly visible = [false, false, false, false, false];
  private valid = true;
  private opacity = 0;

  constructor(scene: B.Scene, atlas: B.Texture, mask: B.Texture, private readonly radius: number) {
    this.material = createTableMaterial(scene, atlas, mask);
    this.incoming = new SightLine(scene, this.material, "gunsight-incoming", radius, radius, true);
    this.outgoing = new SightLine(scene, this.material, "gunsight-outgoing", radius, radius, false);
    this.targetLine = new SightLine(scene, this.material, "gunsight-target-line", .5 * radius, radius, false, true);
    this.cueMark = createTablePlane(scene, this.material, "gunsight-cue-mark", [286, 14, 208, 208], 2 * radius);
    this.targetMark = createTablePlane(scene, this.material, "gunsight-target-mark", [286, 14, 208, 208], 2 * radius);
    this.cueMark.position.y = this.targetMark.position.y = .8811;
    this.targetMark.alphaIndex = 10;
    this.refreshAlpha();
  }

  get alpha(): number { return this.opacity; }
  set alpha(value: number) {
    if (this.opacity !== value) { this.opacity = value; this.refreshAlpha(); }
  }

  private refreshAlpha(): void {
    const alphas = this.visible.map(visible => visible ? this.opacity : 0);
    this.incoming.setAlpha(alphas[0]);
    tintTablePlane(this.cueMark, TABLE_COLORS.white, alphas[1]);
    this.outgoing.setAlpha(alphas[2]);
    tintTablePlane(this.targetMark, this.valid ? TABLE_COLORS.white : TABLE_COLORS.red, alphas[3]);
    this.targetLine.setAlpha(alphas[4]);
  }

  syncPrediction(prediction: PredictionContext, ballOn: number, maxDistance = 1.6): void {
    const { p0, p1, cue, p2, target } = prediction;
    this.visible.fill(false);
    this.valid = true;
    if (!prediction.impactOccured) {
      const dx = cue.x - p0.x, dz = cue.z - p0.z;
      const distance = Math.hypot(dx, dz);
      if (distance > this.radius) {
        this.visible[0] = true;
        this.incoming.orient(dx, dz);
        this.incoming.sync(p0, distance - this.radius);
      }
      this.refreshAlpha();
      return;
    }
    const distance = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (distance > 2 * this.radius) {
      this.visible[0] = true;
      this.incoming.orient(p1.x - p0.x, p1.z - p0.z);
      this.incoming.sync(p0, distance - 2 * this.radius);
    } else this.incoming.orient(prediction.impactV1.x, prediction.impactV1.z);
    this.visible[1] = true;
    this.cueMark.position.x = p1.x; this.cueMark.position.z = p1.z;
    const dx = cue.x - p1.x, dz = cue.z - p1.z;
    const afterDistance = Math.min(.5 * (dx * dx + dz * dz) + .5 * prediction.cueVSq, maxDistance - distance);
    if (afterDistance > this.radius) {
      this.visible[2] = true;
      this.outgoing.orient(dx, dz);
      this.outgoing.sync(p1, afterDistance - this.radius);
    }
    if (prediction.hasImpactTarget) {
      this.visible[3] = true;
      this.targetMark.position.x = p2.x; this.targetMark.position.z = p2.z;
      this.valid = Boolean(2 ** prediction.targetNumber & ballOn);
      const targetDistance = Math.min(.5 * prediction.targetVSq, .4);
      if (targetDistance > this.radius) {
        this.visible[4] = true;
        this.targetLine.orient(target.x - p2.x, target.z - p2.z);
        const openness = 1 - B.Vector2.Dot(this.incoming.direction, this.targetLine.direction);
        this.targetLine.sync(p2, targetDistance - this.radius, openness);
      }
    }
    this.refreshAlpha();
  }

  dispose(): void {
    for (const mesh of [this.incoming.mesh, this.cueMark, this.outgoing.mesh, this.targetMark, this.targetLine.mesh]) mesh.dispose();
    this.material.dispose();
  }
}
