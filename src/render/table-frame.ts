import { TABLE_STYLE, type TableStyle } from "./table-style.js";
import { arc, extrude, QUADRANTS, Shape, type Mirror, type P2, type P3 } from "./table-mesh.js";
import { CORNER_CUT_X, CORNER_CUT_Z, MIDDLE_HALF, RAIL_BOTTOM, RAIL_INNER_X, RAIL_INNER_Z, RAIL_TOP, SKIRT_INSET,
  railWidth } from "./table-shape.js";

// =====================================================================
// 台框（代码生成，对标星牌比赛台）：木框台边 + 金色铭牌带 + 围板 + 金色线脚 + 腿墩 + 罗马柱腿。
// 只写第一象限（x、z 为正）的形状，四个象限镜像得到整张台。高度单位米，台呢面 0.880。
// 输出两组网格数据：wood（玫瑰木）与 gold（金漆）。
// =====================================================================
const WOOD_GRAIN = 4;
// 木框顶面外棱的圆角半径
const CAP_ROUND = 0.01;
// 金色铭牌带的上下沿（相对木框顶面的下降量）
const BAND_TOP = 0.034;
const BAND_BOTTOM = 0.068;
// 围板下沿与金色线脚下沿
const SKIRT_BOTTOM = 0.648;
export const FRAME_BOTTOM = 0.604;
// 腿墩：角墩与中墩边长、凸出围板的量、镶板金边宽度、圆棱间距与深度
const CORNER_BLOCK = 0.17;
const MIDDLE_BLOCK = 0.13;
const BLOCK_PROUD = 0.02;
const BLOCK_BORDER = 0.016;
const REED_PITCH = 0.015;
const REED_DEPTH = 0.004;
// 网兜从台体里垂出来的开口：角墩外角斜切的量、中袋处围板缺口的半宽、开口两侧挡板的进深
const CORNER_OPENING = 0.1;
const MIDDLE_OPENING = 0.085;
const OPENING_DEPTH = 0.09;
const INSIDE_SHADE = 0.25;
// 长边中间腿的位置（距台面中心）
const MIDDLE_LEG_X = 0.64;
const LEG_SEGMENTS = 64;
const LEG_FLUTES = 16;
const LEG_FLUTE_DEPTH = 0.07;

// 金色线脚截面：[凸出围板的量, 高度]
const MOULDING: P2[] = [[0, 0.652], [0.005, 0.65], [0.011, 0.644], [0.013, 0.641], [0.013, 0.636], [0.01, 0.633],
  [0.015, 0.63], [0.015, 0.624], [0.011, 0.621], [0.017, 0.618], [0.017, 0.61], [0.013, 0.606], [0, FRAME_BOTTOM]];

// 柱腿轮廓：[高度, 半径, 是否刻凹槽]，从腿墩底到地面
const LEG_PROFILE: [number, number, boolean][] = [
  [0.604, 0.066, false], [0.594, 0.066, false], [0.59, 0.056, false], [0.58, 0.062, false], [0.566, 0.076, false], [0.55, 0.08, false],
  [0.534, 0.076, false], [0.522, 0.062, false], [0.516, 0.054, false], [0.508, 0.054, false], [0.502, 0.064, false],
  [0.494, 0.073, true], [0.47, 0.079, true], [0.43, 0.079, true], [0.36, 0.071, true], [0.28, 0.06, true],
  [0.2, 0.052, true], [0.168, 0.05, true], [0.16, 0.056, false], [0.146, 0.07, false], [0.124, 0.078, false],
  [0.1, 0.072, false], [0.084, 0.058, false], [0.074, 0.05, false], [0.056, 0.05, false], [0.046, 0.06, false],
  [0.02, 0.062, false], [0, 0.058, false]
];

interface Frame { wood: Shape; gold: Shape; width: number }

function rail(frame: Frame, mirror: Mirror, from: P2, to: P2, outward: P2): void {
  const width = frame.width;
  const top = RAIL_TOP;
  const edge = arc([width - CAP_ROUND, top - CAP_ROUND], CAP_ROUND, Math.PI / 2, 0, 5);
  const side: P3 = [outward[0], 0, outward[1]];
  const sweep = (shape: Shape, profile: P2[], out: P3, light = 1): void =>
    shape.grid(extrude(profile, from, to, outward), mirror, out, { scale: WOOD_GRAIN, shade: () => light });
  sweep(frame.wood, [[0, top], ...edge, [width, top - 0.024]], [outward[0], 1, outward[1]]);
  sweep(frame.wood, [[width, top - 0.024], [width + 0.003, top - 0.026], [width + 0.003, top - 0.031], [width, top - BAND_TOP]], side);
  sweep(frame.gold, [[width - 0.001, top - BAND_TOP], [width - 0.001, top - BAND_BOTTOM]], side);
  sweep(frame.wood, [[width - 0.001, top - BAND_BOTTOM], [width + 0.004, top - 0.07], [width + 0.004, top - 0.077], [width, RAIL_BOTTOM]], side);
  sweep(frame.wood, [[width, RAIL_BOTTOM], [width - SKIRT_INSET, RAIL_BOTTOM]], [0, -1, 0], INSIDE_SHADE);
}

