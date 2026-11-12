import * as B from "babylonjs/es6.js";
import { arc, HALVES, QUADRANTS, resample, Shape, type Mirror, type P2, type P3 } from "./table-mesh.js";
import { CORNER_CUT_X, CORNER_CUT_Z, MIDDLE_HALF, RAIL_INNER_X, RAIL_INNER_Z, RAIL_TOP, railWidth, reshapePoint,
  type JawShift } from "./table-shape.js";
import { TABLE_STYLE, type TableStyle } from "./table-style.js";

// =====================================================================
// 皮口（代码生成）：每个袋口一张皮件，从袋内到台外依次是
//   袋内皮壁 → 内卷边 → 微鼓的顶面 → 外卷边 → 挂在台外的垂帘。
// 角袋写第一象限、中袋写 +z 一侧，其余靠镜像。物理袋口在 core/physics/table-geometry.ts。
// =====================================================================
export interface PocketSite { readonly mirror: Mirror; readonly middle: boolean }
export const POCKET_SITES: readonly PocketSite[] = [
  ...QUADRANTS.map(mirror => ({ mirror, middle: false })), ...HALVES.map(mirror => ({ mirror, middle: true }))];

// 袋喉开口半径与圆心（原模型 Pocket 顶面轮廓实测值）
export const MOUTH_RADIUS = 0.057;
export const CORNER_SITE: P2 = [1.8235, 0.923];
export const MIDDLE_SITE: P2 = [0, 0.9665];
// 皮件内沿贴着台呢外沿的位置
const CORNER_EDGE_X = 1.853;
const CORNER_EDGE_Z = 0.9526;
const MIDDLE_EDGE_Z = 0.9529;
const SAMPLES = 72;
const ARC_STEPS = 24;
// 内、外卷边半径，垂帘贴在木框外立面之外的间隙，皮件压过木框截断处的搭接量
const LIP_ROUND = 0.006;
const EDGE_ROUND = 0.009;
const FLAP_GAP = 0.006;
const OVERLAP = 0.003;
// 缝线：针距、顶面缝线距外卷边的距离、贴图里两道线的位置与粗细（顶面一道、垂帘一道）
const STITCH_PITCH = 0.009;
const SEAM_INSET = 0.016;
const STITCH_ROWS: readonly (readonly [number, number])[] = [[0.5, 4], [0.79, 2]];

interface Contour { inner: P2[]; outer: P2[] }

// 口沿弧在本象限的起止角：区间内是靠袋尾、有皮壁的一侧，区间外朝台面敞开。
export function mouthSpan(middle: boolean): [number, number] {
  if (middle) {
    const offsetZ = MIDDLE_EDGE_Z - MIDDLE_SITE[1];
    const half = Math.sqrt(MOUTH_RADIUS ** 2 - offsetZ ** 2);
    return [Math.atan2(offsetZ, half) - 2 * Math.PI, Math.atan2(offsetZ, -half)];
  }
  const offsetX = CORNER_EDGE_X - CORNER_SITE[0];
  const offsetZ = CORNER_EDGE_Z - CORNER_SITE[1];
  return [Math.atan2(-Math.sqrt(MOUTH_RADIUS ** 2 - offsetX ** 2), offsetX),
    Math.atan2(offsetZ, -Math.sqrt(MOUTH_RADIUS ** 2 - offsetZ ** 2))];
}

function contour(middle: boolean, shift: JawShift, style: TableStyle): Contour {
  const width = railWidth(style);
  const [from, to] = mouthSpan(middle);
  let inner: P2[];
  let outer: P2[];
  if (middle) {
    const half = MIDDLE_HALF + OVERLAP;
    const outerZ = RAIL_INNER_Z + width;
    inner = [[-half, MIDDLE_EDGE_Z], ...arc(MIDDLE_SITE, MOUTH_RADIUS, to, from, 2 * ARC_STEPS), [half, MIDDLE_EDGE_Z]];
    outer = [[-half, outerZ], [half, outerZ]];
  } else {
    const radius = Math.min(style.leatherCornerRadius, width + 0.03);
    const outerX = RAIL_INNER_X + width;
    const outerZ = RAIL_INNER_Z + width;
    const cutX = CORNER_CUT_X - OVERLAP;
    const cutZ = CORNER_CUT_Z - OVERLAP;
    inner = [[cutX, CORNER_EDGE_Z], ...arc(CORNER_SITE, MOUTH_RADIUS, to, from, 2 * ARC_STEPS), [CORNER_EDGE_X, cutZ]];
    outer = [[cutX, outerZ], ...arc([outerX - radius, outerZ - radius], radius, Math.PI / 2, 0, ARC_STEPS), [outerX, cutZ]];
  }
  return { inner: resample(inner.map(point => reshapePoint(point[0], point[1], shift)), SAMPLES), outer: resample(outer, SAMPLES) };
}

