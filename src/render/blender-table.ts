import * as B from "babylonjs/es6.js";
import { loadBlenderAsset, BLENDER_ASSET_ROOT } from "./blender-loader.js";
import { buildCinemaEnvironment } from "./cinema-environment.js";
import { createCinemaPipeline } from "./cinema-pipeline.js";
import type { CushionOutline } from "./table-cushions.js";

export function validateBlenderGeometry(value: unknown, outline: CushionOutline): void {
  if (!value || typeof value !== "object" || !("outline" in value) || !Array.isArray(value.outline)
    || !("scale" in value) || value.scale !== 1 || !("bed" in value) || value.bed !== .88) {
    throw new Error("Invalid Blender asset manifest");
  }
  if (value.outline.length !== outline.length || value.outline.some((point: unknown, i: number) => {
    const expected = outline[i];
    return !point || typeof point !== "object" || !("x" in point) || !("z" in point)
      || !("pocket" in point) || point.x !== expected.x || point.z !== expected.z || point.pocket !== expected.pocket;
  })) throw new Error("Blender table geometry is stale; re-export it from the current physical outline");
}

export async function buildBlenderTable(scene: B.Scene, outline: CushionOutline): Promise<void> {
  const response = await fetch(`${BLENDER_ASSET_ROOT}asset.json`);
  if (!response.ok) throw new Error(`Blender manifest: HTTP ${response.status}`);
  validateBlenderGeometry(await response.json(), outline);
  scene.clearColor = new B.Color4(.006, .007, .012, 1);
  createCinemaPipeline(scene);
  const meshes = await loadBlenderAsset(scene, "table.glb");
  for (const mesh of meshes) {
    if (!mesh.getTotalVertices()) continue;
    if (!(mesh.material instanceof B.PBRMaterial)) throw new Error(`Expected glTF PBR material on ${mesh.name}`);
    mesh.material.environmentIntensity = mesh.material.name.includes("Cloth") ? .12 : .65;
    mesh.freezeWorldMatrix();
  }
  buildCinemaEnvironment(scene, .85);
}

export async function loadBlenderCue(scene: B.Scene): Promise<B.Mesh> {
  const imported = await loadBlenderAsset(scene, "cue.glb");
  const parts = imported.filter((mesh): mesh is B.Mesh => mesh instanceof B.Mesh && mesh.getTotalVertices() > 0);
  if (!parts.length) throw new Error("Missing Blender cue geometry");
  for (const part of parts) {
    const indices = part.getIndices();
    if (!indices) throw new Error("Missing Blender cue indices");
    const copy = Array.from(indices);
    if (part.getWorldMatrix().determinant() < 0) {
      for (let i = 0; i < copy.length; i += 3) [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
    }
    part.setIndices(copy);
  }
  const material = new B.MultiMaterial("blender-cue-materials", scene);
  material.subMaterials = parts.map(part => {
    if (!(part.material instanceof B.PBRMaterial)) throw new Error("Expected PBR cue material");
    part.material.environmentIntensity = .7;
    return part.material;
  });
  const mesh = B.Mesh.MergeMeshes(parts, true, true, undefined, true);
  if (!mesh) throw new Error("Cannot assemble Blender cue");
  mesh.name = "StickAlpha";
  mesh.material = material;
  mesh.subMeshes.forEach((submesh, index) => { submesh.materialIndex = index; });
  for (const node of imported) if (!node.isDisposed()) node.dispose();
  mesh.isVisible = false;
  mesh.isPickable = false;
  return mesh;
}
