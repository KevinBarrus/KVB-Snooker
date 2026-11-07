import type { ServerMessage, SnapshotBall, RoomPhase } from "./net/protocol.js";
import type { RemoteView } from "./net/remote-view.js";
import type { NetSessionState } from "./net/net-session-state.js";

interface FrameSample {
  readonly nowMs: number;
  readonly dtMs: number;
  readonly phase: RoomPhase;
  readonly displayServerMs: number;
  readonly latestServerMs: number;
  readonly clockOffsetMs: number | null;
  readonly rttMs: number | null;
  readonly visible: boolean;
  readonly balls: readonly number[];
  readonly camera?: readonly number[];
}

interface PacketSample {
  readonly nowMs: number;
  readonly serverTimeMs: number;
  readonly version: number;
  readonly phase: RoomPhase;
  readonly clockOffsetMs: number | null;
  readonly accepted: boolean;
  readonly balls: readonly SnapshotBall[];
}

interface PongSample {
  readonly nowMs: number;
  readonly rttMs: number;
  readonly sampleOffsetMs: number;
  readonly selectedOffsetMs: number | null;
}

function distribution(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (ratio: number) => sorted[Math.ceil((sorted.length - 1) * ratio)];
  return { min: sorted[0], p50: percentile(0.5), p95: percentile(0.95),
    p99: percentile(0.99), max: sorted[sorted.length - 1] };
}

export class NetDiagnostics {
  private shotId: string | null = null;
  private frames: FrameSample[] = [];
  private packets: PacketSample[] = [];
  private pongs: PongSample[] = [];
  private recentPongs: PongSample[] = [];
  private endAtMs = Infinity;
  private truncated = false;

  constructor(private readonly interpolationDelayMs: number) {}

  get recording(): boolean { return this.shotId !== null && this.endAtMs !== -Infinity; }

  message(message: ServerMessage, nowMs: number, clockOffsetMs: number | null, accepted = true): void {
    if (message.type === "pong") {
      const sample = { nowMs, rttMs: nowMs - message.clientTimeMs,
        sampleOffsetMs: message.serverTimeMs - (message.clientTimeMs + nowMs) / 2,
        selectedOffsetMs: clockOffsetMs };
      this.recentPongs.push(sample);
      if (this.recentPongs.length > 12) this.recentPongs.shift();
      if (this.recording && this.pongs.length < 240) this.pongs.push(sample);
      return;
    }
    if (message.type !== "snapshot") return;
    const shotId = message.pendingShot?.shotId;
    if (accepted && shotId && shotId !== this.shotId) {
      this.shotId = shotId;
      this.frames = [];
      this.packets = [];
      this.pongs = [...this.recentPongs];
      this.endAtMs = Infinity;
      this.truncated = false;
    }
    if (!this.recording) return;
    if (this.packets.length < 4000) this.packets.push({ nowMs, serverTimeMs: message.serverTimeMs,
      version: message.version, phase: message.phase, clockOffsetMs, accepted,
      balls: message.balls.map(ball => ({ ...ball })) });
    else this.truncated = true;
    if (accepted && !message.pendingShot && message.phase !== "simulating" && this.endAtMs === Infinity) {
      this.endAtMs = nowMs + this.interpolationDelayMs + 250;
    }
  }

  frame(sample: FrameSample): void {
    if (!this.recording) return;
    if (sample.nowMs > this.endAtMs) { this.endAtMs = -Infinity; return; }
    if (this.frames.length >= 12000) { this.truncated = true; return; }
    this.frames.push({ ...sample, balls: [...sample.balls], camera: sample.camera ? [...sample.camera] : undefined });
  }

  capture(nowMs: number, dtMs: number, session: NetSessionState, remote: RemoteView,
    camera: { readonly position: { x: number; y: number; z: number }; readonly target: { x: number; y: number; z: number } }): void {
    if (!this.recording) return;
    const balls: number[] = [];
    for (let index = 0; index < remote.getBallCount(); index++) {
      const ball = remote.getBallView(index);
      balls.push(ball.active ? 1 : 0, ball.renderPosition.x, ball.renderPosition.y, ball.renderPosition.z);
    }
    const stats = remote.interpolationStats;
    this.frame({ nowMs, dtMs, phase: remote.phase, displayServerMs: stats.targetServerMs,
      latestServerMs: stats.latestServerMs, clockOffsetMs: session.clockOffsetMs,
      rttMs: session.rttMs, visible: document.visibilityState === "visible", balls,
      camera: [camera.position.x, camera.position.y, camera.position.z, camera.target.x, camera.target.y, camera.target.z] });
  }

  report() {
    const packets = this.packets.filter(packet => packet.accepted && packet.phase === "simulating");
    const start = packets[0]?.serverTimeMs ?? Infinity;
    const end = packets[packets.length - 1]?.serverTimeMs ?? -Infinity;
    const frames = this.frames.filter(frame => frame.phase === "simulating" &&
      frame.displayServerMs >= start && frame.displayServerMs < end);
    let repeatedFrames = 0;
    for (let index = 1; index < frames.length; index++) {
      const before = frames[index - 1].balls;
      const after = frames[index].balls;
      if (before.length === after.length && before.every((value, i) => value === after[i])) repeatedFrames++;
    }
    const margins = frames.map(frame => frame.latestServerMs - frame.displayServerMs);
    return {
      format: 1, shotId: this.shotId, interpolationDelayMs: this.interpolationDelayMs,
      truncated: this.truncated, recording: this.recording,
      summary: {
        motionFrames: frames.length, motionPackets: packets.length,
        frameIntervalMs: distribution(frames.map(frame => frame.dtMs)),
        framesOver50Ms: frames.filter(frame => frame.dtMs > 50).length,
        hiddenFrames: frames.filter(frame => !frame.visible).length,
        bufferEmptyFrames: margins.filter(margin => margin <= 0).length,
        repeatedFrames, marginMs: distribution(margins),
        arrivalGapMs: distribution(packets.slice(1).map((packet, i) => packet.nowMs - packets[i].nowMs)),
        serverGapMs: distribution(packets.slice(1).map((packet, i) => packet.serverTimeMs - packets[i].serverTimeMs)),
        estimatedAgeAtArrivalMs: distribution(packets.flatMap(packet => packet.clockOffsetMs === null
          ? [] : [packet.nowMs + packet.clockOffsetMs - packet.serverTimeMs])),
        rejectedPackets: this.packets.filter(packet => !packet.accepted).length
      },
      pongs: this.pongs.map(sample => ({ ...sample })),
      packets: this.packets.map(sample => ({ ...sample, balls: sample.balls.map(ball => ({ ...ball })) })),
      frames: this.frames.map(sample => ({ ...sample, balls: [...sample.balls], camera: sample.camera ? [...sample.camera] : undefined }))
    };
  }

  download(seat: number | null): void {
    const report = this.report();
    const blob = new Blob([JSON.stringify({ ...report, seat, userAgent: navigator.userAgent })],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `snk-net-seat-${seat ?? "unknown"}-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