interface Ring { reach: (length: number) => number; y: (along: number, length: number) => number; v: number; shade: number }

// 皮件截面：reach 为从内沿向外沿走的距离（length 是该处内外沿间距），y 为高度，v 为贴图纵向位置。
function section(style: TableStyle): Ring[] {
  const top = RAIL_TOP;
  const seam = (length: number): number => Math.min(SEAM_INSET, (length - LIP_ROUND - EDGE_ROUND) / 2);
  const dome = (reach: number, length: number): number =>
    top + style.leatherDome * Math.sin(Math.PI * (0.1 + 0.8 * (reach - LIP_ROUND) / (length - LIP_ROUND - EDGE_ROUND)));
  const flat = (reach: (length: number) => number, v: number): Ring =>
    ({ reach, y: (_, length) => dome(reach(length), length), v, shade: 1 });
  const rings: Ring[] = [
    { reach: () => 0, y: () => top - style.leatherWallDepth, v: 0.02, shade: style.leatherWallShade },
    { reach: () => 0, y: () => top - LIP_ROUND, v: 0.1, shade: 0.8 }
  ];
  for (const turn of [0.33, 0.66]) {
    const angle = turn * Math.PI / 2;
    rings.push({ reach: () => LIP_ROUND * (1 - Math.cos(angle)), y: () => top - LIP_ROUND * (1 - Math.sin(angle)),
      v: 0.1 + 0.1 * turn, shade: 0.8 + 0.2 * turn });
  }
  for (const part of [0, 0.5, 1]) {
    rings.push(flat(length => LIP_ROUND + (length - LIP_ROUND - EDGE_ROUND - 2 * seam(length)) * part, 0.2 + 0.2 * part));
  }
  for (const part of [0.5, 1]) {
    rings.push(flat(length => length - EDGE_ROUND - 2 * seam(length) * (1 - part), 0.4 + 0.2 * part));
  }
  for (const turn of [0.33, 0.66, 1]) {
    const angle = turn * Math.PI / 2;
    rings.push({ reach: length => length - EDGE_ROUND + (EDGE_ROUND + FLAP_GAP) * Math.sin(angle),
      y: () => top - EDGE_ROUND * (1 - Math.cos(angle)), v: 0.6 + 0.1 * turn, shade: 1 });
  }
  for (const part of [0.3, 0.65, 1]) {
    rings.push({ reach: length => length + FLAP_GAP,
      y: along => top - EDGE_ROUND - (style.leatherFlapDrop * (0.86 + 0.14 * Math.sin(Math.PI * along)) - EDGE_ROUND) * part,
      v: 0.7 + 0.3 * part, shade: 1 - 0.12 * part });
  }
  return rings;
}

export function buildLeather(shift: JawShift, style: TableStyle = TABLE_STYLE): Shape {
  const shape = new Shape();
  const rings = section(style);
  for (const site of POCKET_SITES) {
    const { inner, outer } = contour(site.middle, shift, style);
    let walk = 0;
    const lengths = inner.map((point, index) => {
      if (index > 0) {
        walk += Math.hypot((point[0] + outer[index][0] - inner[index - 1][0] - outer[index - 1][0]) / 2,
          (point[1] + outer[index][1] - inner[index - 1][1] - outer[index - 1][1]) / 2);
      }
      return walk;
    });
    const rows = rings.map(ring => inner.map((from, index): P3 => {
      const to = outer[index];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const t = ring.reach(length) / length;
      return [from[0] + (to[0] - from[0]) * t, ring.y(index / SAMPLES, length), from[1] + (to[1] - from[1]) * t];
    }));
    // 中袋顶面皮带很窄，不走缝线：把顶面的贴图位置压到缝线之前
    const v = (row: number): number => site.middle && rings[row].v > 0.2 && rings[row].v < 0.7 ? 0.2 + (rings[row].v - 0.2) / 3 : rings[row].v;
    shape.grid(rows, site.mirror, [0, 1, 0],
      { shade: row => rings[row].shade, uv: (row, column) => [lengths[column] / STITCH_PITCH, v(row)] });
  }
  return shape;
}

// 皮面贴图：浅色皮纹噪点 + 两道白色缝线；颜色由材质的 leatherColor 相乘得到。
export function leatherTexture(scene: B.Scene): B.Texture {
  const width = 32;
  const height = 256;
  const data = new Uint8Array(width * height * 4);
  let seed = 7;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      let value = 200 + (seed >> 16) % 14;
      for (const [v, thickness] of STITCH_ROWS) {
        const offset = Math.abs(y - v * height);
        const inside = x >= 4 && x < 24;
        if (offset <= thickness / 2 && inside) value = 255;
        else if (offset <= thickness / 2 + 1 && x >= 3 && x < 25) value = 150;
      }
      data.set([value, value, value, 255], 4 * (y * width + x));
    }
  }
  const texture = B.RawTexture.CreateRGBATexture(data, width, height, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = B.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  return texture;
}
