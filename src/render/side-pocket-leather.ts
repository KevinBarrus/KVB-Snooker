import { Shape, type Mirror, type P2, type P3 } from "./table-mesh.js";
import { MIDDLE_HALF, RAIL_INNER_Z, RAIL_TOP, railWidth } from "./table-shape.js";
import { TABLE_STYLE } from "./table-style.js";

const THICKNESS = 0.002;
const SHOULDER_DEPTH = 0.018;
const BACK_INSET = 0.006;
const DROP = 0.098;

function sidePocketOuter(t: number): P2 {
  const angle = Math.PI * t;
  return [-(MIDDLE_HALF + 0.003) * Math.cos(angle),
    RAIL_INNER_Z + SHOULDER_DEPTH + (railWidth() - SHOULDER_DEPTH - BACK_INSET) * Math.sin(angle)];
}

export function sidePocketWoodEnd(depth: number): number {
  const t = Math.max(0, (depth - SHOULDER_DEPTH) / (railWidth() - SHOULDER_DEPTH - BACK_INSET));
  return Math.min(MIDDLE_HALF, Math.max(0.052, (MIDDLE_HALF + 0.003) * Math.sqrt(Math.max(0, 1 - t * t)) - 0.001));
}

export function addSidePocketLeather(shape: Shape, inner: readonly P2[], mirror: Mirror): void {
  const last = inner.length - 1;
  const rows: P3[][] = [];
  const texture: number[] = [];
  const add = (v: number, point: (from: P2, to: P2, t: number) => P3): void => {
    rows.push(inner.map((from, i) => point(from, sidePocketOuter(i / last), i / last)));
    texture.push(v);
  };
  add(0.02, from => [from[0], RAIL_TOP - TABLE_STYLE.leatherWallDepth, from[1]]);
  const crown = (t: number): number => RAIL_TOP - 0.006 * Math.sin(Math.PI * t) ** 2;
  for (let step = 1; step <= 6; step++) {
    const s = step / 6;
    add(0.02 + 0.08 * s, (from, to, t) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const bow = 0.004 * Math.sin(Math.PI * s) / length;
      const bottom = RAIL_TOP - TABLE_STYLE.leatherWallDepth;
      return [from[0] + (to[0] - from[0]) * bow, bottom + (crown(t) - 0.003 - bottom) * s,
        from[1] + (to[1] - from[1]) * bow];
    });
  }
  for (let step = 0; step <= 12; step++) {
    const s = step / 12;
    add(0.2 + 0.15 * s, (from, to, t) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const lip = Math.min(0.003 / length, 0.2);
      const reach = lip + (1 - 2 * lip) * s;
      return [from[0] + (to[0] - from[0]) * reach,
        crown(t) + 0.002 * Math.sin(Math.PI * s), from[1] + (to[1] - from[1]) * reach];
    });
  }
  for (let step = 1; step <= 5; step++) {
    const angle = step / 5 * Math.PI / 2;
    add(0.6 + 0.1 * step / 5, (from, to, t) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const reach = 1 - 0.003 / length * (1 - Math.sin(angle));
      return [from[0] + (to[0] - from[0]) * reach,
        crown(t) - 0.006 * (1 - Math.cos(angle)), from[1] + (to[1] - from[1]) * reach];
    });
  }
  for (let step = 1; step <= 12; step++) {
    const s = step / 12;
    add(0.7 + 0.3 * s, (_, to, t) => {
      const belly = Math.sin(Math.PI * t);
      const drop = DROP * (0.45 + 0.55 * Math.pow(belly, 0.45));
      const taper = 1 - 0.12 * s * s;
      return [to[0] * taper, crown(t) - 0.006 - (drop - 0.006) * s,
        to[1] + 0.008 * Math.sin(Math.PI * s * 0.75) * belly];
    });
  }
  const back = rows.map((row, r) => row.map((point, c): P3 => {
    const left = row[Math.max(0, c - 1)];
    const right = row[Math.min(last, c + 1)];
    const before = rows[Math.max(0, r - 1)][c];
    const after = rows[Math.min(rows.length - 1, r + 1)][c];
    const a = after.map((v, i) => v - before[i]);
    const b = right.map((v, i) => v - left[i]);
    const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const length = Math.hypot(...normal) || 1;
    return [point[0] - THICKNESS * normal[0] / length,
      point[1] - THICKNESS * normal[1] / length, point[2] - THICKNESS * normal[2] / length];
  }));
  const options = { uv: (r: number, c: number): P2 => [c / last * 22, texture[r]],
    shade: (r: number): number => r === 0 ? TABLE_STYLE.leatherWallShade : 1 };
  shape.grid(rows, mirror, [0, 1, 0], options);
  shape.grid(back, mirror, [0, -1, 0], options);
  for (const c of [0, last]) {
    shape.grid([rows.map(row => row[c]), back.map(row => row[c])], mirror, [c === 0 ? -1 : 1, 0, 0]);
  }
  for (const r of [0, rows.length - 1]) shape.grid([rows[r], back[r]], mirror, [0, -1, 0]);
}
