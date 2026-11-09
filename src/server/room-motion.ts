import type { Simulator } from "../core/simulator/simulator.js";
import type { MotionSample } from "../net/protocol.js";
import { snapshotBalls } from "./room-view.js";

export class RoomMotion {
  private samples: MotionSample[] = [];
  private attemptId = "";

  begin(attemptId: string): void {
    this.attemptId = attemptId;
    this.samples = [];
  }

  capture(simulator: Simulator, serverTimeMs: number): void {
    this.samples.push({ serverTimeMs, balls: snapshotBalls(simulator) });
    if (this.samples.length > 8) this.samples.shift();
  }

  sent(): void {
    this.samples = this.samples.slice(-1);
  }

  view(attemptId: string): readonly MotionSample[] {
    return attemptId === this.attemptId ? [...this.samples] : [];
  }
}
