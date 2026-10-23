import { afterEach, describe, expect, it } from "vitest";
import * as B from "babylonjs/es6.js";
import type { BallView } from "../../core/simulator/shot-result.js";
import { Vec3 } from "../../core/math/vec3.js";
import { BallRenderer } from "../balls.js";

const engines: B.NullEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });

function fixture() {
  const engine = new B.NullEngine();
  engines.push(engine);
  const scene = new B.Scene(engine);
  const cube = new B.BaseTexture(scene);
  cube.isCube = true;
  const atlas = new B.Texture("", scene);
  const mask = new B.Texture("", scene);
  const position = { x: 0, y: 0.90625, z: 0 };
  const views = [0, 1, 1, 2, 3, 4, 5, 6, 7].map((number, index) => ({
    index, number, active: true, position: { ...position }, async: false,
    renderPosition: { x: index * 0.1, y: 0.90625, z: 0 },
    renderOrientation: { x: 0, y: 0, z: 0, w: 1 }
  }));
  const source = {
    getBallCount: () => views.length,
    getBallView: (index: number): BallView => {
      const view = views[index];
      return { ...view, position: new Vec3(view.position.x, view.position.y, view.position.z) };
    }
  };
  const balls = new BallRenderer(scene, source, 0.02625, 0.88,
    { radiance: cube, ao: cube, irradiance: Array(30).fill(cube), brdf: atlas }, atlas, mask);
  const mesh = (index: number) => scene.getMeshByName(`ball-${index}`)!;
  const alpha = () => Array.from(scene.getMeshByName("ball-shadows")!.getVerticesData("alpha")!);
  return { scene, balls, views, mesh, alpha, cube, atlas, mask };
}

describe("BallRenderer", () => {
  it("共享普通球几何与同色材质，母球保留高细分几何", () => {
    const { scene, mesh } = fixture();
    expect((mesh(1) as B.Mesh).geometry).toBe((mesh(2) as B.Mesh).geometry);
    expect(mesh(1).material).toBe(mesh(2).material);
    expect(mesh(0).getTotalVertices()).toBeGreaterThan(mesh(1).getTotalVertices());
    expect(scene.materials.filter(material => material.name.startsWith("ball-material-"))).toHaveLength(8);
  });

  it("采用显示位置/四元数，重复同步不修改输入快照", () => {
    const { views, balls, mesh } = fixture();
    views[0].renderPosition = { x: 1, y: 1.2, z: -0.5 };
    views[0].renderOrientation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const before = structuredClone(views);
    balls.sync(); balls.sync();
    expect(mesh(0).position.asArray()).toEqual([1, 1.2, -0.5]);
    expect(mesh(0).rotationQuaternion!.asArray()).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    expect(views).toEqual(before);
  });

  it("阴影用物理高度显隐：显示仍在台上时，物理位置低于台面也隐藏", () => {
    const { views, balls, mesh, alpha } = fixture();
    views[0].position.y = 0.879;
    balls.sync();
    expect(mesh(0).isVisible).toBe(true);
    expect(alpha().slice(0, 4)).toEqual([0, 0, 0, 0]);
    views[0].position.y = 0.88;
    views[0].renderPosition.y = 0.8;
    balls.sync();
    expect(alpha().slice(0, 4)).toEqual(Array(4).fill(Math.fround(0.8)));
  });

  it("失活隐藏球及阴影，重摆后同一网格恢复显示", () => {
    const { views, balls, mesh, alpha } = fixture();
    const original = mesh(1);
    views[1].active = false;
    balls.sync();
    expect(mesh(1).isVisible).toBe(false);
    expect(alpha().slice(4, 8)).toEqual([0, 0, 0, 0]);
    views[1].active = true;
    views[1].renderPosition.x = -1;
    balls.sync();
    expect(mesh(1)).toBe(original);
    expect(mesh(1).isVisible).toBe(true);
    expect(mesh(1).position.x).toBe(-1);
    expect(alpha().slice(4, 8)).toEqual(Array(4).fill(Math.fround(0.8)));
  });

  it("释放自有几何/材质，保留场景和共享贴图", () => {
    const { scene, balls, cube, atlas, mask } = fixture();
    balls.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials.filter(material => material.name.startsWith("ball-"))).toHaveLength(0);
    expect([cube, atlas, mask].every(texture => scene.textures.includes(texture))).toBe(true);
  });
});
