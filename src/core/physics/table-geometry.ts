import type { CollisionMeshData, CollisionMeshGroupData } from "./mesh-body.js";

// 袋口松紧调校入口：单位米。口宽为两侧袋角直壁之间的喉宽，半径越大袋角越平缓（嘴越开）。
export const TABLE_GEOMETRY = {
  cornerPocketWidth: 0.089, // 角袋喉宽（比赛级 0.089，俱乐部级约 0.093，原作约 0.100）
  cornerJawRadius: 0.14, // 角袋袋角圆弧半径
  middlePocketWidth: 0.102, // 中袋喉宽（比赛级 0.102，俱乐部级约 0.108）
  middleJawRadius: 0.055 // 中袋袋角圆弧半径
};

// PCOL tiger-club-sno-rgb.json side 组
const NOSE_X = 1.797;
const NOSE_Z = 0.8966;
const BOTTOM = 0.88;
const TOP = 1;
const CORNER_WALL_END = 0.044;
const CORNER_BACK = 0.0844;
const CORNER_BACK_HALF = 0.0255;
const MIDDLE_WALL_END_Z = 0.9865;
const MIDDLE_BACK_HALF = 0.0225;
const MIDDLE_BACK_Z = 1.0047;
const CORNER_ARC_STEPS = 6;
const CORNER_HARD_STEPS = 2;
const MIDDLE_ARC_STEPS = 8;
const MIDDLE_HARD_STEPS = 4;

type Flag = "sidehard" | "sidesoft" | "pocket";
interface OutlinePoint { x: number; z: number; flag: Flag }

// 走向：右短库 +z → 右上角袋 → 上长库 -x → 上中袋 → 左上角袋；flag 属于该点到下一点的线段。
function cornerOutline(): OutlinePoint[] {
  const { cornerPocketWidth: width, cornerJawRadius: radius } = TABLE_GEOMETRY;
  const half = width / 2;
  const centerX = NOSE_X - radius * (Math.SQRT2 - 1) - width * Math.SQRT1_2;
  const longSide: OutlinePoint[] = [];
  for (let step = 0; step <= CORNER_ARC_STEPS; ++step) {
    const angle = step / CORNER_ARC_STEPS * Math.PI / 4;
    longSide.push({ x: centerX + radius * Math.sin(angle), z: NOSE_Z + radius * (1 - Math.cos(angle)),
      flag: step <= CORNER_HARD_STEPS ? "sidehard" : "sidesoft" });
  }
  const along = (axial: number, lateral: number): { x: number; z: number } => ({
    x: NOSE_X + (axial - lateral) * Math.SQRT1_2, z: NOSE_Z + (axial + lateral) * Math.SQRT1_2 });
  const tangentAxial = radius * (Math.SQRT2 - 1) - half;
  longSide.push({ ...along(Math.max(CORNER_WALL_END, tangentAxial + 0.005), half), flag: "sidesoft" });
  longSide.push({ ...along(CORNER_BACK, CORNER_BACK_HALF), flag: "pocket" });
  const shortSide = longSide.map((point, index): OutlinePoint => ({
    x: NOSE_X + (point.z - NOSE_Z), z: NOSE_Z + (point.x - NOSE_X),
    flag: index < CORNER_HARD_STEPS ? "sidehard" : index <= CORNER_ARC_STEPS ? "sidesoft" : "pocket" }));
  return [...shortSide, ...longSide.reverse()];
}

function middleOutline(): OutlinePoint[] {
  const { middlePocketWidth: width, middleJawRadius: radius } = TABLE_GEOMETRY;
  const half = width / 2;
  const rightSide: OutlinePoint[] = [];
  for (let step = 0; step <= MIDDLE_ARC_STEPS; ++step) {
    const angle = step / MIDDLE_ARC_STEPS * Math.PI / 2;
    rightSide.push({ x: half + radius * (1 - Math.sin(angle)), z: NOSE_Z + radius * (1 - Math.cos(angle)),
      flag: step < MIDDLE_HARD_STEPS ? "sidehard" : "sidesoft" });
  }
  rightSide.push({ x: half, z: Math.max(MIDDLE_WALL_END_Z, NOSE_Z + radius + 0.005), flag: "pocket" });
  rightSide.push({ x: MIDDLE_BACK_HALF, z: MIDDLE_BACK_Z, flag: "pocket" });
  const leftSide = rightSide.map((point, index): OutlinePoint => ({ x: -point.x, z: point.z,
    flag: index <= MIDDLE_HARD_STEPS ? "sidehard" : index <= MIDDLE_ARC_STEPS + 1 ? "sidesoft" : "pocket" }));
  return [...rightSide, ...leftSide.reverse()];
}

function tableOutline(): OutlinePoint[] {
  const corner = cornerOutline();
  const mirrored = corner.map((point, index): OutlinePoint => ({ x: -point.x, z: point.z,
    flag: index === 0 ? "sidehard" : corner[index - 1].flag })).reverse();
  const top = [...corner, ...middleOutline(), ...mirrored];
  return [...top, ...top.map((point): OutlinePoint => ({ x: -point.x, z: -point.z, flag: point.flag }))];
}

function round(value: number): number { return Math.round(value * 1e6) / 1e6; }

function sideGroup(): CollisionMeshGroupData {
  const outline = tableOutline();
  const group: CollisionMeshGroupData = { p: [], q: [] };
  for (const point of outline) group.p.push(round(point.x), BOTTOM, round(point.z), round(point.x), TOP, round(point.z));
  for (let index = 0; index < outline.length; ++index) {
    const next = (index + 1) % outline.length;
    const a = outline[index];
    const b = outline[next];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    group.q.push({
      i: [2 * index, 2 * index + 1, 2 * next + 1, 2 * next],
      n: [round(-dz / length), 0, round(dx / length)],
      f: [a.flag],
      s: [round((a.x + b.x) / 2), (BOTTOM + TOP) / 2, round((a.z + b.z) / 2), round(Math.hypot(length, TOP - BOTTOM) / 2)]
    });
  }
  return group;
}

export function applyTableGeometry(data: CollisionMeshData): CollisionMeshData {
  return { ...data, side: sideGroup() };
}

export interface JawShift { readonly corner: number; readonly middle: number }

// 原模型袋角视觉喉宽与当前喉宽之差的一半，供渲染层同步收放袋角
export function tableJawShift(): JawShift {
  return { corner: (0.0996 - TABLE_GEOMETRY.cornerPocketWidth) / 2, middle: (0.099 - TABLE_GEOMETRY.middlePocketWidth) / 2 };
}
