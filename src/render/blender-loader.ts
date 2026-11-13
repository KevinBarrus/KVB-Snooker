import * as B from "babylonjs/es6.js";

export const BLENDER_ASSET_ROOT = "/assets/render/blender/";
let plugin: Promise<void> | undefined;

function loadPlugin(): Promise<void> {
  if (plugin) return plugin;
  plugin = new Promise<void>((resolve, reject) => {
    const host = window as Window & { BABYLON?: typeof B };
    host.BABYLON = { ...B };
    const script = document.createElement("script");
    script.src = `${BLENDER_ASSET_ROOT}babylonjs.loaders.min.js`;
    script.integrity = "sha256-KTlYZOQABcVU4ncix1ZswKSvTuRPx9aKdyaRhbsItqY=";
    script.onload = () => {
      if (!B.SceneLoader.IsPluginForExtensionAvailable(".glb")) reject(new Error("Missing Babylon 3.2 glTF plugin"));
      else resolve();
    };
    script.onerror = () => { plugin = undefined; reject(new Error("Cannot load the verified Babylon 3.2 glTF plugin")); };
    document.head.appendChild(script);
  });
  return plugin;
}

export async function loadBlenderAsset(scene: B.Scene, filename: string): Promise<B.AbstractMesh[]> {
  if (!/^[a-z0-9-]+\.glb$/.test(filename)) throw new Error("Invalid Blender asset filename");
  await loadPlugin();
  const result = await B.SceneLoader.ImportMeshAsync(null, BLENDER_ASSET_ROOT, filename, scene);
  const root = result.meshes.find(mesh => !mesh.parent);
  if (root) root.rotationQuaternion = B.Quaternion.Identity();
  for (const mesh of result.meshes) {
    mesh.computeWorldMatrix(true);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
  }
  return result.meshes;
}
