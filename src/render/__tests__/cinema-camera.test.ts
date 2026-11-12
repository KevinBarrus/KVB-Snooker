import { afterEach, describe, expect, it } from "vitest";
import * as B from "babylonjs/es6.js";
import { CinemaCamera } from "../cinema-camera.js";

const engines: B.NullEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });

describe("cinema observation camera", () => {
  it("restores gameplay pose and projection after observation without mutating the controller target", () => {
    const engine = new B.NullEngine(); engines.push(engine);
    const scene = new B.Scene(engine);
    const camera = new B.TargetCamera("game", new B.Vector3(3, 1.7, 2), scene);
    const target = new B.Vector3(0.5, 0.9, 0.2);
    camera.lockedTarget = target; camera.fov = 0.88;
    const observation = new CinemaCamera(camera);
    observation.begin("top"); observation.apply();
    expect(camera.upVector.asArray()).toEqual([-1, 0, 0]);
    expect(camera.mode).toBe(B.Camera.ORTHOGRAPHIC_CAMERA);
    expect(camera.position.y).toBe(3.1);
    expect(target.asArray()).toEqual([0.5, 0.9, 0.2]);
    observation.release();
    expect(camera.position.asArray()).toEqual([3, 1.7, 2]);
    expect(camera.getTarget().asArray().every(Number.isFinite)).toBe(true);
    expect(camera.upVector.asArray()).toEqual([0, 1, 0]);
    expect(camera.fov).toBe(0.88);
    expect(camera.mode).toBe(B.Camera.PERSPECTIVE_CAMERA);
  });

  it("limits zoom and floor penetration, and hands a replay camera back without restoring gameplay pose", () => {
    const engine = new B.NullEngine(); engines.push(engine);
    const scene = new B.Scene(engine);
    const camera = new B.TargetCamera("game", new B.Vector3(3, 1.7, 2), scene);
    const observation = new CinemaCamera(camera);
    observation.begin("display"); observation.orbit(10000, -10000); observation.zoom(-10000); observation.apply();
    expect(camera.position.y).toBeGreaterThanOrEqual(0.15);
    expect(camera.position.asArray().every(Number.isFinite)).toBe(true);
    camera.position.set(3.43, 2.08, 0);
    observation.release(false);
    expect(camera.position.asArray()).toEqual([3.43, 2.08, 0]);
    expect(camera.upVector.asArray()).toEqual([0, 1, 0]);
  });
});
