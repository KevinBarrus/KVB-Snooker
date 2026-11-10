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
import { GameMenu, type MatchLaunchRequest, type PresetShapeId } from "./ui/game-menu.js";
import { GameMenuDom } from "./ui/game-menu-dom.js";
import { makePracticeShapeConfig, type PracticeShapeId } from "./core/practice/shapes.js";
import { toCustomPracticeOptions, toCustomShapeSetup, type CustomShapeRecord } from "./core/practice/custom-shapes.js";
import { MyShapesStore } from "./app-my-shapes.js";
import { ShapeEditor } from "./app-shape-editor.js";
import type { MyShapesPort } from "./ui/my-shapes-panel.js";

const PRACTICE_SHAPE_IDS: Record<PresetShapeId, PracticeShapeId> = {
  snake: "snake",
  "s-shape": "s-shape",
  "t-shape": "t-shape",
  "y-shape": "y-shape",
  staple: "staple",
  "x-shape": "x-shape",
  pyramid: "pyramid",
  "double-dragon": "double-dragon",
  clearance: "clearance",
  "five-spots": "five-spots"
};

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

async function main(): Promise<{ engine: B.Engine; scene: B.Scene; simulator: Simulator; balls: BallRenderer;
  game: BrowserGame; audio: BrowserAudio; editor?: ShapeEditor } | undefined> {
  // 联机开发原型：开发构建且 URL 带 ?net=<roomId> 时直接走联机装配，不同时运行两个渲染循环。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("net")) {
    await import("./app-net.js");
    return undefined;
  }
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
    let editor: ShapeEditor | undefined;
    let customRespotColours = false;
    const myShapes = new MyShapesStore(localStorage);
    const balls = new BallRenderer(scene, { getBallCount: () => simulator.getBallCount(),
      getBallView: index => editor?.active ? editor.getBallView(index) : game.getDisplayBallView(index) },
      DEFAULT_SCENE.ballRadius, 0.88, lighting, atlas, mask, { redDots: () => game.cueBallRedDots });
    const cue = await loadCue(scene, lighting);
    const placement = new PlacementMarkers(scene, atlas, mask);
    const gunsight = new Gunsight(scene, atlas, mask, simulator.ballRadius);
    editor = new ShapeEditor(simulator, scene, scene.activeCamera, canvas, atlas, mask, {
      create: (name, shapeBalls) => {
        const created = myShapes.create(name, shapeBalls);
        if (!created.ok) return;
        closeEditor();
      },
      save: (id, shapeBalls) => { myShapes.saveLayout(id, shapeBalls); closeEditor(); },
      exit: () => closeEditor()
    });
    game.onExitPractice = () => { menuState.triggerInGameAction("exit"); menuDom.sync(); };
    let lastPrediction: typeof game.human.prediction = null;
    let lastBallOn = -1;
    const options = document.querySelector<HTMLFormElement>(".game-options");
    audio = new BrowserAudio(game.bus, options ?? document.body);
    const offAudioUnlock = game.bus.on("sim/shooting-start", () => audio?.unlockNow());
    const menuState = new GameMenu({ onPauseSignal: () => { game.pause.request(); canvas.focus(); } });
    let menuDom: GameMenuDom;
    const launchFromMenu = (req: MatchLaunchRequest) => {
      audio?.unlockNow();
      game.setSuspended(false);
      balls.setHidden(false);
      menuDom.element.hidden = true;
      if (req.mode === "practice" && req.shapeId) {
        const shapeId = PRACTICE_SHAPE_IDS[req.shapeId];
        const config = makePracticeShapeConfig(shapeId, simulator);
        game.setCueBallStyle(req.cueBallStyle ?? "classic");
        game.setMode("practice", "NORMAL", { setup: config.setup, practice: config.practice }, shapeId);
        return;
      }
      if (req.mode === "practice" && req.customShapeId) {
        const record = myShapes.load().active.find(item => item.id === req.customShapeId);
        if (!record) return;
        game.setCueBallStyle(req.cueBallStyle ?? "classic");
        game.setMode("practice", "NORMAL", { setup: toCustomShapeSetup(record, simulator),
          practice: toCustomPracticeOptions(customRespotColours) }, null, record);
        menuState.syncExternalMatch(req);
        menuDom.sync();
        return;
      }
      game.setCueBallStyle("classic");
      game.setMode(req.mode, req.difficulty, req.mode === "single-play"
        ? { ruleset: req.ruleset, ...(req.players ? { players: req.players } : {}) } : {});
    };
    const openEditor = (record: CustomShapeRecord | null): void => {
      if (!editor) return;
      setMenuMode(false);
      game.setSuspended(true);
      balls.setHidden(false);
      menuDom.element.hidden = true;
      game.hudDom.element.hidden = true;
      game.controls.input.enabled = false;
      editor.enter(record);
    };
    const closeEditor = (): void => {
      editor?.close();
      menuDom.element.hidden = false;
      game.hudDom.element.hidden = false;
      game.controls.input.enabled = true;
      menuState.mainMenuOpen = true;
      menuState.activeTab = "practice";
      menuState.practiceSub = "my-shapes";
      setMenuMode(true);
      menuDom.sync();
    };
    const startCustomPractice = (id: string, style: "classic" | "red-dot", respotColoursAfterReds: boolean): void => {
      const record = myShapes.load().active.find(item => item.id === id);
      if (!record) return;
      game.setSuspended(false);
      balls.setHidden(false);
      menuDom.element.hidden = true;
      customRespotColours = respotColoursAfterReds;
      game.setCueBallStyle(style);
      game.setMode("practice", "NORMAL", { setup: toCustomShapeSetup(record, simulator),
        practice: toCustomPracticeOptions(respotColoursAfterReds) }, null, record);
      menuState.syncExternalMatch({ kind: "practice", mode: "practice", difficulty: "NORMAL", ruleset: "classic",
        customShapeId: id, cueBallStyle: style });
      menuDom.sync();
    };
    const myShapesPort: MyShapesPort = {
      snapshot: () => myShapes.load(),
      create: () => openEditor(null),
      edit: id => { const record = myShapes.load().active.find(item => item.id === id); if (record) openEditor(record); },
      start: startCustomPractice,
      rename: (id, name) => myShapes.rename(id, name),
      remove: id => { myShapes.remove(id); menuDom.sync(); },
      restore: id => myShapes.restore(id),
      purge: id => { myShapes.purge(id); menuDom.sync(); }
    };
    menuDom = new GameMenuDom(menuState, launchFromMenu, document, myShapesPort);
    document.body.append(menuDom.element);
    let menuMode = false;
    const setMenuMode = (active: boolean): void => {
      if (menuMode === active) return;
      menuMode = active;
      game.setSuspended(active);
      balls.setHidden(active);
      if (!active) { menuDom.element.hidden = true; return; }
      menuDom.element.hidden = false;
      const camera = scene?.activeCamera;
      if (camera instanceof B.TargetCamera) {
        camera.position.set(-2.93, 1.7, 1.06);
        camera.lockedTarget = new B.Vector3(0, .88, 0);
      }
    };
    setMenuMode(true);
    const newGame = options?.querySelector("button");
    const testTools = options && import.meta.env.DEV && import.meta.env.VITE_RULES_TEST !== "0"
      ? (await import("./devtools/rules-test.js")).mountRulesTest(options, game) : undefined;
    const startGame = (event: Event) => {
      event.preventDefault();
      if (!options) return;
      if (testTools?.start()) {
        setMenuMode(false);
        menuState.syncExternalMatch({ kind: "two-player", mode: "single-play", difficulty: "NORMAL", ruleset: game.session.ruleset, players: ["USER", "USER"] });
        menuDom.sync();
        return;
      }
      const values = new FormData(options);
      const level = values.get("difficulty");
      const difficulty = level === "EASY" || level === "HARD" ? level : "NORMAL";
      const mode = values.get("mode") === "single-play" ? "single-play" : "practice";
      const ruleset = values.get("rules") === "snooker-900" ? "snooker-900" : "classic";
      audio?.unlockNow();
      game.setSuspended(false);
      balls.setHidden(false);
      menuDom.element.hidden = true;
      if (game.setMode(mode, difficulty, mode === "single-play" ? { ruleset } : {})) {
        menuState.syncExternalMatch({ kind: mode === "single-play" ? "ai" : "practice", mode, difficulty, ruleset });
        menuDom.sync();
      }
    };
    options?.addEventListener("submit", startGame);
    const syncInteraction = () => {
      if (editor?.active) {
        audio?.sync(game.session, simulator.evolution, false);
        menuDom.element.hidden = true;
        game.hudDom.element.hidden = true;
        cue.isVisible = false;
        gunsight.alpha = 0;
        placement.sync(simulator.getCueBallPosition(), { active: false, visible: false, valid: false, spot: simulator.getCueBallPosition() });
        status.textContent = "编辑球形 · 左键放置 · 右键回收 · A/D 环绕";
        return;
      }
      if (menuState.mainMenuOpen) {
        menuDom.element.hidden = false;
        game.hudDom.element.hidden = true;
        cue.isVisible = false;
        gunsight.alpha = 0;
        placement.sync(simulator.getCueBallPosition(), { active: false, visible: false, valid: false, spot: simulator.getCueBallPosition() });
        status.textContent = "";
        return;
      }
      audio?.sync(game.session, simulator.evolution, game.replay.active);
      audio?.syncReplay({
        active: game.replay.active,
        playHead: game.replay.playHead,
        paused: game.replay.paused,
        rate: game.replay.rate,
        revision: game.replay.audioRevision,
        events: game.replay.audioEvents
      });
      testTools?.sync();
      menuDom.element.hidden = game.replay.active;
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
        ? game.session.clock ? "移动母球预览 · 点击或 Enter 确认 · 摆球计时继续" : "点击 D 区放置母球 · Esc 退出" : !game.human.active
          ? "AI 回合" : game.shots.busy ? "击球进行中" : game.touchingNotice || "你的回合 · W 瞄准 / P 摆球";
    };
    scene.onBeforeRenderObservable.add(syncInteraction);
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      if (editor?.active) {
        editor.update(dt);
        balls.sync();
        scene?.render();
        return;
      }
      setMenuMode(menuState.mainMenuOpen);
      if (menuMode) {
        balls.sync();
        scene?.render();
        return;
      }
      game.update(dt);
      balls.sync();
      scene?.render();
    });
    status.textContent = "KVB-Snooker";
    document.body.dataset.state = "ready";
    window.addEventListener("pagehide", () => {
      window.removeEventListener("resize", resize);
      options?.removeEventListener("submit", startGame);
      offAudioUnlock();
      menuDom.dispose();
      testTools?.dispose();
      audio?.dispose();
      editor?.dispose();
      game.dispose();
      placement.dispose(); gunsight.dispose();
      cue.material?.dispose(); cue.dispose();
      balls.dispose();
      scene?.dispose(); engine.dispose();
    }, { once: true });
    return { engine, scene, simulator, balls, game, audio, editor };
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
