import "./multiplayer.css";
import { NetLobbyPanel } from "./app-net-lobby.js";
import { NetPresentation } from "./app-net-presentation.js";
import { NetRules } from "./app-net-rules.js";
import { PlacementMarkers } from "./render/placement.js";
import { loadSimulator, createDisplaySource, withTimeout } from "./app-net-scene.js";
import { NetPausePanel } from "./app-net-pause.js";
import * as B from "babylonjs/es6.js";
import { tableJawShift } from "./core/physics/table-geometry.js";
import type { Simulator } from "./core/simulator/simulator.js";
import { DEFAULT_SCENE } from "./core/simulator/scene.js";
import type { PredictionContext } from "./core/simulator/shot-result.js";
import { EventBus } from "./core/event-bus.js";
import { GAME_STATE } from "./core/game.js";
import { loadBallLighting } from "./render/materials.js";
import { loadTableScene } from "./render/scene.js";
import { loadTexture } from "./render/assets.js";
import { BallRenderer } from "./render/balls.js";
import { waitForScene } from "./render/ready.js";
import { loadCue } from "./render/cue.js";
import { Gunsight } from "./render/gunsight.js";
import { PersonController } from "./controller/person-controller.js";
import { GamingInput } from "./controller/gaming-input.js";
import { isShotViewMode } from "./controller/shot-view.js";
import { ViewNotice, ViewNoticeDom } from "./ui/view-notice.js";
import { NetHud, parseConfig } from "./app-net-support.js";
import { NetClient } from "./app-net-client.js";
import { NetMatchPanel } from "./app-net-match.js";
import type { NetTestHandle } from "./app-net-types.js";
import { RemoteCue } from "./app-net-remote-cue.js";
import { NetShotLauncher } from "./app-net-shot.js";
import { NetSessionState } from "./net/net-session-state.js";
import { CuePosePublisher } from "./net/cue-pose.js";
import { RemoteView } from "./net/remote-view.js";
import { NetDiagnostics } from "./app-net-diagnostics.js";
import {
  type LatencyConfig,
  type ServerMessage,
  type SnapshotMessage
} from "./net/protocol.js";

