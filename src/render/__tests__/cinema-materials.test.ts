import { afterEach, describe, expect, it, vi } from "vitest";
import * as B from "babylonjs/es6.js";
import { BallRenderer } from "../balls.js";
import { cinemaBallMaterial } from "../cinema-materials.js";
import type { BallView } from "../../core/simulator/shot-result.js";
import { Vec3 } from "../../core/math/vec3.js";

const engines: B.NullEngine[] = [];
afterEach(() => { vi.restoreAllMocks(); engines.splice(0).forEach(engine => engine.dispose()); });

describe("cinema ball materials", () => {
  it("reuses ball geometry and snapshots, changes dots without moving or scaling balls, releases owned materials", () => {
    const engine = new B.NullEngine(); engines.push(engine);
    const scene = new B.Scene(engine);
    vi.spyOn(engine, "createRawTexture").mockImplementation(data => {
      expect(data?.byteLength).toBe(512 * 256 * 4);
      return engine.createTexture("", false, false, scene);
    });
    const atlas = new B.Texture("", scene), mask = new B.Texture("", scene);
    const views: BallView[] = [0, 1, 1].map((number, index) => ({ index, number, active: true, async: false,
      position: new Vec3(index * 0.1, 0.90625, 0), renderPosition: { x: index * 0.1, y: 0.90625, z: 0 },
      renderOrientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }));
    const before = JSON.stringify(views);
    let dots = false;
    const balls = new BallRenderer(scene, { getBallCount: () => views.length, getBallView: i => views[i] },
      0.02625, 0.88, null, atlas, mask, {
        createMaterial: (number, redDots) => cinemaBallMaterial(scene, number, redDots), redDots: () => dots
      });
    const cue = scene.getMeshByName("ball-0")!;
    cue.computeWorldMatrix(true);
    expect(cue.getBoundingInfo().boundingSphere.radiusWorld).toBeGreaterThanOrEqual(0.02625);
    expect(cue.scaling.asArray()).toEqual([1, 1, 1]);
    expect(scene.getMeshByName("ball-1")!.material).toBe(scene.getMeshByName("ball-2")!.material);
    dots = true; balls.sync();
    expect(cue.material?.name).toBe("cinema-ball-0-dots");
    expect(cue.rotationQuaternion?.asArray()).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    dots = false; balls.sync();
    expect(cue.material?.name).toBe("cinema-ball-0");
    expect(JSON.stringify(views)).toBe(before);
    balls.dispose();
    expect(scene.materials.filter(material => material.name.startsWith("cinema-ball"))).toHaveLength(0);
    expect(scene.textures).toContain(atlas);
  });

  it("rejects unsupported ball numbers", () => {
    const engine = new B.NullEngine(); engines.push(engine);
    expect(() => cinemaBallMaterial(new B.Scene(engine), 99)).toThrow("Unknown cinema ball");
  });
});
