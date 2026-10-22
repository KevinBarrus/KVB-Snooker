import { describe, expect, it } from "vitest";
import { unpackCubeAtlas } from "../cube-data.js";
import { createProbeSample, sampleLightProbes } from "../light-probes.js";

describe("PCOL cube atlas", () => {
  it("六面逐行读取、多探针横向排列，不翻转面方向", () => {
    const pixels = Float32Array.from({ length: 4 * 12 * 3 }, (_, index) => index);
    const cubes = unpackCubeAtlas(pixels, 4, 12, 3);
    expect(cubes).toHaveLength(2);
    expect(cubes[0].size).toBe(2);
    expect(Array.from(cubes[1].faces[2])).toEqual([54, 55, 56, 57, 58, 59, 66, 67, 68, 69, 70, 71]);
  });
  it("PNG AO 丢弃 alpha，按 2.2 次方转线性；HDR 保留大于 1 的值", () => {
    const ldr = Uint8Array.from({ length: 24 }, (_, i) => [128, 255, 0, 123][i % 4]);
    expect(unpackCubeAtlas(ldr, 1, 6, 4, 255, 2.2)[0].faces[0][0]).toBeCloseTo((128 / 255) ** 2.2, 7);
    expect(unpackCubeAtlas(new Float32Array(18).fill(4), 1, 6, 3)[0].faces[5][2]).toBe(4);
  });
  it.each([[2, 7, 42], [0, 6, 0], [2, 12, 10]])("拒绝非法尺寸/数据长度 %j", (w, h, length) => {
    expect(() => unpackCubeAtlas(new Float32Array(length), w, h, 3)).toThrow("Invalid cube atlas");
  });
});

describe("PCOL light probes", () => {
  it("单元中心八角权重均为 1/8，按原作角点顺序索引", () => {
    const sample = createProbeSample();
    sampleLightProbes({ x: (-1.6 - 1.04) / 2, y: (0.90625 + 1.65) / 2, z: -0.35 }, sample);
    expect(sample.indices).toEqual([0, 1, 16, 15, 5, 6, 21, 20]);
    expect(Array.from(sample.ratios.slice(0, 8))).toEqual(Array(8).fill(0.125));
    expect(sample.ratios[8]).toBe(0);
  });
  it("贴台时哨兵为 -1，保留未使用的上层权重", () => {
    const sample = createProbeSample();
    sampleLightProbes({ x: -1.32, y: 1.278125, z: -0.35 }, sample);
    sampleLightProbes({ x: -1.32, y: 0.90625, z: -0.35 }, sample);
    expect(sample.ratios[2]).toBe(-1);
    expect(sample.ratios[3]).toBe(0.125);
    expect(sample.ratios[0] + sample.ratios[1] + sample.ratios[4] + sample.ratios[5]).toBe(1);
  });
  it("跨单元移动、边界容差及台外位置夹取", () => {
    const sample = createProbeSample();
    sampleLightProbes({ x: 10, y: 10, z: 10 }, sample);
    expect(sample.groupId).toBe(7);
    expect(sample.indices[6]).toBe(29);
    expect(sample.ratios[6]).toBe(1);
    sampleLightProbes({ x: -10, y: -10, z: -10 }, sample);
    expect(sample.groupId).toBe(0);
    expect(sample.ratios[0]).toBe(1);
    sampleLightProbes({ x: -1.04 + 0.000005, y: 1, z: -0.35 }, sample);
    expect(sample.groupId).toBe(0);
  });
  it("动态 AO 中心 0.4，远端 1.1，抬高 0.1 后归零", () => {
    const sample = createProbeSample();
    sampleLightProbes({ x: 0, y: Math.fround(0.90625), z: 0 }, sample);
    expect(sample.ratios[8]).toBeCloseTo(0.4, 7);
    sampleLightProbes({ x: 2.2, y: Math.fround(0.90625), z: 1.3 }, sample);
    expect(sample.ratios[8]).toBeCloseTo(1.1, 7);
    sampleLightProbes({ x: 0, y: 1.1, z: 0 }, sample);
    expect(sample.ratios[8]).toBe(0);
  });
});
