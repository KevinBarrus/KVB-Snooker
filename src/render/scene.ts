import * as B from "babylonjs/es6.js";
import { assetUrl } from "./assets.js";
import { beautifyTable } from "./table.js";

// PCOL L2079-2107, L20-24
export async function loadTableScene(engine: B.Engine): Promise<B.Scene> {
  const scene = new B.Scene(engine);
  try {
    B.SceneLoader.ShowLoadingScreen = false;
    await B.SceneLoader.AppendAsync("/assets/render/", assetUrl("model").split("/").pop()!, scene);
    for (const camera of [...scene.cameras]) camera.dispose();
    scene.detachControl();
    const camera = new B.TargetCamera("defCam", new B.Vector3(-4.5, 1.7, 5), scene);
    camera.lockedTarget = new B.Vector3(0, 0.88, 0);
    camera.fov = 0.88;
    camera.minZ = 0.01;
    scene.activeCamera = camera;
    await beautifyTable(scene);
    return scene;
  } catch (error) {
    scene.dispose();
    throw error;
  }
}
