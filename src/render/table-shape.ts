import * as B from "babylonjs/es6.js";
import { TABLE_STYLE } from "./table-style.js";

export interface JawShift { readonly corner: number; readonly middle: number }

const NOSE_X = 1.797;
const NOSE_Z = 0.8966;
// 台呢外沿（库边台呢与木框的分界线）
export const RAIL_INNER_X = 1.852;
export const RAIL_INNER_Z = 0.951;
export const BED_Y = 0.88;
export const RAIL_TOP = 0.9205;
// 木框在袋口处的截断位置（原模型顶面轮廓实测值）
export const CORNER_CUT_X = 1.7599;
export const CORNER_CUT_Z = 0.8596;
export const MIDDLE_HALF = 0.0789;
// 落袋球在物理上会贴到袋底壁，木面过窄会让球穿出皮口外侧
const RAIL_WIDTH_MIN = 0.085;

export function railWidth(): number {
  return Math.max(TABLE_STYLE.railWidth, RAIL_WIDTH_MIN);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function reshapePoint(x: number, z: number, shift: JawShift): [number, number] {
  let ax = Math.abs(x);
  let az = Math.abs(z);
  const cornerWeight = 1 - smoothstep(0.08, 0.16, Math.hypot(ax - NOSE_X, az - NOSE_Z));
  if (cornerWeight > 0) {
    const side = Math.min(1, Math.max(-1, ((az - NOSE_Z) - (ax - NOSE_X)) * Math.SQRT1_2 / 0.03));
    const move = Math.SQRT2 * shift.corner * cornerWeight;
    ax += move * Math.max(side, 0);
    az += move * Math.max(-side, 0);
  }
  const middleWeight = (1 - smoothstep(0.09, 0.17, ax)) * smoothstep(0.8, 0.88, az);
  if (middleWeight > 0) ax -= shift.middle * middleWeight * Math.min(1, ax / 0.03);
  return [Math.sign(x) * ax, Math.sign(z) * az];
}

export function reshapeMesh(mesh: B.Mesh, shift: JawShift): void {
  const positions = mesh.getVerticesData(B.VertexBuffer.PositionKind);
  if (!positions) throw new Error(`Missing positions on ${mesh.name}`);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, z] = reshapePoint(positions[i], positions[i + 2], shift);
    positions[i] = x;
    positions[i + 2] = z;
  }
  mesh.setVerticesData(B.VertexBuffer.PositionKind, positions);
  mesh.refreshBoundingInfo();
}

// 木框外立面底沿高度，以及台体围板相对木框外沿的内缩量
export const RAIL_BOTTOM = RAIL_TOP - 0.08;
export const SKIRT_INSET = 0.045;
