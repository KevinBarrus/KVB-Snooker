import * as B from "babylonjs/es6.js";
import { MeshBody, type CollisionMeshData } from "./core/physics/mesh-body.js";
import { Simulator } from "./core/simulator/simulator.js";
import { DEFAULT_SCENE } from "./core/simulator/scene.js";
import { loadBallLighting } from "./render/materials.js";
import { loadTableScene } from "./render/scene.js";
import { loadTexture } from "./render/assets.js";
import { BallRenderer } from "./render/balls.js";
import { waitForScene } from "./render/ready.js";
import { loadCue } from "./render/cue.js";
import { Gunsight } from "./render/gunsight.js";
import { PlacementMarkers } from "./render/placement.js";
import { BrowserGame } from "./app-game.js";
import { BrowserAudio } from "./app-audio.js";

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

async function main(): Promise<{ engine: B.Engine; scene: B.Scene; simulator: Simulator; balls: BallRenderer; game: BrowserGame; audio: BrowserAudio }> {
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!canvas || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.enableOfflineSupport = false;
  let scene: B.Scene | undefined;
  let disposeGame: (() => void) | undefined;
  let audio: BrowserAudio | undefined;
  try {
    const simulator = await loadSimulator();
    scene = await loadTableScene(engine);
    const [lighting, atlas, mask] = await Promise.all([
      loadBallLighting(scene), loadTexture(scene, "table-ui"), loadTexture(scene, "mask-table")
    ]);
    if (!(scene.activeCamera instanceof B.TargetCamera)) throw new Error("Missing game camera");
    const game = new BrowserGame(simulator, scene, scene.activeCamera, canvas);
    disposeGame = () => game.dispose();
    const balls = new BallRenderer(scene, { getBallCount: () => simulator.getBallCount(), getBallView: index => game.getDisplayBallView(index) },
      DEFAULT_SCENE.ballRadius, 0.88, lighting, atlas, mask);
    const cue = await loadCue(scene, lighting);
    const placement = new PlacementMarkers(scene, atlas, mask);
    const gunsight = new Gunsight(scene, atlas, mask, simulator.ballRadius);
    let lastPrediction: typeof game.human.prediction = null;
    let lastBallOn = -1;
    const options = document.querySelector<HTMLFormElement>(".game-options");
    audio = new BrowserAudio(game.bus, options ?? document.body);
    const newGame = options?.querySelector("button");
    const testTools = options && import.meta.env.DEV && import.meta.env.VITE_RULES_TEST !== "0"
      ? (await import("./devtools/rules-test.js")).mountRulesTest(options, game) : undefined;
    const startGame = (event: Event) => {
      event.preventDefault();
      if (!options) return;
      if (testTools?.start()) return;
      const values = new FormData(options);
      const level = values.get("difficulty");
      game.setMode(values.get("mode") === "single-play" ? "single-play" : "practice",
        level === "EASY" || level === "HARD" ? level : "NORMAL");
    };
    options?.addEventListener("submit", startGame);
    const syncInteraction = () => {
      audio?.sync(game.session, simulator.evolution, game.replay.active);
      testTools?.sync();
      if (game.replay.active) {
        const recorded = game.replay.clip.current?.cue;
        cue.isVisible = recorded?.visible ?? false;
        if (recorded) {
          cue.position.copyFromFloats(recorded.position.x, recorded.position.y, recorded.position.z);
          cue.rotation.copyFromFloats(0, recorded.yaw, recorded.pitch); cue.computeWorldMatrix(true);
        }
        placement.sync(simulator.getCueBallPosition(), { active: false, visible: false, valid: false, spot: simulator.getCueBallPosition() });
        gunsight.alpha = 0;
        if (newGame) newGame.disabled = true;
        status.textContent = "上一杆回放 · Space 播放/暂停 · V 视线 · Esc 返回";
        return;
      }
      const person = game.activePerson;
      cue.isVisible = person.camera.stateRatio > 0 && !game.controls.inHand.active;
      cue.position.copyFrom(person.stick.position);
      cue.rotation.copyFromFloats(0, person.stick.rotation.y, person.stick.rotation.z);
      cue.computeWorldMatrix(true);
      placement.sync(simulator.getCueBallPosition(), game.controls.inHand);
      const prediction = game.human.prediction;
      const ballOn = game.aimBallOn;
      if (prediction && (prediction !== lastPrediction || ballOn !== lastBallOn)) {
        gunsight.syncPrediction(prediction, ballOn);
        lastPrediction = prediction; lastBallOn = ballOn;
      }
      // PCOL L7651-7655, L7670-7681
      gunsight.alpha = prediction && !game.controls.inHand.active ? .6 * game.hud.powerBar.autoAlpha : 0;
      if (newGame) newGame.disabled = game.shots.busy;
      status.textContent = game.session.finished ? `本局结束 · 玩家 ${(game.session.winnerIndex ?? 0) + 1} 获胜 · 可开始新局` : game.session.decision
        ? "请选择下一杆的击球方" : game.controls.inHand.active
        ? "点击 D 区放置母球 · Esc 退出" : !game.human.active
          ? "AI 回合" : game.shots.busy ? "击球进行中" : game.touchingNotice || "你的回合 · W 瞄准 / P 摆球";
    };
    scene.onBeforeRenderObservable.add(syncInteraction);
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
      options?.removeEventListener("submit", startGame);
      testTools?.dispose();
      audio?.dispose();
      game.dispose();
      placement.dispose(); gunsight.dispose();
      cue.material?.dispose(); cue.dispose();
      balls.dispose();
      scene?.dispose(); engine.dispose();
    }, { once: true });
    return { engine, scene, simulator, balls, game, audio };
  } catch (error) {
    audio?.dispose();
    disposeGame?.();
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
