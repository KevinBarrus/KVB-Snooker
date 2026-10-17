import { MeshBody, type CollisionMeshData } from "../../src/core/physics/mesh-body.js";

export function makePocketTable(): MeshBody {
  const data: CollisionMeshData = {
    ground: {
      p: [-1.8, 0.88, -0.9, 1.8, 0.88, -0.9, 1.8, 0.88, 0.9, -1.8, 0.88, 0.9],
      q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["ground"] }]
    },
    side: { p: [], q: [] },
    tunnel: {
      p: [-5, 0.55, -5, 5, 0.55, -5, 5, 0.55, 5, -5, 0.55, 5],
      q: [{ i: [0, 1, 2, 3], n: [0, 1, 0], f: ["tunnel", "end"] }]
    }
  };
  function side(ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void {
    const start = data.side.p.length / 3;
    data.side.p.push(ax, 0.88, az, bx, 0.88, bz, bx, 1, bz, ax, 1, az);
    data.side.q.push({ i: [start, start + 1, start + 2, start + 3], n: [nx, 0, nz], f: ["sidehard"] });
  }
  side(-1.8, -0.8, -1.8, 0.8, 1, 0);
  side(1.8, 0.8, 1.8, -0.8, -1, 0);
  side(-1.7, 0.9, -0.05, 0.9, 0, -1);
  side(0.05, 0.9, 1.7, 0.9, 0, -1);
  side(-0.05, -0.9, -1.7, -0.9, 0, 1);
  side(1.7, -0.9, 0.05, -0.9, 0, 1);
  const mesh = new MeshBody(data);
  mesh.id = "six-pocket-test-table";
  return mesh;
}
