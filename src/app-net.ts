/**
 * 联机开发原型浏览器装配根（仅开发入口 `?net=<roomId>` 动态加载）。
 * 职责：连接/席位、场景与球渲染、本地席位 PersonController、真实输入路径、开发 HUD。
 * 权威物理只在服务器：本文件不推进 Simulator，不产生本地结算/声音；本地 Simulator 仅用于从检查点 predict。
 */
import * as B from "babylonjs/es6.js";
import { MeshBody, type CollisionMeshData } from "./core/physics/mesh-body.js";
import { Simulator } from "./core/simulator/simulator.js";
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
import type { PlacementCommands } from "./controller/in-hand.js";
import { NetClient } from "./app-net-client.js";
import { NetShotLauncher } from "./app-net-shot.js";
import { NetSessionState, type ShotTimingRecord } from "./net/net-session-state.js";
import { RemoteView } from "./net/remote-view.js";
import {
  DEFAULT_DEV_TOKEN,
  DEFAULT_NET_PORT,
  isSeatIndex,
  type ContextView,
  type LatencyConfig,
  type RoomPhase,
  type SeatIndex,
  type ServerMessage,
  type SnapshotMessage
} from "./net/protocol.js";

interface NetLaunchConfig {
  readonly roomId: string;
  readonly server: string;
  readonly token: string;
  readonly requestedSeat?: SeatIndex;
}

interface DisplaySource extends Pick<Simulator, "getBallCount" | "getBallView" | "getCueBallPosition" | "getResult" | "predict"> {}

interface NetSnapshotView {
  readonly seat: SeatIndex | null;
  readonly roomId: string | null;
  readonly version: number;
  readonly phase: RoomPhase;
  readonly context: ContextView;
  readonly balls: readonly { index: number; number: number; active: boolean; x: number; y: number; z: number }[];
}

/** 只读测试句柄；生产构建不加载本文件，因此不可用。 */
export interface NetTestHandle {
  readonly ready: Promise<void>;
  snapshot(): NetSnapshotView | null;
  timing(): ShotTimingRecord;
  readonly latency: LatencyConfig;
  readonly lastError: string | null;
  readonly lastRejectReason: string | null;
  readonly connectionState: string;
  readonly seat: SeatIndex | null;
  readonly cameraState: 0 | 1;
  readonly cameraPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly cameraTarget: { readonly x: number; readonly y: number; readonly z: number };
  readonly shotsBusy: boolean;
  /** 本地席位是否可发起击球（稳定阶段 + 本地球权 + 无未完成意图）。 */
  readonly turn: boolean;
  /** 本地出杆前置条件：瞄准镜头到位且球杆可出杆（供验收定位问题）。 */
  readonly readyToStroke: boolean;
  /** 最近约 0.5 秒的渲染帧率，用于区分网络卡顿与渲染帧率不足。 */
  readonly fps: number;
}

declare global {
  interface Window { __snkNet?: NetTestHandle }
}

const ZERO_LATENCY: LatencyConfig = { enabled: false, inboundMs: 0, outboundMs: 0, jitterMs: 0, appliesTo: "one-way-per-direction" };
const NO_PLACEMENT: PlacementCommands = {
  ray: () => ({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } }),
  valid: () => false,
  place: () => false,
  begin: () => false,
  focus: () => null,
  end: () => false
};
const DIGEST = "04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9";

function parseConfig(): NetLaunchConfig | null {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("net")?.trim();
  if (!roomId) return null;
  const rawServer = params.get("server")?.trim();
  const server = !rawServer ? `ws://${location.hostname}:${DEFAULT_NET_PORT}/net`
    : /^wss?:\/\//i.test(rawServer) ? rawServer
      : `ws://${/:\d+/.test(rawServer) ? rawServer : `${rawServer}:${DEFAULT_NET_PORT}`}/net`;
  const token = params.get("token")?.trim() || DEFAULT_DEV_TOKEN;
  const seatParam = params.get("seat");
  const requestedSeat = seatParam !== null && isSeatIndex(Number(seatParam)) ? Number(seatParam) as SeatIndex : undefined;
  return { roomId, server, token, ...(requestedSeat === undefined ? {} : { requestedSeat }) };
}