const ZERO_LATENCY: LatencyConfig = { enabled: false, inboundMs: 0, outboundMs: 0, jitterMs: 0, appliesTo: "one-way-per-direction" };
async function main(): Promise<void> {
  const config = parseConfig(location.search);
  if (!config) throw new Error("联机入口需要有效房间码");
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!(canvas instanceof HTMLCanvasElement) || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.enableOfflineSupport = false;
  const session = new NetSessionState();
  const remote = new RemoteView({ interpolationDelayMs: config.interpolationDelayMs });
  const posePublisher = new CuePosePublisher();
  const remoteCue = new RemoteCue(DEFAULT_SCENE.ballRadius);
  let remoteMesh: B.Mesh | null = null;
  const diagnostics = new NetDiagnostics(config.interpolationDelayMs);
  const hud = new NetHud(() => { diagnostics.download(session.seat); canvas.focus(); });
  let client: NetClient | null = null;
  const matchPanel = new NetMatchPanel(session, command => client?.sendCommand(command) ?? false, () => canvas.focus());
  const pausePanel = new NetPausePanel(session, command => client?.sendCommand(command) ?? false, () => canvas.focus());
  let presentation: NetPresentation | null = null;
  let rules: NetRules | null = null;
  let lobby: NetLobbyPanel | null = null;
  let person: PersonController | null = null;
  let launcher: NetShotLauncher | null = null;
  let resolveReady: () => void = () => {};
  let resolveSnapshot: (snapshot: SnapshotMessage) => void = () => {};
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const firstSnapshot = new Promise<SnapshotMessage>(resolve => { resolveSnapshot = resolve; });
  let snapshotSeen = false;
  let fpsValue = 0;
  let turnReady = false;
  let scene: B.Scene | undefined;
  let snapWindowStart = performance.now();
  let snapWindowCount = 0;
  let snapMaxGapMs = 0;
  let lastSnapshotArrivalMs = 0;
  let snapshotsPerSecond = 0;
  const handleMessage = (message: ServerMessage): void => {
    const nowMs = performance.now();
    let accepted = true;
    switch (message.type) {
      case "lobby": session.onLobby(message.lobby); break;
      case "welcome": session.onWelcome(message, nowMs); remote.setClockOffset(session.clockOffsetMs); break;
      case "snapshot": {
        session.onSnapshot(message, nowMs);
        remote.setClockOffset(session.clockOffsetMs);
        accepted = remote.pushSnapshot(message, nowMs);
        if (!snapshotSeen) { snapshotSeen = true; resolveSnapshot(message); }
        if (lastSnapshotArrivalMs > 0) snapMaxGapMs = Math.max(snapMaxGapMs, nowMs - lastSnapshotArrivalMs);
        lastSnapshotArrivalMs = nowMs;
        snapWindowCount++;
        if (nowMs - snapWindowStart >= 1000) {
          snapshotsPerSecond = snapWindowCount * 1000 / (nowMs - snapWindowStart);
          snapWindowStart = nowMs;
          snapWindowCount = 0;
          snapMaxGapMs = 0;
        }
        break;
      }
      case "event": accepted = session.onEvent(message, nowMs); remote.setClockOffset(session.clockOffsetMs); if (accepted && message.event.type === "frame-started") launcher?.finish(); break;
      case "ack": session.onAck(message, nowMs); break;
      case "pong": session.onPong(message, nowMs); remote.setClockOffset(session.clockOffsetMs); break;
      case "error": session.onServerError(message, nowMs); break;
    }
    const cueBall = session.latestSnapshot?.balls[0];
    if (accepted) presentation?.receive(message);
    rules?.receive(message);
    matchPanel.receive(message);
    pausePanel.receive(message);
    if (accepted && cueBall) remoteCue.receive(message, session.seat, cueBall, nowMs);
    diagnostics.message(message, nowMs, session.clockOffsetMs, accepted);
  };
  const testHandle: NetTestHandle = {
    ready,
    snapshot: () => {
      const snapshot = session.latestSnapshot;
      if (!snapshot) return null;
      return {
        seat: session.seat, roomId: session.roomId, version: snapshot.version, phase: snapshot.phase,
        context: snapshot.context, match: snapshot.match,
        balls: snapshot.balls.map(ball => ({ index: ball.index, number: ball.number, active: ball.active, x: ball.x, y: ball.y, z: ball.z }))
      };
    },
    timing: () => session.timing(),
    diagnostics: () => diagnostics.report(),
    get latency() { return session.latencyConfig ?? ZERO_LATENCY; },
    get lastError() { return session.lastError ?? client?.lastError ?? null; },
    get lastRejectReason() { return session.lastRejectReason; },
    get connectionState() { return session.connectionState === "ready" ? "ready" : client?.connectionState ?? session.connectionState; },
    get seat() { return session.seat; },
    get cameraState() { return person?.camera.state ?? 0; },
    get cameraPosition() { const p = person?.camera.position; return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 }; },
    get cameraTarget() { const t = person?.camera.target; return t ? { x: t.x, y: t.y, z: t.z } : { x: 0, y: 0, z: 0 }; },
    get shotsBusy() { return launcher?.busy ?? false; },
    get turn() { return session.canLaunch(); },
    get readyToStroke() { return person?.isReadyToStroke() ?? false; },
    get fps() { return fpsValue; },
    get netStats() {
      return {
        snapshotsPerSecond,
        maxGapMs: snapMaxGapMs,
        marginMs: remote.interpolationStats.marginMs
      };
    },
    get turnReady() { return turnReady; },
    get contactErrorMm() { return launcher?.contactErrorMm ?? null; },
    get localCueVisual() {
      const p = person?.stick.position;
      return { visible: (person?.camera.stateRatio ?? 0) > 0,
        yaw: person?.stick.rotation.y ?? 0, pitch: person?.stick.rotation.z ?? 0,
        position: { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 } };
    },
    get remoteCueVisual() {
      const p = remoteCue.position;
      return { visible: remoteMesh?.isVisible ?? false, struck: remoteCue.struck,
        leadingSpace: remoteCue.motion.length, yaw: remoteCue.rotation.y, pitch: remoteCue.rotation.z, position: { x: p.x, y: p.y, z: p.z } };
    },
    get shotVisual() {
      return { cuePosition: remote.getCueBallPosition(), leadingSpace: person?.stick.leadingSpace ?? 0,
        struck: launcher?.isStruck ?? false, displayServerMs: remote.interpolationStats.targetServerMs };
    }
  };
  if (import.meta.env.DEV) window.__snkNet = testHandle;

  session.beginConnect(performance.now());
  client = new NetClient({
    url: config.server, roomId: config.roomId, devToken: config.token,
    ...(config.requestedSeat === undefined ? {} : { requestedSeat: config.requestedSeat }),
    onMessage: handleMessage,
    onStateChange: state => { if (state === "closed" || state === "error") session.onClose(); },
    retrySource: nowMs => session.pollRetry(nowMs)
  });
  client.connect();

  try {
    const [simulator, loadedScene] = await Promise.all([
      loadSimulator(),
      loadTableScene(engine, tableJawShift()),
      withTimeout(firstSnapshot, 15_000, "等待服务器快照")
    ]);
    scene = loadedScene;
    const [lighting, atlas, mask] = await Promise.all([
      loadBallLighting(scene), loadTexture(scene, "table-ui"), loadTexture(scene, "mask-table")
    ]);
    if (!(scene.activeCamera instanceof B.TargetCamera)) throw new Error("Missing game camera");
    const camera = scene.activeCamera;
    const seat = session.seat;
    if (seat === null) throw new Error("服务器未分配开发席位");
    remote.setClockOffset(session.clockOffsetMs);
    remote.update(performance.now());
    const view = createDisplaySource(remote, simulator);
    const personController = new PersonController(view, new EventBus(), simulator.ballRadius, seat, true);
    person = personController;
    const shotLauncher = new NetShotLauncher({
      session, send: command => { client?.sendCommand(command); }, now: () => performance.now()
    });
    launcher = shotLauncher;
    const balls = new BallRenderer(scene, view, simulator.ballRadius, 0.88, lighting, atlas, mask);
    const cue = await loadCue(scene, lighting);
    const opponentCue = cue.clone("remote-cue");
    remoteMesh = opponentCue;
    opponentCue.isVisible = false;
    const gunsight = new Gunsight(scene, atlas, mask, simulator.ballRadius);
    const viewNotice = new ViewNotice();
    const viewNoticeDom = new ViewNoticeDom(document, () => canvas.focus());
    const ruleControls = new NetRules(session, simulator, personController, command => client?.sendCommand(command) ?? false,
      (x, y) => {
        const rect = canvas.getBoundingClientRect();
        const ray = scene!.createPickingRay((x - rect.left) * engine.getRenderWidth() / rect.width,
          (y - rect.top) * engine.getRenderHeight() / rect.height, B.Matrix.Identity(), camera);
        return { origin: ray.origin, direction: ray.direction };
      }, text => { viewNotice.show(text); viewNoticeDom.sync(viewNotice); }, () => canvas.focus());
    rules = ruleControls;
    presentation = new NetPresentation(session, personController, shotLauncher, canvas);
    lobby = new NetLobbyPanel(session, ready => client?.sendReady(ready) ?? false);
    const placement = new PlacementMarkers(scene, atlas, mask);
    hud.element.hidden = new URLSearchParams(location.search).get("debug") !== "1";
    document.body.append(hud.element, viewNoticeDom.element, matchPanel.element);
    const cycleView = (): void => {
      if (!session.isLocalTurn() && !shotLauncher.busy) return;
      const shotView = personController.camera.shotView;
      const mode = shotView.mode === "natural" ? "cue" : shotView.mode === "cue" ? "object" : "natural";
      shotView.setMode(mode, personController.camera.target);
      viewNotice.show({ natural: "自然起身", cue: "视线跟随母球", object: "视线跟随子球" }[mode]);
      viewNoticeDom.sync(viewNotice);
      try { localStorage.setItem("snk.shot-view", mode); } catch { /* 存储不可用时只影响偏好 */ }
    };
    try {
      const stored = localStorage.getItem("snk.shot-view");
      if (isShotViewMode(stored)) personController.camera.shotView.mode = stored;
    } catch { /* 存储不可用时沿用默认观察模式 */ }
    const controls = new GamingInput(canvas, personController, shotLauncher, {
      state: () => {
        if (session.connectionState !== "ready") return 0;
        return session.canLaunch() && turnReady ? GAME_STATE.READY : GAME_STATE.SIMULATING;
      },
      canAim: () => !ruleControls.commands.busy && session.canLaunch() && turnReady && !shotLauncher.busy && remote.getBallView(0).active,
      canPlace: () => turnReady && !shotLauncher.busy && ruleControls.canPlace,
      cycleView,
      locked: () => session.paused || ruleControls.commands.busy
    }, ruleControls.placement);
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    let lastPrediction: PredictionContext | null = null;
    let lastBallOn = -1;
    let lastStatus = "";
    let wasCanLaunch = false;
    let displayAttempt: string | null = null;
    let turnResetPending = false;
    let cueAnchor = "";
    let previousFrameAtMs = performance.now();
    let fpsFrames = 0;
    let fpsWindowStart = previousFrameAtMs;
    engine.runRenderLoop(() => {
      const nowMs = performance.now();
      const rawDt = (nowMs - previousFrameAtMs) / 1000;
      previousFrameAtMs = nowMs;
      const dt = Math.min(rawDt, 0.25);
      fpsFrames++;
      if (nowMs - fpsWindowStart >= 500) {
        fpsValue = fpsFrames * 1000 / (nowMs - fpsWindowStart);
        fpsFrames = 0;
        fpsWindowStart = nowMs;
      }
      remote.setClockOffset(session.clockOffsetMs);
      remote.update(nowMs);
      personController.camera.shotView.smoothing.aspect = scene!.getEngine().getAspectRatio(camera);
      personController.camera.shotView.smoothing.verticalFov = camera.fov;
      pausePanel.sync(nowMs); lobby?.sync();
      ruleControls.update(nowMs);
      controls.update();
      const canLaunch = session.paused ? wasCanLaunch : session.canLaunch();
      const attempt = session.latestSnapshot?.match.attemptId ?? null;
      if (canLaunch && (!wasCanLaunch || attempt !== displayAttempt)) turnResetPending = true;
      displayAttempt = attempt;
      if (!shotLauncher.busy && (session.phase === "between-frames" || session.phase === "finished")) personController.gotoState0();
      if (!canLaunch) { turnReady = false; turnResetPending = false; }
      wasCanLaunch = canLaunch;
      shotLauncher.update(nowMs, remote.interpolationStats.targetServerMs);
      if (turnResetPending && !shotLauncher.busy && remote.interpolationStats.marginMs <= 0) {
        personController.activate();
        turnResetPending = false;
        turnReady = true;
        if (ruleControls.canPlace) controls.inHand.enter();
      }
      const cueState = session.latestSnapshot?.balls[0];
      const anchor = cueState ? `${cueState.x}:${cueState.y}:${cueState.z}` : "";
      if (turnReady && session.phase === "ready" && !shotLauncher.busy && !session.pendingServerShot &&
          remote.interpolationStats.marginMs <= 0 && anchor !== cueAnchor) {
        personController.reanchorCueBall(); cueAnchor = anchor;
      }
      personController.active = turnReady;
      if (!session.paused) personController.update(dt);
      if (!session.paused && turnReady && personController.camera.state === 1) personController.updatePrediction();
      camera.position.copyFrom(personController.camera.position);
      camera.lockedTarget = personController.camera.target;
      cue.isVisible = personController.camera.stateRatio > 0;
      cue.position.copyFrom(personController.stick.position);
      cue.rotation.copyFromFloats(0, personController.stick.rotation.y, personController.stick.rotation.z);
      cue.computeWorldMatrix(true);
      const poseMessage = posePublisher.update(nowMs, session.version, turnReady && session.canLaunch() && !shotLauncher.busy,
        cue.isVisible ? { x: cue.position.x, y: cue.position.y, z: cue.position.z,
          yaw: cue.rotation.y, pitch: cue.rotation.z } : null);
      if (poseMessage) client?.sendCuePose(poseMessage);
      if (session.connectionState !== "ready") remoteCue.clear();
      remoteCue.update(remote.interpolationStats.targetServerMs, remote.getCueBallPosition(), nowMs);
      opponentCue.isVisible = remoteCue.visible;
      opponentCue.position.copyFrom(remoteCue.position);
      opponentCue.rotation.copyFrom(remoteCue.rotation);
      opponentCue.computeWorldMatrix(true);
      const prediction = personController.prediction;
      const ballOn = session.context?.ballOn ?? 0;
      if (prediction && (prediction !== lastPrediction || ballOn !== lastBallOn)) {
        gunsight.syncPrediction(prediction, ballOn);
        lastPrediction = prediction; lastBallOn = ballOn;
      }
      // PCOL L7651-7655
      const aimRatio = (1 - (shotLauncher.busy ? shotLauncher.motion.pullbackProgress : 0)) * personController.camera.renderedRatio;
      const aimAlpha = personController.active && aimRatio > 0.8 ? (aimRatio - 0.8) / 0.2 : 0;
      gunsight.alpha = prediction && personController.camera.state === 1 ? 0.6 * aimAlpha : 0;
      controls.update();
      viewNotice.update(dt);
      viewNoticeDom.sync(viewNotice);
      placement.sync(remote.getCueBallPosition(), controls.inHand);
      presentation?.update(dt, remote.interpolationStats.targetServerMs, controls.inHand.active);
      matchPanel.sync(nowMs, shotLauncher.busy);
      balls.sync();
      diagnostics.capture(nowMs, rawDt * 1000, session, remote, personController.camera);
      hud.sync(nowMs, session, session.lastError ?? client?.lastError ?? null, fpsValue, {
        snapshotsPerSecond,
        maxGapMs: snapMaxGapMs,
        marginMs: remote.interpolationStats.marginMs,
        contactErrorMm: shotLauncher.contactErrorMm,
        turnReady
      });
      const nextStatus = session.connectionState !== "ready" ? session.connectionState
         : session.lobby?.phase === "waiting" ? "等待双方准备"
        : session.phase === "between-frames" ? "本局结束 · 等待双方准备下一局"
        : session.phase === "finished" ? "整场结束"
        : session.isLocalTurn() ? (shotLauncher.busy ? "击球中" : turnReady ? "本机回合 · W 瞄准 / Space 出杆" : "球位同步中") : "对手回合 · 自由观察";
      if (nextStatus !== lastStatus) { lastStatus = nextStatus; status.textContent = nextStatus; }
      scene!.render();
    });
    document.body.dataset.state = "ready";
    resolveReady();
    window.addEventListener("pagehide", () => {
      window.removeEventListener("resize", resize);
      client?.dispose();
      controls.dispose();
      hud.element.remove();
      viewNoticeDom.element.remove();
      ruleControls.dispose(); placement.dispose(); presentation?.dispose(); lobby?.dispose();
      matchPanel.element.remove();
      pausePanel.dispose();
      opponentCue.dispose();
      cue.material?.dispose(); cue.dispose();
      gunsight.dispose();
      balls.dispose();
      scene?.dispose(); engine.dispose();
      delete window.__snkNet;
    }, { once: true });
  } catch (error) {
    client?.dispose();
    scene?.dispose(); engine.dispose();
    delete window.__snkNet;
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
