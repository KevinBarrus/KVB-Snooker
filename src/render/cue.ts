import * as B from "babylonjs/es6.js";
import { assetUrl, loadTexture } from "./assets.js";
import { CueMaterial, type BallLighting } from "./materials.js";

// PCOL L1216-1239, L1431-1446
export async function loadCue(scene: B.Scene, lighting: BallLighting): Promise<B.Mesh> {
  const [model, diffuse, glossy] = await Promise.all([
    B.SceneLoader.ImportMeshAsync("StickAlpha", "/assets/render/", assetUrl("cue-model").split("/").pop()!, scene),
    loadTexture(scene, "cue-color"), loadTexture(scene, "cue-glossy")
  ]);
  const mesh = model.meshes.find(mesh => mesh.name === "StickAlpha");
  if (!(mesh instanceof B.Mesh)) throw new Error("Missing StickAlpha mesh");
  mesh.material = new CueMaterial(scene, lighting, diffuse, glossy);
  mesh.isVisible = false;
  return mesh;
}
