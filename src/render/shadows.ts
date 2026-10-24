import * as B from "babylonjs/es6.js";

import { createTableMaterial } from "./table-overlay.js";

// PCOL L959-964, L1096-1211, L2063-2069
export class BallShadows {
  readonly mesh: B.Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;

  constructor(scene: B.Scene, count: number, private readonly radius: number, atlas: B.Texture, mask: B.Texture) {
    const material = createTableMaterial(scene, atlas, mask);
    this.mesh = new B.Mesh("ball-shadows", scene);
    this.mesh.material = material;
    this.mesh.position.y = 0.881;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.positions = new Float32Array(count * 12);
    this.alphas = new Float32Array(count * 4);
    const uv: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; ++i) {
      uv.push(43 / 512, 43 / 512, 205 / 512, 43 / 512, 205 / 512, 205 / 512, 43 / 512, 205 / 512);
      const start = i * 4;
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    this.mesh.setVerticesData("position", this.positions, true, 3);
    this.mesh.setVerticesData("alpha", this.alphas, true, 1);
    this.mesh.setVerticesData("uv", uv, false, 2);
    this.mesh.setVerticesData("color", new Float32Array(count * 12), false, 3);
    this.mesh.setIndices(indices);
  }

  setBall(index: number, x: number, z: number, visible: boolean): void {
    const half = 1.3 * this.radius;
    this.positions.set([x - half, 0, z - half, x + half, 0, z - half,
      x + half, 0, z + half, x - half, 0, z + half], index * 12);
    this.alphas.fill(visible ? 0.8 : 0, index * 4, index * 4 + 4);
  }

  flush(): void {
    this.mesh.updateVerticesData("position", this.positions);
    this.mesh.updateVerticesData("alpha", this.alphas);
  }

  hideBall(index: number): void {
    this.alphas.fill(0, index * 4, index * 4 + 4);
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
  }
}
