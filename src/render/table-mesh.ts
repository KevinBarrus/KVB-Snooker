import * as B from "babylonjs/es6.js";

export type P2 = readonly [number, number];
export type P3 = readonly [number, number, number];
export interface Mirror { readonly sx: number; readonly sz: number }

export const QUADRANTS: readonly Mirror[] = [{ sx: 1, sz: 1 }, { sx: -1, sz: 1 }, { sx: -1, sz: -1 }, { sx: 1, sz: -1 }];
export const HALVES: readonly Mirror[] = [{ sx: 1, sz: 1 }, { sx: 1, sz: -1 }];

function distance(a: P3, b: P3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface GridOptions {
  // 贴图密度：u 沿列方向累计长度、v 沿行方向累计长度（木纹顺着行方向走）
  readonly scale?: number;
  readonly shade?: (row: number, column: number) => number;
  readonly uv?: (row: number, column: number) => P2;
}

// 程序网格的顶点容器。所有面都由 grid() 铺成：rows[i][j] 为等长点列，相邻点共用顶点，法线自动平滑；
// 需要硬棱时分两次调用。out 为该面中部大致朝外的方向，用来统一正反面。
export class Shape {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  grid(source: readonly (readonly P3[])[], mirror: Mirror, out: P3, options: GridOptions = {}): void {
    const r = Math.floor((source.length - 1) / 2);
    const c = Math.floor((source[0].length - 1) / 2);
    const origin = source[r][c];
    const u = source[r + 1][c + 1].map((value, axis) => value - origin[axis]);
    const v = source[r][c + 1].map((value, axis) => value - origin[axis]);
    const facing = (u[1] * v[2] - u[2] * v[1]) * out[0] + (u[2] * v[0] - u[0] * v[2]) * out[1] + (u[0] * v[1] - u[1] * v[0]) * out[2];
    const reversed = facing > 0;
    const rows = reversed ? [...source].reverse() : source;
    const original = (row: number): number => reversed ? rows.length - 1 - row : row;
    const scale = options.scale ?? 1;
    const base = this.positions.length / 3;
    const columns = rows[0].length;
    const across = rows.map(row => {
      let walk = 0;
      return row.map((point, column) => column === 0 ? 0 : walk += distance(point, row[column - 1]));
    });
    const along = new Array<number>(columns).fill(0);
    rows.forEach((row, index) => {
      row.forEach((point, column) => {
        if (index > 0) along[column] += distance(point, rows[index - 1][column]);
        this.positions.push(mirror.sx * point[0], point[1], mirror.sz * point[2]);
        const mapped = options.uv ? options.uv(original(index), column) : [across[index][column] * scale, along[column] * scale];
        this.uvs.push(mapped[0], mapped[1]);
        const light = options.shade ? options.shade(original(index), column) : 1;
        this.colors.push(light, light, light, 1);
      });
    });
    const flip = mirror.sx * mirror.sz < 0;
    for (let row = 0; row + 1 < rows.length; ++row) {
      for (let column = 0; column + 1 < columns; ++column) {
        const a = base + row * columns + column;
        const b = a + columns;
        this.indices.push(...(flip ? [a, a + 1, b + 1, a, b + 1, b] : [a, b + 1, a + 1, a, b, b + 1]));
      }
    }
  }

  applyTo(mesh: B.Mesh): B.Mesh {
    const data = new B.VertexData();
    data.positions = this.positions;
    data.indices = this.indices;
    data.uvs = this.uvs;
    data.colors = this.colors;
    data.normals = [];
    B.VertexData.ComputeNormals(data.positions, data.indices, data.normals);
    data.applyToMesh(mesh);
    mesh.position.set(0, 0, 0);
    mesh.hasVertexAlpha = false;
    return mesh;
  }
}

export function arc(center: P2, radius: number, from: number, to: number, steps: number): P2[] {
  return Array.from({ length: steps + 1 }, (_, step): P2 => {
    const angle = from + (to - from) * step / steps;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}

// 把折线按长度均匀重采样成 count+1 个点，让两条轮廓可以逐点对应。
export function resample(path: readonly P2[], count: number): P2[] {
  const walk = [0];
  for (let i = 1; i < path.length; ++i) {
    walk.push(walk[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  const total = walk[walk.length - 1];
  let at = 1;
  return Array.from({ length: count + 1 }, (_, step): P2 => {
    const target = total * step / count;
    while (at < path.length - 1 && walk[at] < target) ++at;
    const t = (target - walk[at - 1]) / (walk[at] - walk[at - 1] || 1);
    return [path[at - 1][0] + (path[at][0] - path[at - 1][0]) * t, path[at - 1][1] + (path[at][1] - path[at - 1][1]) * t];
  });
}

// 截面 profile（[外伸量, 高度]）沿水平直线 from→to 拉伸，outward 为外伸方向。
export function extrude(profile: readonly P2[], from: P2, to: P2, outward: P2): P3[][] {
  return [from, to].map(point => profile.map((part): P3 =>
    [point[0] + outward[0] * part[0], part[1], point[1] + outward[1] * part[0]]));
}
