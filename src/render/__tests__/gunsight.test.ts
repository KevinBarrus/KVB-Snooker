import { afterEach, describe, expect, it } from "vitest";
import * as B from "babylonjs/es6.js";
import { Vec3 } from "../../core/math/vec3.js";
import type { PredictionContext } from "../../core/simulator/shot-result.js";
import { Gunsight } from "../gunsight.js";
import { TABLE_COLORS } from "../table-overlay.js";

const engines: B.NullEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });
const radius = .02625;
const names = ["incoming", "cue-mark", "outgoing", "target-mark", "target-line"];
function setup() {
  const engine = new B.NullEngine(); engines.push(engine);
  const scene = new B.Scene(engine);
  const atlas = new B.Texture("", scene), mask = new B.Texture("", scene);
  const sight = new Gunsight(scene, atlas, mask, radius);
  sight.alpha = .6;
  const mesh = (name: string) => scene.getMeshByName(`gunsight-${name}`)!;
  const positions = (name: string) => Array.from(mesh(name).getVerticesData("position")!);
  const visible = () => names.map(name => mesh(name).isVisible);
  return { scene, sight, mesh, positions, visible, atlas, mask };
}
function context(overrides: Partial<PredictionContext> = {}): PredictionContext {
  return { impactOccured: false, hasImpactTarget: false, impactV1: new Vec3(2, 0, 0),
    p0: { x: 0, y: .90625, z: 0 }, p1: { x: .5, y: .90625, z: 0 }, cue: { x: 1, y: .90625, z: 0 },
    cueVSq: .4, p2: { x: .5525, y: .90625, z: 0 }, target: { x: .5525, y: .90625, z: .3 },
    targetVSq: 4, targetNumber: 2, ...overrides };
}

// PCOL L1529-1730
describe("Gunsight", () => {
  it("未碰撞仅显示母球线，按原图集分段，末端顶点淡出", () => {
    const { sight, mesh, positions, visible } = setup();
    sight.syncPrediction(context(), 65535);
    expect(visible()).toEqual([true, false, false, false, false]);
    const line = mesh("incoming");
    expect(line.getTotalVertices()).toBe(8);
    expect(line.getIndices()!.length).toBe(18);
    expect(positions("incoming")[0]).toBeCloseTo(radius);
    expect(positions("incoming")[18]).toBeCloseTo(1);
    expect(Array.from(line.getVerticesData("alpha")!)).toEqual([.6, .6, .6, .6, 0, 0, 0, 0].map(Math.fround));
    const uv = line.getVerticesData("uv")!;
    expect(uv[0]).toBeCloseTo(148 / 512);
    expect(uv[uv.length - 1]).toBeCloseTo(500 / 512);
  });

  it("球球碰撞显示五部分，非法目标红色，长度与扇形按原公式", () => {
    const { sight, mesh, positions, visible } = setup();
    const prediction = context({ impactOccured: true, hasImpactTarget: true, cue: { x: .7, y: 1, z: .3 } });
    const before = structuredClone(prediction);
    sight.syncPrediction(prediction, 2);
    expect(visible()).toEqual([true, true, true, true, true]);
    expect(mesh("cue-mark").position.asArray()).toEqual([.5, .8811, 0]);
    expect(mesh("target-mark").position.x).toBe(.5525);
    expect(mesh("target-mark").alphaIndex).toBe(10);
    expect(Array.from(mesh("target-mark").getVerticesData("color")!).slice(0, 3)).toEqual(TABLE_COLORS.red);
    const out = positions("outgoing");
    const length = .5 * (.2 ** 2 + .3 ** 2) + .5 * .4;
    expect((out[12] + out[15]) / 2).toBeCloseTo(.5 + length * .2 / Math.hypot(.2, .3));
    expect((out[14] + out[17]) / 2).toBeCloseTo(length * .3 / Math.hypot(.2, .3));
    const target = positions("target-line");
    expect(target[14]).toBeCloseTo(.4);
    const half = radius / 4 + (.4 - radius - radius / 2) * 2.8;
    expect(target[15] - target[12]).toBeCloseTo(2 * half);
    expect(prediction).toEqual(before);
    sight.syncPrediction(prediction, 4);
    expect(Array.from(mesh("target-mark").getVerticesData("color")!).slice(0, 3)).toEqual(TABLE_COLORS.white);
  });

  it("撞库仅显示母球撞点和后续路线，重复预测清除旧目标显示", () => {
    const { sight, visible } = setup();
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true }), 65535);
    sight.syncPrediction(context({ impactOccured: true, cue: { x: .3, y: .9, z: 0 } }), 65535);
    expect(visible()).toEqual([true, true, true, false, false]);
    sight.syncPrediction(context(), 65535);
    expect(visible()).toEqual([true, false, false, false, false]);
  });

  it("贴球隐藏入射段，仍用 impactV1 确定目标扇形张角", () => {
    const { sight, visible, positions } = setup();
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true,
      p1: { x: .02, y: .9, z: 0 }, cueVSq: 0, cue: { x: .02, y: .9, z: 0 } }), 4);
    expect(visible()).toEqual([false, true, false, true, true]);
    const target = positions("target-line");
    expect(target[15] - target[12]).toBeGreaterThan(.5);
  });

  it("低速、零位移和耗尽总长度时隐藏相应段；短段仍保留最小贴图端帽", () => {
    const { sight, visible, positions } = setup();
    sight.syncPrediction(context({ cue: { x: radius, y: .9, z: 0 } }), 65535);
    expect(visible()).toEqual([false, false, false, false, false]);
    sight.syncPrediction(context({ cue: { x: radius + .001, y: .9, z: 0 } }), 65535);
    expect(positions("incoming")[18]).toBeCloseTo(radius + 2 * radius * 30 / 125);
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true, targetVSq: 0 }), 4, .3);
    expect(visible()).toEqual([true, true, false, true, false]);
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true,
      cue: { x: .5, y: .9, z: 0 }, target: { x: .5525, y: .9, z: 0 } }), 4);
    for (const name of names) expect(positions(name).every(Number.isFinite)).toBe(true);
  });

  it("目标方向从切球改为直球时消除旧扇形，整体 alpha=0 隐藏全部", () => {
    const { sight, mesh, positions, visible } = setup();
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true }), 4);
    sight.syncPrediction(context({ impactOccured: true, hasImpactTarget: true,
      target: { x: 1, y: .9, z: 0 } }), 4);
    const target = positions("target-line");
    expect(Math.abs(target[14] - target[17])).toBeCloseTo(radius / 2);
    sight.alpha = .3;
    expect(mesh("incoming").getVerticesData("alpha")![0]).toBeCloseTo(.3);
    sight.alpha = 0;
    expect(visible()).toEqual(Array(5).fill(false));
  });

  it("释放全部辅助线网格和自有材质，保留共享图集与 mask", () => {
    const { scene, sight, atlas, mask } = setup();
    sight.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials.some(material => material.name === "table-overlay")).toBe(false);
    expect(scene.textures).toContain(atlas);
    expect(scene.textures).toContain(mask);
  });
});
