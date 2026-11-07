import type { PracticeTable } from "./table-geometry.js";
import type { PracticeLayout } from "./shape-types.js";
import {
  BALL_ON, COLOUR_INDEX, RED_INDICES, activateColours, baseBalls,
  finishLayout, lineFrom, place, placeSpot
} from "./shape-utils.js";

/** 订书钉：粉球所在横梁左 4 + 右 4，两侧各向下 3，黑球后方中线 1 颗。 */
export function stapleLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const spacing = 1.8 * 2 * table.ballRadius;
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const leftArm = { x: pink.x, z: pink.z + spacing * 4 };
  const rightArm = { x: pink.x, z: pink.z - spacing * 4 };
  const points = [
    ...lineFrom(pink, 0, spacing, 4),
    ...lineFrom(pink, 0, -spacing, 4),
    ...lineFrom(leftArm, spacing, 0, 3),
    ...lineFrom(rightArm, spacing, 0, 3),
    { x: (black.x + table.maxX) / 2, z: 0 }
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** X 球形：粉球为交叉中心，左上 3 + 右上 3 + 左下 4 + 右下 4，右侧长库旁 1 颗。 */
export function xLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const diameter = 2 * table.ballRadius;
  const step = 1.8 * diameter / Math.SQRT2;
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const points = [
    ...lineFrom(pink, -step, step, 3),
    ...lineFrom(pink, -step, -step, 3),
    ...lineFrom(pink, step, step, 4),
    ...lineFrom(pink, step, -step, 4),
    { x: (pink.x + black.x) / 2, z: table.minZ + 3.5 * diameter }
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** 金字塔散点：粉球为顶点，向黑球方向 1+2+3+4 紧密三角，外围 5 颗散点。 */
export function pyramidLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const diameter = 2 * table.ballRadius;
  const rowStep = diameter * Math.sqrt(3) / 2;
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const points: { x: number; z: number }[] = [];
  let rowX = pink.x + diameter;
  for (let row = 1; row <= 4; row++) {
    if (row > 1) rowX += rowStep;
    for (let column = 0; column < row; column++) {
      points.push({ x: rowX, z: (column - (row - 1) / 2) * diameter });
    }
  }
  const baseX = pink.x + diameter + 3 * rowStep;
  const nearCushionZ = table.maxZ - 3.5 * diameter;
  points.push(
    { x: baseX, z: nearCushionZ },
    { x: baseX + 4 * diameter, z: 7 * diameter },
    { x: baseX + 4 * diameter, z: -7 * diameter },
    { x: table.maxX - 1.5 * diameter, z: 7 * diameter },
    { x: table.maxX - 1.5 * diameter, z: -7 * diameter }
  );
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** 双龙：粉—黑之间两排纵向长龙，8 + 7 颗，排距 1.5d、纵向错开半颗。 */
export function doubleDragonLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const diameter = 2 * table.ballRadius;
  const lateral = .75 * diameter;
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const span = 7 * diameter;
  const start = pink.x + (black.x - pink.x - span) / 2;
  const points = [
    ...Array.from({ length: 8 }, (_, index) => ({ x: start + index * diameter, z: lateral })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: start + (index + .5) * diameter, z: -lateral }))
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** 清彩：无红球，六颗彩球在标准点位，目标从黄球开始。 */
export function clearanceLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  return finishLayout(balls, table, BALL_ON.yellow);
}

/** 五分点：只留蓝球与母球，母球默认放在空出的绿球点，可自由换位。 */
export function fiveSpotsLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  placeSpot(balls, table, COLOUR_INDEX.blue);
  return finishLayout(balls, table, BALL_ON.blue, table.spots[COLOUR_INDEX.green]);
}
