import * as B from "babylonjs/es6.js";
import { MeshBody, type CollisionMeshData } from "./core/physics/mesh-body.js";
import { Simulator } from "./core/simulator/simulator.js";
import { DEFAULT_SCENE } from "./core/simulator/scene.js";
import { loadBallLighting } from "./render/materials.js";
import { loadTableScene } from "./render/scene.js";
import { loadTexture } from "./render/assets.js";
import { BallRenderer } from "./render/balls.js";
import { waitForScene } from "./render/ready.js";
import { BrowserGame } from "./app-game.js";

async function loadSimulator(): Promise<Simulator> {
  const response = await fetch("/assets/physics/table.json");
  if (!response.ok) throw new Error(`Physics table: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== "04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9") {
    throw new Error("Physics table digest mismatch");
  }
  const mesh = new MeshBody(JSON.parse(new TextDecoder().decode(bytes)) as CollisionMeshData);
  mesh.id = "tiger-club-sno-rgb";
  return new Simulator(mesh);
}

async function main(): Promise<{ engine: B.Engine; scene: B.Scene; simulator: Simulator; balls: BallRenderer; game: BrowserGame }> {
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!canvas || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.enableOfflineSupport = false;
  let scene: B.Scene | undefined;
  try {
    const simulator = await loadSimulator();
    scene = await loadTableScene(engine);
    const [lighting, atlas, mask] = await Promise.all([
      loadBallLighting(scene), loadTexture(scene, "table-ui"), loadTexture(scene, "mask-table")
    ]);
    const balls = new BallRenderer(scene, simulator, DEFAULT_SCENE.ballRadius, 0.88, lighting, atlas, mask);
    if (!(scene.activeCamera instanceof B.TargetCamera)) throw new Error("Missing game camera");
    const game = new BrowserGame(simulator, scene, scene.activeCamera, canvas);
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => {
      game.update(engine.getDeltaTime() / 1000);
      balls.sync();
      scene?.render();
    });
    status.textContent = "KVB-Snooker";
    document.body.dataset.state = "ready";
    window.addEventListener("pagehide", () => {
      window.removeEventListener("resize", resize);
      game.dispose();
      balls.dispose();
      scene?.dispose(); engine.dispose();
    }, { once: true });
    return { engine, scene, simulator, balls, game };
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