function skirt(frame: Frame, mirror: Mirror, from: P2, to: P2, outward: P2): void {
  const heights = [RAIL_BOTTOM, RAIL_BOTTOM - 0.05, SKIRT_BOTTOM];
  const lights = [0.3, 0.85, 1];
  const side: P3 = [outward[0], 0, outward[1]];
  frame.wood.grid(extrude(heights.map((y): P2 => [0, y]), from, to, outward), mirror, side,
    { scale: WOOD_GRAIN, shade: (_, column) => lights[column] });
  frame.gold.grid(extrude(MOULDING, from, to, outward), mirror, side);
}

// 竖直墙面 a→b；steps、lift 用来沿墙面方向做起伏（圆棱）。
function wall(a: P2, b: P2, bottom: number, top: number, steps = 1, lift: (t: number) => number = () => 0, normal: P2 = [0, 0]): P3[][] {
  return [bottom, top].map(y => Array.from({ length: steps + 1 }, (_, step): P3 => {
    const t = step / steps;
    const out = lift(t);
    return [a[0] + (b[0] - a[0]) * t + normal[0] * out, y, a[1] + (b[1] - a[1]) * t + normal[1] * out];
  }));
}

function plain(shape: Shape, mirror: Mirror, a: P2, b: P2, normal: P2, bottom = FRAME_BOTTOM, top = RAIL_BOTTOM, light = 1): void {
  shape.grid(wall(a, b, bottom, top), mirror, [normal[0], 0, normal[1]], { scale: WOOD_GRAIN, shade: () => light });
}

// 腿墩的一个立面：金色边框，内嵌竖向圆棱的玫瑰木镶板。
function reededFace(frame: Frame, mirror: Mirror, a: P2, b: P2, normal: P2): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (distance: number): P2 => [a[0] + (b[0] - a[0]) * distance / length, a[1] + (b[1] - a[1]) * distance / length];
  const left = at(BLOCK_BORDER);
  const right = at(length - BLOCK_BORDER);
  const low = FRAME_BOTTOM + 0.03;
  const high = RAIL_BOTTOM - BLOCK_BORDER;
  const reeds = Math.round((length - 2 * BLOCK_BORDER) / REED_PITCH);
  plain(frame.gold, mirror, a, left, normal);
  plain(frame.gold, mirror, right, b, normal);
  plain(frame.gold, mirror, left, right, normal, FRAME_BOTTOM, low);
  plain(frame.gold, mirror, left, right, normal, high);
  frame.wood.grid(wall(left, right, low, high, reeds * 6,
    t => REED_DEPTH * (Math.abs(Math.sin(Math.PI * reeds * t)) - 1), normal), mirror, [normal[0], 0, normal[1]], { scale: WOOD_GRAIN });
}

// 角墩外角斜切并敞开，网兜从这里垂出；开口两侧各有一块向内的暗色挡板，底部一条金色底座。
function cornerBlock(frame: Frame, mirror: Mirror, skirtX: number, skirtZ: number): void {
  const x = skirtX + BLOCK_PROUD;
  const z = skirtZ + BLOCK_PROUD;
  const left: P2 = [x - CORNER_OPENING, z];
  const right: P2 = [x, z - CORNER_OPENING];
  const inward = OPENING_DEPTH * Math.SQRT1_2;
  plain(frame.gold, mirror, [skirtX - CORNER_BLOCK, skirtZ], [skirtX - CORNER_BLOCK, z], [-1, 0]);
  reededFace(frame, mirror, [skirtX - CORNER_BLOCK, z], left, [0, 1]);
  plain(frame.wood, mirror, left, [left[0] - inward, left[1] - inward], [1, -1], FRAME_BOTTOM, RAIL_BOTTOM, INSIDE_SHADE);
  plain(frame.gold, mirror, left, right, [1, 1], FRAME_BOTTOM, SKIRT_BOTTOM);
  plain(frame.wood, mirror, right, [right[0] - inward, right[1] - inward], [-1, 1], FRAME_BOTTOM, RAIL_BOTTOM, INSIDE_SHADE);
  reededFace(frame, mirror, right, [x, skirtZ - CORNER_BLOCK], [1, 0]);
  plain(frame.gold, mirror, [x, skirtZ - CORNER_BLOCK], [skirtX, skirtZ - CORNER_BLOCK], [0, -1]);
  const inner: P3 = [skirtX - CORNER_BLOCK, FRAME_BOTTOM, skirtZ - CORNER_BLOCK];
  frame.gold.grid([[[skirtX - CORNER_BLOCK, FRAME_BOTTOM, z], [left[0], FRAME_BOTTOM, left[1]], [right[0], FRAME_BOTTOM, right[1]]],
    [inner, inner, [x, FRAME_BOTTOM, skirtZ - CORNER_BLOCK]]], mirror, [0, -1, 0]);
}

