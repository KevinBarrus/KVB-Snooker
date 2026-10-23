import * as B from "babylonjs/es6.js";
import { BallMaterial, loadBallLighting } from "./render/materials.js";
import { loadTableScene } from "./render/scene.js";
import { loadTexture } from "./render/assets.js";
import { BallShadows } from "./render/shadows.js";
import { waitForScene } from "./render/ready.js";

async function main(): Promise<{ engine: B.Engine; scene: B.Scene }> {
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!canvas || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.enableOfflineSupport = false;
  let scene: B.Scene | undefined;
  try {
    scene = await loadTableScene(engine);
    const [lighting, atlas, mask] = await Promise.all([
      loadBallLighting(scene), loadTexture(scene, "table-ui"), loadTexture(scene, "mask-table")
    ]);
    const shadows = new BallShadows(scene, 8, 0.02625, atlas, mask);
    for (let number = 0; number < 8; ++number) {
      const ball = B.MeshBuilder.CreateSphere(`ball-${number}`, { segments: number === 0 ? 32 : 20, diameter: 0.0525 }, scene);
      ball.position.set(-0.7 + number * 0.2, 0.90625, 0);
      ball.material = new BallMaterial(scene, number, lighting);
      shadows.setBall(number, ball.position.x, ball.position.z, true);
    }
    shadows.flush();
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => scene?.render());
    status.textContent = "球台与八种球色验证";
    document.body.dataset.state = "ready";
    window.addEventListener("pagehide", () => {
      window.removeEventListener("resize", resize);
      scene?.dispose(); engine.dispose();
    }, { once: true });
    return { engine, scene };
  } catch (error) {
    scene?.dispose(); engine.dispose();
    throw error;
  }
}

export const runtime = main();
void runtime.catch((error: unknown) => {
  document.body.dataset.state = "error";
  const status = document.querySelector("output");
  if (status) status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
