const CORRECTION_WINDOW_MS = 200;
const MAX_RATE_ADJUSTMENT = 0.2;

export class PlaybackClock {
  private cursorMs: number | null = null;
  private previousNowMs = 0;

  get active(): boolean { return this.cursorMs !== null; }

  reset(): void {
    this.cursorMs = null;
    this.previousNowMs = 0;
  }

  update(nowMs: number, serverTimeMs: number, receivedAtMs: number, delayMs: number, limitMs: number): number {
    const desired = serverTimeMs + Math.max(0, nowMs - receivedAtMs) - delayMs;
    if (delayMs === 0) this.cursorMs = Math.max(this.cursorMs ?? -Infinity, Math.min(desired, limitMs));
    else if (this.cursorMs === null) this.cursorMs = Math.min(desired, limitMs);
    else {
      const elapsed = Math.max(0, nowMs - this.previousNowMs);
      const expected = this.cursorMs + elapsed;
      const correction = Math.max(-MAX_RATE_ADJUSTMENT,
        Math.min(MAX_RATE_ADJUSTMENT, (desired - expected) / CORRECTION_WINDOW_MS));
      this.cursorMs = Math.max(this.cursorMs, Math.min(limitMs, expected + elapsed * correction));
    }
    this.previousNowMs = Math.max(this.previousNowMs, nowMs);
    return this.cursorMs;
  }
}
