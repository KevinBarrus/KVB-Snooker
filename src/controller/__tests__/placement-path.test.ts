import { describe, expect, it } from "vitest";
import { constrainPlacement } from "../placement-path.js";

const point = (x: number, z = 0) => ({ x, y: .88, z });
const balls = [{ index: 1, active: true, position: point(0) }];
const valid = (p: { x: number; z: number }) => Math.abs(p.x) <= 1 && Math.abs(p.z) <= .5 && Math.hypot(p.x, p.z) >= .053;

describe("900 连续摆球路径", () => {
  it("高速跨过球时停在接触前，不能只检查合法终点", () => {
    const result = constrainPlacement(point(-.5), point(.5), balls, .02625, valid);
    expect(result.x).toBeCloseTo(-.053026, 5);
    expect(valid(result)).toBe(true);
    expect(result.z).toBe(0);
  });
  it("允许绕过阻挡球，且不穿出台边", () => {
    const corner = constrainPlacement(point(-.5), point(-.5, .2), balls, .02625, valid);
    const past = constrainPlacement(corner, point(.5, .2), balls, .02625, valid);
    expect(past).toEqual(point(.5, .2));
    const edge = constrainPlacement(past, point(3, .2), balls, .02625, valid);
    expect(edge.x).toBeCloseTo(1, 6);
    expect(valid(edge)).toBe(true);
  });
  it("D区边界和非有限射线都不允许跳过", () => {
    const inD = (p: { x: number; z: number }) => p.x <= -1.04 && Math.hypot(p.x + 1.04, p.z) <= .29;
    const start = point(-1.2);
    expect(constrainPlacement(start, point(1), [], .02625, inD).x).toBeCloseTo(-1.04, 6);
    expect(constrainPlacement(start, point(NaN), [], .02625, inD)).toEqual(start);
  });
});
