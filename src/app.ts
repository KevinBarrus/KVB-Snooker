import * as B from "babylonjs/es6.js";
import { BallMaterial, loadBallLighting, loadCarpetMaterial } from "./render/materials.js";
import { waitForScene } from "./render/ready.js";

async function main(): Promise<void> {
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!canvas || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  const scene = new B.Scene(engine);
  try {
    const camera = new B.TargetCamera("camera", new B.Vector3(-0.6, 1.3, 0.8), scene);
    camera.setTarget(new B.Vector3(0, 0.88, 0));
    camera.minZ = 0.01;
    camera.fov = 0.88;
    const light = new B.SpotLight("GameLight", new B.Vector3(0, 3.6, 0), new B.Vector3(0, -1, 0), 175 / 180 * Math.PI, 2, scene);
    light.intensity = 60;
    const [lighting, carpet] = await Promise.all([loadBallLighting(scene), loadCarpetMaterial(scene, light)]);
    const cloth = B.MeshBuilder.CreateGround("cloth", { width: 0.8, height: 0.8 }, scene);
    cloth.position.y = 0.88;
    cloth.material = carpet;
    light.includedOnlyMeshes = [cloth];
    const ball = B.MeshBuilder.CreateSphere("ball", { segments: 32, diameter: 0.0525 }, scene);
    ball.position.set(0, 0.90625, 0);
    ball.material = new BallMaterial(scene, 0, lighting);
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => scene.render());
    status.textContent = "单球与台呢材质验证";
    document.body.dataset.state = "ready";
    window.addEventListener("pagehide", () => {
      window.removeEventListener("resize", resize);
      scene.dispose(); engine.dispose();
    }, { once: true });
  } catch (error) {
    scene.dispose(); engine.dispose();
    throw error;
  }
}

void main().catch((error: unknown) => {
  document.body.dataset.state = "error";
  const status = document.querySelector("output");
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
