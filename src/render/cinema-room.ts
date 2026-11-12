import * as B from "babylonjs/es6.js";
import { CINEMA_STYLE } from "./cinema-style.js";

export interface CinemaRoom { readonly meshes: B.Mesh[]; readonly panels: B.Mesh[] }

export function buildCinemaRoom(scene: B.Scene): CinemaRoom {
  const meshes: B.Mesh[] = [];
  const panels: B.Mesh[] = [];
  const material = (name: string, color: string): B.StandardMaterial => {
    const result = new B.StandardMaterial(`cinema-${name}`, scene);
    result.diffuseColor = B.Color3.FromHexString(color);
    result.specularColor.set(0.025, 0.025, 0.025);
    return result;
  };
  const board = material("board", CINEMA_STYLE.boards);
  const wall = material("wall", CINEMA_STYLE.wall);
  const floor = material("floor", CINEMA_STYLE.floor);
  const seat = material("seat", CINEMA_STYLE.seats);
  const metal = material("structure", "#16171b");
  const tier = material("tier", "#24232a");
  const light = material("softbox", "#ffffff");
  light.disableLighting = true;
  light.emissiveColor.set(2.8, 2.7, 2.5);
  const box = (name: string, size: [number, number, number], position: [number, number, number], mat: B.Material): B.Mesh => {
    const mesh = B.MeshBuilder.CreateBox(`cinema-${name}`, { width: size[0], height: size[1], depth: size[2] }, scene);
    mesh.position.copyFromFloats(...position);
    mesh.material = mat;
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };
  box("floor", [22, 0.12, 19], [0, -0.065, 0], floor);
  const labelTexture = new B.DynamicTexture("cinema-brand", { width: 1024, height: 256 }, scene, true);
  const context = labelTexture.getContext();
  context.fillStyle = CINEMA_STYLE.boards;
  context.fillRect(0, 0, 1024, 256);
  context.strokeStyle = "#294181";
  context.lineWidth = 3;
  context.strokeRect(20, 20, 984, 216);
  context.font = "500 68px sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#edf0f5";
  context.fillText("KVB SNOOKER", 512, 153);
  labelTexture.update();
  const label = material("brand", "#ffffff");
  label.diffuseTexture = labelTexture;
  label.emissiveColor.set(0.07, 0.07, 0.07);
  for (const side of [-1, 1]) {
    box("long-board", [11.8, 0.95, 0.16], [0, 0.475, side * 3.75], board);
    box("end-board", [0.16, 0.95, 7.5], [side * 5.9, 0.475, 0], board);
    box("long-wall", [19, 3.2, 0.18], [0, 4.7, side * 8.3], wall);
    box("end-wall", [0.18, 3.2, 16.6], [side * 9.5, 4.7, 0], wall);
    for (let i = -2; i <= 2; ++i) {
      const sign = B.MeshBuilder.CreatePlane("cinema-brand-long", { width: 2.1, height: 0.525 }, scene);
      sign.position.set(i * 2.3, 0.57, side * 3.66);
      sign.rotation.y = side < 0 ? Math.PI : 0;
      sign.material = label; sign.isPickable = false; meshes.push(sign);
    }
    for (let i = -1; i <= 1; ++i) {
      const sign = B.MeshBuilder.CreatePlane("cinema-brand-end", { width: 2.1, height: 0.525 }, scene);
      sign.position.set(side * 5.81, 0.57, i * 2.3);
      sign.rotation.y = side * Math.PI / 2;
      sign.material = label; sign.isPickable = false; meshes.push(sign);
    }
    for (let row = 0; row < 5; ++row) {
      const y = 0.2 + row * 0.39;
      const z = side * (4.35 + row * 0.76);
      box("long-tier", [13.5, 0.38, 0.77], [0, y - 0.08, z], tier);
      for (let column = -10; column <= 10; ++column) {
        if (Math.abs(column) === 6) continue;
        const x = column * 0.58;
        box("seat-base", [0.46, 0.12, 0.43], [x, y + 0.31, z], seat);
        const back = box("seat-back", [0.46, 0.57, 0.13], [x, y + 0.58, z + side * 0.22], seat);
        back.rotation.x = side * 0.1;
      }
      const x = side * (6.5 + row * 0.61);
      box("end-tier", [0.62, 0.38, 7.8], [x, y - 0.08, 0], tier);
      for (let column = -5; column <= 5; ++column) {
        if (column === 0) continue;
        const zSeat = column * 0.62;
        box("seat-base", [0.43, 0.12, 0.46], [x, y + 0.31, zSeat], seat);
        box("seat-back", [0.13, 0.57, 0.46], [x + side * 0.22, y + 0.58, zSeat], seat);
      }
    }
  }
  box("lighting-frame", [3.8, 0.12, 1.65], [0, 3.65, 0], metal);
  for (const z of [-0.49, 0, 0.49]) panels.push(box("light-panel", [3.35, 0.015, 0.24], [0, 3.58, z], light));
  for (const x of [-1.5, 1.5]) box("light-suspension", [0.016, 2.3, 0.016], [x, 4.82, 0], metal);
  const grouped = new Map<B.Material, B.Mesh[]>();
  for (const mesh of meshes) {
    if (panels.includes(mesh) || !mesh.material) continue;
    const group = grouped.get(mesh.material) ?? [];
    group.push(mesh); grouped.set(mesh.material, group);
  }
  const merged: B.Mesh[] = [...panels];
  for (const [mat, group] of grouped) {
    const mesh = B.Mesh.MergeMeshes(group, true, true);
    if (!mesh) throw new Error("Failed to assemble cinema room");
    mesh.name = `${mat.name}-geometry`; mesh.isPickable = false; mesh.freezeWorldMatrix();
    merged.push(mesh);
  }
  return { meshes: merged, panels };
}
