import * as B from "babylonjs/es6.js";
import { CORNER_SITE, MIDDLE_SITE, MOUTH_RADIUS, mouthSpan, POCKET_SITES } from "./pocket-leather.js";
import { Shape, type P3 } from "./table-mesh.js";
import { RAIL_TOP, reshapePoint, type JawShift } from "./table-shape.js";
import { TABLE_STYLE } from "./table-style.js";

// =====================================================================
// 网兜（代码生成）：白色棉网袋，上口缝在袋内皮壁下沿，朝台面一侧挂在台呢垂边之下，
// 向下鼓出、收底。落袋球在网兜内下落，到网底附近消失（物理决定，见 netDepth）。
// =====================================================================
const NET_COLUMNS = 48;
// 网纹贴图：一张贴图里 TILE_CELLS × TILE_CELLS 个菱形网眼
const TILE_CELLS = 4;
const TILE_SIZE = 128;
// 朝台面一侧的网口高度（台呢垂边下沿）与半径倍数
const FRONT_TOP = 0.846;
const FRONT_RADIUS = 1.05;
// 网兜剖面：depth 为该圈在"皮壁下沿→网底"之间的位置，radius 为袋喉半径的倍数，
// drift 为圈心向台外偏移量（米），shade 为相对 netInnerShade 的亮度。
const NET_ROWS: readonly { depth: number; radius: number; drift: number; shade: number }[] = [
  { depth: 0, radius: 1, drift: 0, shade: 1 },
  { depth: 0.12, radius: 1.06, drift: 0.002, shade: 0.9 },
  { depth: 0.3, radius: 1.13, drift: 0.006, shade: 0.75 },
  { depth: 0.4, radius: 1.15, drift: 0.008, shade: 0.68 },
  { depth: 0.52, radius: 1.16, drift: 0.01, shade: 0.62 },
  { depth: 0.72, radius: 1.08, drift: 0.01, shade: 0.52 },
  { depth: 0.88, radius: 0.82, drift: 0.01, shade: 0.45 },
  { depth: 0.97, radius: 0.45, drift: 0.01, shade: 0.4 },
  { depth: 1, radius: 0, drift: 0.01, shade: 0.4 }
];

// 暗色内衬：罩在网兜朝台体的一侧和底部，挡住台体内部；垂帘以下朝台外的一侧敞开，从外面能看到白网。
const LINER_SCALE = 1.18;
const LINER_OPEN = 1.15;

interface Bags { net: Shape; liner: Shape }

export function buildNet(shift: JawShift): Bags {
  const style = TABLE_STYLE;
  const bags: Bags = { net: new Shape(), liner: new Shape() };
  const top = RAIL_TOP - style.leatherWallDepth;
  const bottom = RAIL_TOP - style.netDepth;
  const tile = TILE_CELLS * style.netCellSize;
  const covered = (style.leatherFlapDrop - style.leatherWallDepth) / (style.netDepth - style.leatherWallDepth);
  for (const site of POCKET_SITES) {
    const center = site.middle ? MIDDLE_SITE : CORNER_SITE;
    const facing = site.middle ? Math.PI / 2 : Math.PI / 4;
    const away = [Math.cos(facing), Math.sin(facing)];
    const [spanFrom, spanTo] = mouthSpan(site.middle);
    const ring = (row: typeof NET_ROWS[number], index: number, from: number, sweep: number, scale: number): P3[] =>
      Array.from({ length: NET_COLUMNS + 1 }, (_, column): P3 => {
        const angle = from + sweep * column / NET_COLUMNS;
        const front = index === 0 && (angle - spanFrom) % (2 * Math.PI) > spanTo - spanFrom;
        const radius = MOUTH_RADIUS * scale * (front ? FRONT_RADIUS : row.radius);
        const point = reshapePoint(center[0] + away[0] * row.drift + radius * Math.cos(angle),
          center[1] + away[1] * row.drift + radius * Math.sin(angle), shift);
        return [point[0], front ? FRONT_TOP : top + (bottom - top) * row.depth, point[1]];
      });
    bags.net.grid(NET_ROWS.map((row, index) => ring(row, index, spanFrom, 2 * Math.PI, 1)), site.mirror, [-away[0], 0, -away[1]], {
      shade: row => NET_ROWS[row].shade * style.netInnerShade,
      uv: (row, column) => [column / NET_COLUMNS * Math.round(2 * Math.PI * MOUTH_RADIUS / tile), (top - bottom) * NET_ROWS[row].depth / tile]
    });
    const depth = NET_ROWS.length - 3;
    const cover = NET_ROWS.findIndex(row => row.depth > covered + 0.06);
    const sink = (points: P3[]): P3[] => points.map((point): P3 => [point[0], bottom - 0.008, point[2]]);
    const inward: P3 = [-away[0], 0, -away[1]];
    const upper = NET_ROWS.slice(0, cover).map((row, index) => ring(row, index, spanFrom, 2 * Math.PI, LINER_SCALE));
    const lower = NET_ROWS.slice(cover - 1, depth + 1)
      .map((row, index) => ring(row, cover - 1 + index, facing + LINER_OPEN, 2 * (Math.PI - LINER_OPEN), LINER_SCALE));
    const floor = sink(ring(NET_ROWS[depth], depth, 0, 2 * Math.PI, LINER_SCALE));
    bags.liner.grid(upper, site.mirror, inward);
    bags.liner.grid([...lower, sink(lower[lower.length - 1])], site.mirror, inward);
    bags.liner.grid([floor, floor.map((): P3 => [center[0] + away[0] * 0.01, bottom - 0.008, center[1] + away[1] * 0.01])], site.mirror, [0, -1, 0]);
  }
  return bags;
}

// 菱形网眼贴图：斜向网线 + 交叉处的绳结，网眼处透明。
function netTexture(scene: B.Scene): B.Texture {
  const period = TILE_SIZE / TILE_CELLS;
  const line = period * TABLE_STYLE.netLineRatio;
  const data = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
  const fromLine = (value: number): number => Math.min(value % period, period - value % period);
  for (let y = 0; y < TILE_SIZE; ++y) {
    for (let x = 0; x < TILE_SIZE; ++x) {
      const a = fromLine(x + y);
      const b = fromLine(x - y + TILE_SIZE);
      const thread = Math.min(a, b) < line / 2 || Math.max(a, b) < line;
      const tone = thread ? 215 + 40 * Math.max(0, 1 - Math.min(a, b) / (line / 2)) : 0;
      data.set([tone, tone, tone, thread ? 255 : 0], 4 * (y * TILE_SIZE + x));
    }
  }
  const texture = B.RawTexture.CreateRGBATexture(data, TILE_SIZE, TILE_SIZE, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return texture;
}

export function netMaterial(scene: B.Scene): B.StandardMaterial {
  const material = new B.StandardMaterial("PocketNetMat", scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = B.Color3.Black();
  material.specularColor = B.Color3.Black();
  material.emissiveColor = B.Color3.FromArray(TABLE_STYLE.netColor);
  material.diffuseTexture = netTexture(scene);
  material.alphaCutOff = 0.2;
  return material;
}

export function linerMaterial(scene: B.Scene): B.StandardMaterial {
  const material = new B.StandardMaterial("PocketLinerMat", scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = B.Color3.Black();
  material.specularColor = B.Color3.Black();
  material.emissiveColor = B.Color3.FromArray(TABLE_STYLE.linerColor);
  return material;
}
