import * as B from "babylonjs/es6.js";
import { assetUrl, loadTexture } from "./assets.js";
import { loadCarpetMaterial } from "./materials.js";
import { buildLeather, leatherTexture } from "./pocket-leather.js";
import { buildNet, linerMaterial, netMaterial } from "./pocket-net.js";
import { buildRunners } from "./pocket-runner.js";
import { buildFrame } from "./table-frame.js";
import { reshapeMesh, type JawShift } from "./table-shape.js";
import { TABLE_STYLE } from "./table-style.js";

// =====================================================================
// 球台装配：原模型只保留台呢（TableInner，含库边）与球馆；
// 木框、台体、柱腿（table-frame.ts）、皮口（pocket-leather.ts）、网兜（pocket-net.ts）由代码生成。
// 颜色、尺寸、亮度集中在 table-style.ts；本文件只负责材质与灯光接线。
// =====================================================================
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
export async function beautifyTable(scene: B.Scene, jawShift: JawShift): Promise<void> {
  const style = TABLE_STYLE;
  for (const material of scene.materials) {
    if (material instanceof B.StandardMaterial) material.disableLighting = true;
  }
  const ground = requireStandardMaterial(requireMesh(scene, "Ground"));
  const pocket = requireMesh(scene, "Pocket");
  const pocketMaterial = requireStandardMaterial(pocket);
  const pocketLight = scene.getLightByName("PocketLight");
  const gameLight = scene.getLightByName("GameLight");
  if (!pocketLight || !(gameLight instanceof B.SpotLight)) throw new Error("Missing table lights");

  // 皮口：全场只有它受袋口灯直接照射
  pocketLight.includedOnlyMeshes = [pocket];
  pocketLight.intensity = style.leatherLight;
  pocketMaterial.unfreeze();
  pocketMaterial.bumpTexture = null;
  pocketMaterial.diffuseTexture = leatherTexture(scene);
  pocketMaterial.diffuseColor = B.Color3.FromArray(style.leatherColor).scale(1 / 0.8);
  pocketMaterial.emissiveColor = B.Color3.FromArray(style.leatherShadowColor);
  pocketMaterial.specularColor = new B.Color3(style.leatherGloss, style.leatherGloss, style.leatherGloss);
  pocketMaterial.specularPower = 48;
  pocketMaterial.disableLighting = false;
  pocketMaterial.backFaceCulling = false;
  pocketMaterial.twoSidedLighting = true;
  buildLeather(jawShift).applyTo(pocket);
  const bags = buildNet(jawShift);
  bags.net.applyTo(new B.Mesh("PocketNet", scene)).material = netMaterial(scene);
  bags.liner.applyTo(new B.Mesh("PocketLiner", scene)).material = linerMaterial(scene);

  const cloth = requireMesh(scene, "TableInner");
  reshapeMesh(cloth, jawShift);
  gameLight.includedOnlyMeshes = [cloth];
  gameLight.diffuse = B.Color3.White();
  gameLight.intensity = 60;
  gameLight.angle = 175 / 180 * Math.PI;
  gameLight.position.y = 3.6;
  const [groundTexture, grain, environment, carpet] = await Promise.all([
    loadTexture(scene, "ground-tiled"), loadTexture(scene, "frame-diffuse"),
    new Promise<B.HDRCubeTexture>((resolve, reject) => {
      const texture = new B.HDRCubeTexture(assetUrl("frame-ref"), scene, 256, false, false, false, false,
        () => resolve(texture), (message, error) => reject(error ?? new Error(message ?? "Failed to load frame-ref")));
    }),
    loadCarpetMaterial(scene, gameLight)
  ]);
  groundTexture.uScale = groundTexture.vScale = 30;
  ground.lightmapTexture = groundTexture;
  ground.useLightmapAsShadowmap = true;
  cloth.material = carpet;

  // 台框：玫瑰木与金漆两种材质，受台灯直射，环境光与反射取自球馆环境贴图
  const frame = buildFrame();
  const wood = new B.PBRMetallicRoughnessMaterial("FrameMat", scene);
  grain.level = style.railBrightness;
  wood.baseTexture = grain;
  wood.baseColor = B.Color3.FromArray(style.railColor);
  wood.metallic = 0;
  wood.roughness = style.railRoughness;
  const gold = new B.PBRMetallicRoughnessMaterial("FrameGoldMat", scene);
  gold.baseColor = B.Color3.FromArray(style.goldColor);
  gold.metallic = style.goldMetallic;
  gold.roughness = style.goldRoughness;
  environment.level = style.reflection;
  environment.sphericalPolynomial?.scale(style.ambient);
  const rods = buildRunners(frame.gold).applyTo(new B.Mesh("PocketRunner", scene));
  const rubber = new B.PBRMetallicRoughnessMaterial("PocketRunnerMat", scene);
  rubber.baseColor = B.Color3.FromArray(style.runnerColor);
  rubber.metallic = 0;
  rubber.roughness = 0.45;
  rods.material = rubber;
  for (const material of [wood, gold, rubber]) {
    material.environmentTexture = environment;
    material.doubleSided = true;
  }
  const rail = frame.wood.applyTo(requireMesh(scene, "Frame"));
  rail.material = wood;
  const trim = frame.gold.applyTo(new B.Mesh("FrameGold", scene));
  trim.material = gold;
  const lamp = new B.PointLight("TableLampLight", new B.Vector3(0, 2.3, 0), scene);
  lamp.intensity = style.lampLight;
  lamp.includedOnlyMeshes = [rail, trim, rods];
  const fill = new B.HemisphericLight("TableFillLight", new B.Vector3(0, 1, 0), scene);
  fill.intensity = style.fillLight;
  fill.groundColor = new B.Color3(style.fillGround, style.fillGround, style.fillGround);
  fill.includedOnlyMeshes = [pocket];
  requireMesh(scene, "TableBot").setEnabled(false);
}
