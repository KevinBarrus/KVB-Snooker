import { NetSessionState } from "./net/net-session-state.js";
import { DEFAULT_DEV_TOKEN, DEFAULT_NET_PORT, isSeatIndex,
  type LatencyConfig, type SeatIndex } from "./net/protocol.js";

const ZERO_LATENCY: LatencyConfig = { enabled: false, inboundMs: 0, outboundMs: 0,
  jitterMs: 0, appliesTo: "one-way-per-direction" };

interface NetLaunchConfig {
  readonly roomId: string;
  readonly server: string;
  readonly token: string;
  readonly requestedSeat?: SeatIndex;
  readonly interpolationDelayMs: number;
}

export function parseConfig(search: string): NetLaunchConfig | null {
  const params = new URLSearchParams(search);
  const roomId = params.get("net")?.trim();
  if (!roomId) return null;
  const rawServer = params.get("server")?.trim();
  const server = !rawServer ? `ws://${location.hostname}:${DEFAULT_NET_PORT}/net`
    : /^wss?:\/\//i.test(rawServer) ? rawServer
      : `ws://${/:\d+/.test(rawServer) ? rawServer : `${rawServer}:${DEFAULT_NET_PORT}`}/net`;
  const token = params.get("token")?.trim() || DEFAULT_DEV_TOKEN;
  const seatParam = params.get("seat");
  const requestedSeat = seatParam !== null && isSeatIndex(Number(seatParam)) ? Number(seatParam) as SeatIndex : undefined;
  const interpParam = params.has("interp") ? Number(params.get("interp")) : 100;
  const interpolationDelayMs = Number.isFinite(interpParam) && interpParam >= 0 && interpParam <= 500 ? interpParam : 100;
  return { roomId, server, token, interpolationDelayMs, ...(requestedSeat === undefined ? {} : { requestedSeat }) };
}

export class NetHud {
  readonly element = document.createElement("pre");
  private readonly text = document.createTextNode("");
  private readonly downloadButton = document.createElement("button");
  private lastSync = -Infinity;
  constructor(download: () => void) {
    this.element.className = "net-hud";
    this.downloadButton.type = "button";
    this.downloadButton.style.pointerEvents = "auto";
    this.downloadButton.textContent = "导出本杆诊断";
    this.downloadButton.addEventListener("click", download);
    this.element.append(this.text, this.downloadButton);
  }
  sync(nowMs: number, session: NetSessionState, lastError: string | null, fps: number,
    stats: { readonly snapshotsPerSecond: number; readonly maxGapMs: number; readonly marginMs: number;
      readonly contactErrorMm: number | null; readonly turnReady: boolean }): void {
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
      (session.phase === "simulating"
        ? `快照 ${stats.snapshotsPerSecond.toFixed(1)}/s · 最大到达间隔 ${Math.round(stats.maxGapMs)}ms · 插值余量 ${Math.round(stats.marginMs)}ms`
        : "台面静止 · 插值余量不适用") +
        ` · 触点偏差 ${stats.contactErrorMm === null ? "—" : `${stats.contactErrorMm}mm`} · ${stats.turnReady ? "回合就绪" : "回合重置中"}`,
      `Space→命令 ${delta(t.spaceAtMs, t.commandSentAtMs)} · →Ack ${delta(t.spaceAtMs, t.ackAtMs)} · →投影触球 ${delta(t.spaceAtMs, t.projectedTouchAtMs)} · 显示触球-投影 ${delta(t.projectedTouchAtMs, t.animationTouchAtMs)} · 首运动包-投影 ${delta(t.projectedTouchAtMs, t.firstMotionSnapshotAtMs)} · fired-投影 ${delta(t.projectedTouchAtMs, t.firedEventAtMs)} · 重试 ${t.retries}`
    ];
    if (lastError) lines.push(lastError);
    if (session.lastRejectReason) lines.push(`拒绝原因 ${session.lastRejectReason}`);
    this.downloadButton.disabled = session.pendingServerShot !== null || session.phase === "simulating";
    this.text.data = lines.join("\n") + "\n";
  }
}
