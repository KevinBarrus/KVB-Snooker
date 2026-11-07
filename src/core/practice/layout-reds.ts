import type { PracticeTable } from "./table-geometry.js";
import type { PracticeLayout } from "./shape-types.js";
import {
  BALL_ON, COLOUR_INDEX, RED_INDICES, activateColours, baseBalls,
  curvePoints, divideBetween, finishLayout, lineFrom, place
} from "./shape-utils.js";

/** 经典蛇彩：15 颗红球沿纵向中线，被黑、粉、蓝三个彩球分成 3 + 5 + 7。 */
export function snakeLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const black = table.spots[COLOUR_INDEX.black];
  const pink = table.spots[COLOUR_INDEX.pink];
  const blue = table.spots[COLOUR_INDEX.blue];
  const xs = [
    ...divideBetween(black.x, table.maxX, 3),
    ...divideBetween(pink.x, black.x, 5),
    ...divideBetween(blue.x, pink.x, 7)
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, { x: xs[order], z: 0 }));
  return finishLayout(balls, table, BALL_ON.red);
}

/** S 球形：蓝→粉为左鼓弧线（8 颗），粉→黑为右鼓弧线（6 颗），黑球下方偏左 1 颗收尾。 */
export function sLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const diameter = 2 * table.ballRadius;
  const offset = 1.5 * diameter;
  const bulge = 7 * diameter;
  const blue = table.spots[COLOUR_INDEX.blue];
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const upper = curvePoints(
    { x: blue.x + offset, z: blue.z + offset },
    { x: blue.x + (pink.x - blue.x) * .3, z: bulge },
    { x: blue.x + (pink.x - blue.x) * .7, z: bulge },
    { x: pink.x - offset, z: pink.z + offset }, 8
  );
  const lower = curvePoints(
    { x: pink.x + offset, z: pink.z - offset },
    { x: pink.x + (black.x - pink.x) * .25, z: -bulge },
    { x: pink.x + (black.x - pink.x) * .75, z: -bulge },
    { x: black.x - offset, z: black.z - offset }, 6
  );
  const points = [...upper, ...lower, { x: black.x + offset, z: black.z + offset }];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** T 球形：粉球为横竖交点；5 颗红球在粉—黑之间等分，横梁按同一间距向左右各 5 颗。 */
export function tLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const pink = table.spots[COLOUR_INDEX.pink];
  const black = table.spots[COLOUR_INDEX.black];
  const spacing = (black.x - pink.x) / 6;
  const points = [
    ...lineFrom(pink, 0, spacing, 5),
    ...lineFrom(pink, 0, -spacing, 5),
    ...lineFrom(pink, spacing, 0, 5)
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}

/** Y 球形：粉球为三叉交点，主干 5 颗等分蓝—粉区间，两翼各 5 颗沿 45° 斜线。 */
export function yLayout(table: PracticeTable): PracticeLayout {
  const balls = baseBalls(table);
  activateColours(balls, table);
  const diameter = 2 * table.ballRadius;
  const step = 1.8 * diameter / Math.SQRT2;
  const pink = table.spots[COLOUR_INDEX.pink];
  const blue = table.spots[COLOUR_INDEX.blue];
  const stem = divideBetween(pink.x, blue.x, 5).map(x => ({ x, z: 0 }));
  const points = [
    ...stem,
    ...lineFrom(pink, step, step, 5),
    ...lineFrom(pink, step, -step, 5)
  ];
  RED_INDICES.forEach((index, order) => place(balls, index, points[order]));
  return finishLayout(balls, table, BALL_ON.red);
}