async function loadSimulator(): Promise<Simulator> {
  const response = await fetch("/assets/physics/table.json");
  if (!response.ok) throw new Error(`Physics table: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== DIGEST) throw new Error("Physics table digest mismatch");
  const mesh = new MeshBody(JSON.parse(new TextDecoder().decode(bytes)) as CollisionMeshData);
  mesh.id = "tiger-club-sno-rgb";
  return new Simulator(mesh);
}

function createDisplaySource(remote: RemoteView, simulator: Simulator): DisplaySource {
  return {
    getBallCount: () => remote.getBallCount(),
    getBallView: index => remote.getBallView(index),
    getCueBallPosition: () => remote.getCueBallPosition(),
    getResult: () => remote.getResult(),
    // 只读预测：从权威检查点恢复本地模拟器后计算，不推进、不写回服务端。
    predict: (vars, maxDist) => {
      const checkpoint = remote.getCheckpoint();
      if (checkpoint) simulator.restore(checkpoint);
      return simulator.predict(vars, maxDist);
    }
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

class NetHud {
  readonly element = document.createElement("pre");
  private lastSync = -Infinity;
  constructor() { this.element.className = "net-hud"; }
  sync(nowMs: number, session: NetSessionState, lastError: string | null, fps: number): void {
    if (nowMs - this.lastSync < 100) return;
    this.lastSync = nowMs;
    const t = session.timing();
    const latency = session.latencyConfig ?? ZERO_LATENCY;
    const delta = (from: number | null, to: number | null) =>
      from === null || to === null ? "—" : `${Math.round(to - from)}ms`;
    const jitter = latency.jitterMs > 0 ? ` ±${latency.jitterMs}` : "";
    const context = session.context;
    const score = context ? `${context.scores[0]} : ${context.scores[1]}` : "—";
    const lines = [
      `${session.connectionState} · ${session.roomId ?? "—"} · 席位 ${session.seat ?? "—"} · v${session.version} · ${session.phase} · ${Math.round(fps)}fps`,
      `比分 ${score} · 目标球 ${context?.ballOn ?? "—"} · 手中球 ${context?.inHand ?? "—"} · ${session.isLocalTurn() ? "本机球权" : "等待对手"}`,
      `RTT ${session.rttMs === null ? "—" : `${Math.round(session.rttMs)}ms`} · 单程延迟 ${latency.inboundMs}/${latency.outboundMs}ms${jitter}`,
      `Space→命令 ${delta(t.spaceAtMs, t.commandSentAtMs)} · →Ack ${delta(t.spaceAtMs, t.ackAtMs)} · →投影触球 ${delta(t.spaceAtMs, t.projectedTouchAtMs)} · 动画-投影 ${delta(t.projectedTouchAtMs, t.animationTouchAtMs)} · 首运动-投影 ${delta(t.projectedTouchAtMs, t.firstMotionSnapshotAtMs)} · fired-投影 ${delta(t.projectedTouchAtMs, t.firedEventAtMs)} · 重试 ${t.retries}`
    ];
    if (lastError) lines.push(lastError);
    if (session.lastRejectReason) lines.push(`拒绝原因 ${session.lastRejectReason}`);
    this.element.textContent = lines.join("\n");
  }
}

async function main(): Promise<void> {
  const config = parseConfig();
  if (!config) throw new Error("联机入口需要 ?net=<roomId>");
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("output");
  if (!(canvas instanceof HTMLCanvasElement) || !status) throw new Error("Missing render host");
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true });
  engine.enableOfflineSupport = false;
  const session = new NetSessionState();
  const remote = new RemoteView({ interpolationDelayMs: 100 });
  const hud = new NetHud();
  let client: NetClient | null = null;
  let person: PersonController | null = null;
  let launcher: NetShotLauncher | null = null;
  let resolveReady: () => void = () => {};
  let resolveSnapshot: (snapshot: SnapshotMessage) => void = () => {};
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const firstSnapshot = new Promise<SnapshotMessage>(resolve => { resolveSnapshot = resolve; });
  let snapshotSeen = false;
  let fpsValue = 0;
  let scene: B.Scene | undefined;

  const handleMessage = (message: ServerMessage): void => {
    const nowMs = performance.now();
    switch (message.type) {
      case "welcome": session.onWelcome(message, nowMs); remote.setClockOffset(session.clockOffsetMs); break;
      case "snapshot":
        session.onSnapshot(message, nowMs);
        remote.setClockOffset(session.clockOffsetMs);
        remote.pushSnapshot(message, nowMs);
        if (!snapshotSeen) { snapshotSeen = true; resolveSnapshot(message); }
        break;
      case "event": session.onEvent(message, nowMs); remote.setClockOffset(session.clockOffsetMs); break;
      case "ack": session.onAck(message, nowMs); break;
      case "pong": session.onPong(message, nowMs); remote.setClockOffset(session.clockOffsetMs); break;
      case "error": session.onServerError(message, nowMs); break;
    }
  };

  const testHandle: NetTestHandle = {
    ready,
    snapshot: () => {
      const snapshot = session.latestSnapshot;
      if (!snapshot) return null;
      return {
        seat: session.seat, roomId: session.roomId, version: snapshot.version, phase: snapshot.phase,
        context: snapshot.context,
        balls: snapshot.balls.map(ball => ({ index: ball.index, number: ball.number, active: ball.active, x: ball.x, y: ball.y, z: ball.z }))
      };
    },
    timing: () => session.timing(),
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
    get fps() { return fpsValue; }
  };
  window.__snkNet = testHandle;

  session.beginConnect(performance.now());
  client = new NetClient({
    url: config.server, roomId: config.roomId, devToken: config.token,
    ...(config.requestedSeat === undefined ? {} : { requestedSeat: config.requestedSeat }),
    onMessage: handleMessage,
    retrySource: nowMs => session.pollRetry(nowMs)
  });
  client.connect();

  try {
    const [simulator, loadedScene] = await Promise.all([
      loadSimulator(),
      loadTableScene(engine),
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
    const gunsight = new Gunsight(scene, atlas, mask, simulator.ballRadius);
    const viewNotice = new ViewNotice();
    const viewNoticeDom = new ViewNoticeDom(document, () => canvas.focus());
    // 犯规/选择阶段的最简 decide-turn：只有拥有选择权的本地席位看到两个按钮。
    const decision = document.createElement("div");
    decision.className = "net-decision";
    decision.hidden = true;
    const sendDecision = (takeOver: boolean): void => {
      if (!session.canDecide()) return;
      const commandId = typeof crypto.randomUUID === "function"
        ? `d-${crypto.randomUUID()}`
        : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      client?.sendCommand({ type: "command", commandId, expectedVersion: session.version,
        action: { type: "decide-turn", takeOver } });
      decision.hidden = true;
    };
    const ownButton = document.createElement("button");
    ownButton.type = "button"; ownButton.textContent = "自己接手";
    ownButton.addEventListener("click", () => { sendDecision(true); canvas.focus(); });
    const otherButton = document.createElement("button");
    otherButton.type = "button"; otherButton.textContent = "让对手继续";
    otherButton.addEventListener("click", () => { sendDecision(false); canvas.focus(); });
    decision.append(ownButton, otherButton);
    document.body.append(hud.element, viewNoticeDom.element, decision);
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
        return session.canLaunch() ? GAME_STATE.READY : GAME_STATE.SIMULATING;
      },
      canAim: () => session.canLaunch() && !shotLauncher.busy && remote.getBallView(0).active,
      canPlace: () => false,
      cycleView
    }, NO_PLACEMENT);
    await waitForScene(scene);
    scene.render();
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    let lastPrediction: PredictionContext | null = null;
    let lastBallOn = -1;
    let lastStatus = "";
    let wasLocalTurn = false;
    let previousFrameAtMs = performance.now();
    let fpsFrames = 0;
    let fpsWindowStart = previousFrameAtMs;
    engine.runRenderLoop(() => {
      const nowMs = performance.now();
      // 出杆动画按真实经过时间对齐投影触球时刻；engine.getDeltaTime() 是性能监视器的瞬时帧时，
      // 低帧率或卡顿下与真实间隔偏差明显，不能用于时序测量。
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
      personController.active = session.canLaunch();
      // 球位只由权威快照更新；轮到本机时把瞄准锚点重新对准当前母球，避免用上一杆的位置出杆。
      if (personController.active && !wasLocalTurn) personController.reanchorCueBall();
      wasLocalTurn = personController.active;
      shotLauncher.update(rawDt, nowMs);
      personController.update(dt);
      if (session.canLaunch() && personController.camera.state === 1) personController.updatePrediction();
      camera.position.copyFrom(personController.camera.position);
      camera.lockedTarget = personController.camera.target;
      cue.isVisible = personController.camera.stateRatio > 0;
      cue.position.copyFrom(personController.stick.position);
      cue.rotation.copyFromFloats(0, personController.stick.rotation.y, personController.stick.rotation.z);
      cue.computeWorldMatrix(true);
      const prediction = personController.prediction;
      const ballOn = session.context?.ballOn ?? 0;
      if (prediction && (prediction !== lastPrediction || ballOn !== lastBallOn)) {
        gunsight.syncPrediction(prediction, ballOn);
        lastPrediction = prediction; lastBallOn = ballOn;
      }
      // 与本地装配一致：瞄准线只在相机基本趴下后才淡入，并在后拉时淡出（PCOL L7651-7655）。
      const aimRatio = (1 - (shotLauncher.busy ? shotLauncher.motion.pullbackProgress : 0)) * personController.camera.renderedRatio;
      const aimAlpha = personController.active && aimRatio > 0.8 ? (aimRatio - 0.8) / 0.2 : 0;
      gunsight.alpha = prediction && personController.camera.state === 1 ? 0.6 * aimAlpha : 0;
      controls.update();
      viewNotice.update(dt);
      viewNoticeDom.sync(viewNotice);
      decision.hidden = !session.canDecide();
      balls.sync();
      hud.sync(nowMs, session, session.lastError ?? client?.lastError ?? null, fpsValue);
      const nextStatus = session.connectionState !== "ready" ? session.connectionState
        : session.isLocalTurn() ? (shotLauncher.busy ? "击球中" : "本机回合 · W 瞄准 / Space 出杆") : "对手回合 · 自由观察";
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
      decision.remove();
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
