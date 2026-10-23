import * as B from "babylonjs/es6.js";
import { assetUrl, loadTexture } from "./assets.js";
import { loadCarpetMaterial } from "./materials.js";

export function requireMesh(scene: B.Scene, name: string): B.Mesh {
  const mesh = scene.getMeshByName(name);
  if (!(mesh instanceof B.Mesh)) throw new Error(`Missing scene mesh: ${name}`);
  return mesh;
}

function requireStandardMaterial(mesh: B.Mesh): B.StandardMaterial {
  if (!(mesh.material instanceof B.StandardMaterial)) throw new Error(`Invalid material on ${mesh.name}`);
  return mesh.material;
}

// PCOL L388-442
export async function beautifyTable(scene: B.Scene): Promise<void> {
  for (const material of scene.materials) {
    if (material instanceof B.StandardMaterial) material.disableLighting = true;
  }
  const ground = requireStandardMaterial(requireMesh(scene, "Ground"));
  const pocket = requireMesh(scene, "Pocket");
  const pocketMaterial = requireStandardMaterial(pocket);
  const pocketLight = scene.getLightByName("PocketLight");
  const gameLight = scene.getLightByName("GameLight");
  if (!pocketLight || !(gameLight instanceof B.SpotLight)) throw new Error("Missing table lights");
  pocketLight.includedOnlyMeshes = [pocket];
  pocketMaterial.invertNormalMapX = pocketMaterial.invertNormalMapY = true;
  pocketMaterial.diffuseColor = new B.Color3(0.002, 0.002, 0.002).toGammaSpace();
  pocketMaterial.ambientColor = pocketMaterial.diffuseColor;
  pocketMaterial.disableLighting = false;
  const cloth = requireMesh(scene, "TableInner");
  gameLight.includedOnlyMeshes = [cloth];
  gameLight.diffuse = B.Color3.White();
  gameLight.intensity = 60;
  gameLight.angle = 175 / 180 * Math.PI;
  gameLight.position.y = 3.6;
  const [groundTexture, pocketGloss, base, roughness, ao, normal, environment, carpet] = await Promise.all([
    loadTexture(scene, "ground-tiled"), loadTexture(scene, "pocket-glossy"),
    loadTexture(scene, "frame-diffuse"), loadTexture(scene, "frame-roughness"),
    loadTexture(scene, "frame-light"), loadTexture(scene, "frame-normal-1024"),
    new Promise<B.HDRCubeTexture>((resolve, reject) => {
      const texture = new B.HDRCubeTexture(assetUrl("frame-ref"), scene, 256, false, false, false, false,
        () => resolve(texture), message => reject(new Error(`Frame environment: ${message}`)));
    }),
    loadCarpetMaterial(scene, gameLight)
  ]);
  groundTexture.uScale = groundTexture.vScale = 30;
  ground.lightmapTexture = groundTexture;
  ground.useLightmapAsShadowmap = true;
  pocketMaterial.specularTexture = pocketGloss;
  cloth.material = carpet;
  const frame = new B.PBRMetallicRoughnessMaterial("FrameMat", scene);
  frame.baseTexture = base;
  frame.metallic = 1;
  frame.roughness = 0.8;
  frame.metallicRoughnessTexture = roughness;
  base.uScale = base.vScale = roughness.uScale = roughness.vScale = 4;
  frame.disableLighting = true;
  frame.environmentTexture = environment;
  frame.occlusionTexture = ao;
  frame.normalTexture = normal;
  frame.invertNormalMapX = frame.invertNormalMapY = true;
  requireMesh(scene, "Frame").material = frame;
}