function middleBlock(frame: Frame, mirror: Mirror, skirtZ: number): void {
  const z = skirtZ + BLOCK_PROUD;
  const left = MIDDLE_LEG_X - MIDDLE_BLOCK / 2;
  const right = MIDDLE_LEG_X + MIDDLE_BLOCK / 2;
  plain(frame.gold, mirror, [left, skirtZ], [left, z], [-1, 0]);
  reededFace(frame, mirror, [left, z], [right, z], [0, 1]);
  plain(frame.gold, mirror, [right, z], [right, skirtZ], [1, 0]);
  frame.gold.grid([[[left, FRAME_BOTTOM, z], [right, FRAME_BOTTOM, z]],
    [[left, FRAME_BOTTOM, skirtZ - MIDDLE_BLOCK], [right, FRAME_BOTTOM, skirtZ - MIDDLE_BLOCK]]], mirror, [0, -1, 0]);
}

function leg(frame: Frame, mirror: Mirror, x: number, z: number): void {
  const rings = Array.from({ length: LEG_SEGMENTS + 1 }, (_, step) => {
    const angle = 2 * Math.PI * step / LEG_SEGMENTS;
    const groove = 1 - LEG_FLUTE_DEPTH * (1 - Math.abs(Math.cos(angle * LEG_FLUTES / 2)));
    return LEG_PROFILE.map(([y, radius, fluted]): P3 => {
      const r = radius * (fluted ? groove : 1);
      return [x + r * Math.cos(angle), y, z + r * Math.sin(angle)];
    });
  });
  frame.gold.grid(rings, mirror, [-1, 0, 0]);
}

export function buildFrame(style: TableStyle = TABLE_STYLE): Frame {
  const frame: Frame = { wood: new Shape(), gold: new Shape(), width: railWidth(style) };
  const width = frame.width;
  const skirtX = RAIL_INNER_X + width - SKIRT_INSET;
  const skirtZ = RAIL_INNER_Z + width - SKIRT_INSET;
  const cornerLeg = CORNER_BLOCK / 2;
  for (const mirror of QUADRANTS) {
    rail(frame, mirror, [MIDDLE_HALF, RAIL_INNER_Z], [CORNER_CUT_X, RAIL_INNER_Z], [0, 1]);
    rail(frame, mirror, [RAIL_INNER_X, 0], [RAIL_INNER_X, CORNER_CUT_Z], [1, 0]);
    skirt(frame, mirror, [MIDDLE_OPENING, skirtZ], [skirtX - CORNER_BLOCK, skirtZ], [0, 1]);
    skirt(frame, mirror, [skirtX, 0], [skirtX, skirtZ - CORNER_BLOCK], [1, 0]);
    plain(frame.wood, mirror, [MIDDLE_OPENING, skirtZ], [MIDDLE_OPENING, skirtZ - OPENING_DEPTH], [-1, 0], FRAME_BOTTOM, RAIL_BOTTOM, INSIDE_SHADE);
    frame.gold.grid(extrude(MOULDING, [0, skirtZ], [MIDDLE_OPENING, skirtZ], [0, 1]), mirror, [0, 0, 1]);
    cornerBlock(frame, mirror, skirtX, skirtZ);
    middleBlock(frame, mirror, skirtZ);
    leg(frame, mirror, skirtX - cornerLeg, skirtZ - cornerLeg);
    leg(frame, mirror, MIDDLE_LEG_X, skirtZ - MIDDLE_BLOCK / 2);
  }
  return frame;
}
