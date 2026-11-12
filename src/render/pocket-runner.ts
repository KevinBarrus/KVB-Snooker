import { TABLE_STYLE, type TableStyle } from "./table-style.js";
import { Shape, type Mirror, type P3 } from "./table-mesh.js";
import { POCKET_SITES } from "./pocket-leather.js";
import { RAIL_BOTTOM, RAIL_INNER_X, RAIL_INNER_Z, SKIRT_INSET, railWidth } from "./table-shape.js";

// =====================================================================
// 出球轨（代码生成）：每个袋口下方一组四根黑色胶杆，贴着长边围板斜向下伸出，末端一只金色球环和吊钩。
// 角袋的轨道朝中袋方向，中袋的轨道朝 +x 方向。
// =====================================================================
// 轨道中线离围板的距离、起止高度、长度
const TRACK_OFFSET = 0.052;
const TRACK_HIGH = 0.705;
const TRACK_LOW = 0.68;
const TRACK_LENGTH = 0.43;
const ROD_RADIUS = 0.0045;
// 四根杆相对轨道中线的位置：[抬高量, 横向偏移]
const RODS: readonly (readonly [number, number])[] = [[0, -0.016], [0, 0.016], [0.026, -0.03], [0.026, 0.03]];
const RING_RADIUS = 0.037;
const RING_THICKNESS = 0.004;
const SIDES = 8;

function tube(shape: Shape, mirror: Mirror, from: P3, to: P3, radius: number): void {
  const axis = to.map((value, index) => value - from[index]);
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  const d = axis.map(value => value / length);
  const flat = Math.hypot(d[0], d[2]);
  const u: P3 = flat > 1e-6 ? [-d[2] / flat, 0, d[0] / flat] : [1, 0, 0];
  const v: P3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const ring = (center: P3): P3[] => Array.from({ length: SIDES + 1 }, (_, side): P3 => {
    const angle = 2 * Math.PI * side / SIDES;
    return [0, 1, 2].map(i => center[i] + radius * (Math.cos(angle) * u[i] + Math.sin(angle) * v[i])) as [number, number, number];
  });
  shape.grid([ring(from), ring(to)], mirror, [-u[0], -u[1], -u[2]]);
}

// 竖立的圆环，环面垂直于 x 轴。
function ring(shape: Shape, mirror: Mirror, center: P3): void {
  const rows = Array.from({ length: 2 * SIDES + 1 }, (_, step) => {
    const turn = Math.PI * step / SIDES;
    return Array.from({ length: SIDES + 1 }, (_, side): P3 => {
      const angle = 2 * Math.PI * side / SIDES;
      const reach = RING_RADIUS + RING_THICKNESS * Math.cos(angle);
      return [center[0] + RING_THICKNESS * Math.sin(angle), center[1] + reach * Math.cos(turn), center[2] + reach * Math.sin(turn)];
    });
  });
  shape.grid(rows, mirror, [0, 1, 0]);
}

export function buildRunners(gold: Shape, style: TableStyle = TABLE_STYLE): Shape {
  const rods = new Shape();
  const skirtX = RAIL_INNER_X + railWidth(style) - SKIRT_INSET;
  const z = RAIL_INNER_Z + railWidth(style) - SKIRT_INSET + TRACK_OFFSET;
  for (const site of POCKET_SITES) {
    const start = site.middle ? 0.03 : skirtX - 0.07;
    const end = start + (site.middle ? TRACK_LENGTH : -TRACK_LENGTH);
    for (const [lift, offset] of RODS) {
      tube(rods, site.mirror, [start, TRACK_HIGH + lift, z + offset], [end, TRACK_LOW + lift, z + offset], ROD_RADIUS);
    }
    const center: P3 = [end, TRACK_LOW + 0.014, z];
    ring(gold, site.mirror, center);
    tube(gold, site.mirror, [end, center[1] + RING_RADIUS, z], [end, RAIL_BOTTOM, z - 0.02], 0.003);
  }
  return rods;
}
