import * as B from "babylonjs/es6.js";
import { assetUrl } from "./assets.js";
import { beautifyTable } from "./table.js";
import type { JawShift } from "./table-shape.js";
import type { CushionOutline } from "./table-cushions.js";

export interface SceneAppearance {
  readonly cinema?: { readonly outline: CushionOutline };
  readonly blender?: { readonly outline: CushionOutline };
}

// PCOL L2079-2107, L20-24
export async function loadTableScene(engine: B.Engine, jawShift: JawShift, appearance: SceneAppearance = {}): Promise<B.Scene> {
  const scene = new B.Scene(engine);
  try {
    B.SceneLoader.ShowLoadingScreen = false;
    if (!appearance.blender) await B.SceneLoader.AppendAsync("/assets/render/", assetUrl("model").split("/").pop()!, scene);
    for (const camera of [...scene.cameras]) camera.dispose();
    scene.detachControl();
    const camera = new B.TargetCamera("defCam", new B.Vector3(-4.5, 1.7, 5), scene);
    camera.lockedTarget = new B.Vector3(0, 0.88, 0);
    camera.fov = 0.88;
    camera.minZ = 0.01;
    scene.activeCamera = camera;
    if (appearance.blender) {
      await (await import("./blender-table.js")).buildBlenderTable(scene, appearance.blender.outline);
    } else if (appearance.cinema) {
      await (await import("./cinema-table.js")).buildCinemaTable(scene, jawShift, appearance.cinema.outline);
    } else await beautifyTable(scene, jawShift);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
}
