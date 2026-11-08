import type { CuePose, CuePoseMessage, CuePoseState } from "./protocol.js";

export class CuePosePublisher {
  private sequence = 0;
  private version = -1;
  private sentAt = -Infinity;
  private last: CuePose | null = null;

  update(nowMs: number, version: number, enabled: boolean, pose: CuePose | null): CuePoseMessage | null {
    if (!enabled) return null;
    const transition = version !== this.version || (pose === null) !== (this.last === null);
    if (!transition && nowMs - this.sentAt < 100) return null;
    const changed = pose && this.last ? Object.keys(pose).some(key =>
      Math.abs(pose[key as keyof CuePose] - this.last![key as keyof CuePose]) > 1e-6) : pose !== this.last;
    if (!transition && !changed && nowMs - this.sentAt < 1000) return null;
    this.last = pose ? { ...pose } : null;
    this.version = version;
    this.sentAt = nowMs;
    return { type: "cue-pose", expectedVersion: version, sequence: ++this.sequence, pose: this.last };
  }
}

export function lerpAngle(from: number, to: number, ratio: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * ratio;
}

export class CuePoseBuffer {
  private sequence = -1;
  private version = -1;
  private receivedAt = 0;
  private from: CuePose | null = null;
  private target: CuePose | null = null;

  clear(): void { this.from = null; this.target = null; }

  advanceVersion(version: number): void {
    if (version > this.version) { this.clear(); this.version = version; }
  }

  push(message: CuePoseState, nowMs: number): void {
    if (message.sequence <= this.sequence || message.version < this.version) return;
    this.advanceVersion(message.version);
    this.from = this.sample(nowMs) ?? message.pose;
    this.target = message.pose;
    this.receivedAt = nowMs;
    this.sequence = message.sequence;
  }

  sample(nowMs: number): CuePose | null {
    if (!this.target || !this.from) return null;
    const ratio = Math.max(0, Math.min(1, (nowMs - this.receivedAt) / 100));
    const from = this.from, to = this.target;
    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio,
      z: from.z + (to.z - from.z) * ratio, yaw: lerpAngle(from.yaw, to.yaw, ratio),
      pitch: from.pitch + (to.pitch - from.pitch) * ratio };
  }
}
