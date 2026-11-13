import * as B from "babylonjs/es6.js";
import { CINEMA_STYLE } from "./cinema-style.js";
import { buildCinemaRoom } from "./cinema-room.js";

export function buildCinemaEnvironment(scene: B.Scene, roomIntensity: number = CINEMA_STYLE.roomIntensity): void {
  const room = buildCinemaRoom(scene);
  const key = new B.DirectionalLight("cinema-key", new B.Vector3(0.04, -1, 0.08), scene);
  key.intensity = CINEMA_STYLE.keyIntensity;
  key.excludedMeshes = room.meshes;
  const fill = new B.HemisphericLight("cinema-fill", B.Vector3.Up(), scene);
  fill.intensity = CINEMA_STYLE.fillIntensity;
  fill.groundColor.set(0.035, 0.045, 0.035);
  fill.excludedMeshes = room.meshes;
  const ambient = new B.HemisphericLight("cinema-room-light", B.Vector3.Up(), scene);
  ambient.intensity = roomIntensity;
  ambient.groundColor.set(0.05, 0.045, 0.055);
  ambient.includedOnlyMeshes = room.meshes;
  const probe = new B.ReflectionProbe("cinema-reflections", 256, scene, true);
  probe.position.set(0, 0.90625, 0);
  probe.cubeTexture.renderList = room.meshes;
  probe.cubeTexture.gammaSpace = false;
  probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.customRenderTargets.push(probe.cubeTexture);
  scene.environmentTexture = probe.cubeTexture;
  scene.onDisposeObservable.add(() => probe.dispose());
}
