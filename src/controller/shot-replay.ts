import type { BallView, ShotResult } from "../core/simulator/shot-result.js";
import { captureReplayFrame, copyBallView, interpolateReplayFrame, type ReplayCapture, type ReplayFrame } from "./replay-frame.js";

// PCOL L6275, L6311-6336, L6810-7060, L7375-7525
export class ShotReplay {
  private readonly frames: ReplayFrame[] = [];
  private clock = 0;
  private cursor = 0;
  private recording = false;
  private complete = false;
  private sample: ReplayFrame | null = null;
  active = false;
  paused = true;
  rate: 1 | .25 = 1;
  playHead = 0;

  constructor(private readonly maxFrames = 7202) {}

  get duration(): number { return this.frames.at(-1)?.time ?? 0; }
  get available(): boolean { return this.complete && this.duration > .5; }
  get isRecording(): boolean { return this.recording; }
  get current(): Readonly<ReplayFrame> | null { return this.sample; }

  clear(): void {
    this.frames.length = 0; this.clock = this.playHead = this.cursor = 0;
    this.recording = this.complete = this.active = false;
    this.paused = true; this.rate = 1; this.sample = null;
  }

  begin(frame: ReplayCapture): void {
    this.clear(); this.recording = true;
    this.frames.push(captureReplayFrame(0, frame));
  }

  record(dt: number, frame: ReplayCapture, force = false): void {
    if (!this.recording) return;
    if (!Number.isFinite(dt) || dt < 0 || dt > .1 || this.clock + dt > 120) { this.clear(); return; }
    this.clock += dt;
    const last = this.frames.at(-1)!;
    if (!force && this.clock - last.time < 1 / 60 - 1e-8) return;
    if (this.clock === last.time) this.frames[this.frames.length - 1] = captureReplayFrame(this.clock, frame);
    else {
      if (this.frames.length >= this.maxFrames) { this.clear(); return; }
      this.frames.push(captureReplayFrame(this.clock, frame));
    }
  }

  finish(frame: ReplayCapture): void {
    if (!this.recording) return;
    this.record(0, frame, true);
    this.complete = this.recording;
    this.recording = false;
  }

  open(): boolean {
    if (!this.available || this.active) return false;
    this.active = true; this.rate = 1; this.restart();
    return true;
  }

  close(): void { this.active = false; this.paused = true; }
  restart(): void { this.playHead = this.cursor = 0; this.paused = false; this.render(); }
  toggle(): void {
    if (this.playHead >= this.duration) this.restart();
    else this.paused = !this.paused;
  }
  seek(progress: number): void {
    if (!Number.isFinite(progress) || !this.active) return;
    this.playHead = Math.max(0, Math.min(1, progress)) * this.duration;
    this.paused = true; this.render();
  }

  update(dt: number): void {
    if (!this.active) return;
    if (!this.paused && Number.isFinite(dt) && dt > 0) {
      this.playHead = Math.min(this.duration, this.playHead + dt * this.rate);
      if (this.playHead >= this.duration) this.paused = true;
      this.render();
    }
  }

  getBallCount(): number { return this.sample?.balls.length ?? 0; }
  getBallView(index: number): BallView {
    const ball = this.sample?.balls[index];
    if (!ball) throw new Error(`Replay ball unavailable: ${index}`);
    return copyBallView(ball);
  }
  getResult(): Readonly<ShotResult> {
    return { firstKissIndex: this.sample?.firstKissIndex ?? 0, nKissed: 0, pottedIndices: [], outOfBoundsIndices: [] };
  }

  private render(): void {
    if (this.frames.length === 0) return;
    while (this.cursor + 1 < this.frames.length && this.frames[this.cursor + 1].time <= this.playHead) ++this.cursor;
    while (this.cursor > 0 && this.frames[this.cursor].time > this.playHead) --this.cursor;
    const a = this.frames[this.cursor], b = this.frames[Math.min(this.cursor + 1, this.frames.length - 1)];
    this.sample = interpolateReplayFrame(a, b, this.playHead);
  }
}
