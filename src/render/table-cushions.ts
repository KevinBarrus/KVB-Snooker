import * as B from "babylonjs/es6.js";
import { Shape, type P3 } from "./table-mesh.js";
import { BED_Y, RAIL_INNER_X, RAIL_INNER_Z, RAIL_TOP } from "./table-shape.js";

export interface CushionPoint { readonly x: number; readonly z: number; readonly pocket: boolean }
export type CushionOutline = readonly CushionPoint[];

export function buildCushions(outline: CushionOutline): Shape {
  if (outline.length < 3 || outline.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    throw new Error("Invalid cinema cushion outline");
  }
  const shape = new Shape();
  const normal = (a: CushionPoint, b: CushionPoint): [number, number] => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) throw new Error("Degenerate cinema cushion edge");
    return [-(b.z - a.z) / length, (b.x - a.x) / length];
  };
  for (let index = 0; index < outline.length; ++index) {
    const a = outline[index];
    if (a.pocket) continue;
    const b = outline[(index + 1) % outline.length];
    const before = outline[(index + outline.length - 1) % outline.length];
    const after = outline[(index + 2) % outline.length];
    const n = normal(a, b);
    const joint = (other: [number, number]): [number, number] => {
      const divisor = Math.max(0.5, 1 + n[0] * other[0] + n[1] * other[1]);
      return [(n[0] + other[0]) / divisor, (n[1] + other[1]) / divisor];
    };
    const normals = [before.pocket ? n : joint(normal(before, a)), b.pocket ? n : joint(normal(b, after))];
    const rows = [a, b].map((point, end) => {
      const depth = Math.max(0.009, Math.min(0.055,
        Math.min(RAIL_INNER_X - Math.abs(point.x), RAIL_INNER_Z - Math.abs(point.z))));
      const profile = [[0.008, BED_Y + 0.002], [0, BED_Y + 0.02625],
        [0.003, RAIL_TOP - 0.006], [Math.min(0.012, depth), RAIL_TOP], [depth, RAIL_TOP]];
      return profile.map(([offset, y]): P3 =>
        [point.x - normals[end][0] * offset, y, point.z - normals[end][1] * offset]);
    });
    shape.grid(rows, { sx: 1, sz: 1 }, [n[0], 1, n[1]]);
    if (before.pocket) shape.grid([rows[0], rows[0].map(([x, , z]): P3 => [x, BED_Y, z])],
      { sx: 1, sz: 1 }, [a.x - b.x, 0, a.z - b.z]);
    if (b.pocket) shape.grid([rows[1], rows[1].map(([x, , z]): P3 => [x, BED_Y, z])],
      { sx: 1, sz: 1 }, [b.x - a.x, 0, b.z - a.z]);
  }
  return shape;
}

export function retainClothBed(mesh: B.Mesh): void {
  const positions = mesh.getVerticesData(B.VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) throw new Error("Missing cloth geometry");
  const kept: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const face = [indices[index], indices[index + 1], indices[index + 2]];
    if (face.every(vertex => positions[vertex * 3 + 1] + mesh.position.y <= BED_Y + 0.001)) kept.push(...face);
  }
  mesh.setIndices(kept);
}

export function mapClothUV(mesh: B.Mesh): void {
  const positions = mesh.getVerticesData(B.VertexBuffer.PositionKind);
  if (!positions) throw new Error("Missing cloth positions");
  const uv: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    uv.push((positions[i] + RAIL_INNER_X) / (2 * RAIL_INNER_X),
      (positions[i + 2] + RAIL_INNER_Z) / (2 * RAIL_INNER_Z));
  }
  mesh.setVerticesData(B.VertexBuffer.UVKind, uv);
}
