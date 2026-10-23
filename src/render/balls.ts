import * as B from "babylonjs/es6.js";
import type { Simulator } from "../core/simulator/simulator.js";
import { BallMaterial, type BallLighting } from "./materials.js";
import { BallShadows } from "./shadows.js";

// PCOL L1886-1900, L2040-2077
export class BallRenderer {
  private readonly meshes: B.Mesh[] = [];
  private readonly materials = new Map<number, BallMaterial>();
  private readonly shadows: BallShadows;

  constructor(
    scene: B.Scene,
    private readonly simulator: Pick<Simulator, "getBallCount" | "getBallView">,
    radius: number,
    private readonly tableHeight: number,
    lighting: BallLighting,
    atlas: B.Texture,
    mask: B.Texture
  ) {
    if (!Number.isFinite(radius) || 2 * radius <= 1e-6) throw new Error(`Invalid ball radius: ${radius}`);
    this.shadows = new BallShadows(scene, simulator.getBallCount(), radius, atlas, mask);
    const templates = new Map<boolean, B.Mesh>();
    for (let index = 0; index < simulator.getBallCount(); ++index) {
      const { number } = simulator.getBallView(index);
      const high = number === 0;
      const template = templates.get(high);
      const mesh = template ? template.clone(`ball-${index}`, undefined, true) :
        B.MeshBuilder.CreateSphere(`ball-${index}`, { segments: high ? 32 : 20, diameter: 2 * radius }, scene);
      templates.set(high, mesh);
      let material = this.materials.get(number);
      if (!material) {
        material = new BallMaterial(scene, number, lighting);
        this.materials.set(number, material);
      }
      mesh.material = material;
      mesh.rotationQuaternion = B.Quaternion.Identity();
      this.meshes.push(mesh);
    }
    this.sync();
  }

  sync(): void {
    for (let index = 0; index < this.meshes.length; ++index) {
      const mesh = this.meshes[index];
      const ball = this.simulator.getBallView(index);
      mesh.isVisible = ball.active;
      if (ball.active) {
        mesh.position.copyFromFloats(ball.renderPosition.x, ball.renderPosition.y, ball.renderPosition.z);
        const q = ball.renderOrientation;
        mesh.rotationQuaternion!.copyFromFloats(q.x, q.y, q.z, q.w);
        if (ball.position.y >= this.tableHeight) {
          this.shadows.setBall(index, mesh.position.x, mesh.position.z, true);
          continue;
        }
      }
      this.shadows.hideBall(index);
    }
    this.shadows.flush();
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.shadows.dispose();
  }
}
