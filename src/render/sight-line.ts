import * as B from "babylonjs/es6.js";

type Point = Readonly<{ x: number; z: number }>;

// PCOL L1515-1630, L1653-1676
export class SightLine {
  readonly mesh: B.Mesh;
  readonly direction = new B.Vector2(0, 0);
  private readonly positions: Float32Array;

  constructor(scene: B.Scene, material: B.Material, name: string, private readonly width: number,
    private readonly spacing: number, private readonly capped: boolean, yellow = false) {
    this.mesh = new B.Mesh(name, scene);
    this.mesh.material = material;
    this.mesh.position.y = .881;
    this.mesh.alphaIndex = -10;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    const rows = capped ? 4 : 3;
    this.positions = new Float32Array(rows * 6);
    const u0 = (yellow ? 12 : 148) / 512, u1 = u0 + 125 / 512;
    const v0 = (512 - 12 - 176) / 512, v1 = (512 - 12) / 512;
    const fractions = [0, 30 / 176, 1 - 30 / 176, 1];
    const uv: number[] = [], indices: number[] = [];
    for (let row = 0; row < rows; ++row) {
      const v = v0 + (v1 - v0) * fractions[row];
      uv.push(u0, v, u1, v);
      if (row < rows - 1) {
        const i = row * 2;
        indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
      }
    }
    this.mesh.setVerticesData("position", this.positions, true, 3);
    this.mesh.setVerticesData("uv", new Float32Array(uv), false, 2);
    this.mesh.setVerticesData("alpha", new Float32Array(rows * 2), true, 1);
    const color = yellow ? [237 / 255, 181 / 255, 30 / 255] : [1, 1, 1];
    this.mesh.setVerticesData("color", new Float32Array(Array.from({ length: rows * 2 }, () => color).flat()), false, 3);
    this.mesh.setIndices(indices);
    this.mesh.isVisible = false;
  }

  orient(dx: number, dz: number): void { this.direction.copyFromFloats(dx, dz).normalize(); }

  // PCOL L1573-1630, L1045-1091
  sync(origin: Point, distance: number, openness = 0): void {
    const head = Math.fround(this.spacing + 30 * this.width / 125) - Math.fround(this.spacing);
    const end = this.spacing + head + Math.max(distance - (this.capped ? 2 : 1) * head, 0);
    const rows = [this.spacing, this.spacing + head, end, end + head];
    const spread = Math.max(0, (distance - this.width) * openness * 2.8);
    const { x: dx, y: dz } = this.direction;
    for (let row = 0; row < this.positions.length / 6; ++row) {
      const z = Math.fround(rows[row]);
      const half = this.width / 2 + (row === 0 ? 0 : (z - Math.fround(this.spacing)) / distance * spread);
      for (let side = 0; side < 2; ++side) {
        const x = Math.fround(side === 0 ? -half : half);
        this.positions.set([x * dz + z * dx + origin.x, .0001, -x * dx + z * dz + origin.z], row * 6 + side * 3);
      }
    }
    this.mesh.updateVerticesData("position", this.positions);
  }

  setAlpha(alpha: number): void {
    const values = new Float32Array(this.mesh.getTotalVertices());
    values.fill(alpha, 0, 4);
    this.mesh.updateVerticesData("alpha", values);
    this.mesh.isVisible = alpha > 0;
  }
}
