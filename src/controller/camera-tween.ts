// PCOL L498-531, L624-681
export const easeInOut = (value: number): number => value < 0.5 ? 2 * value * value : 4 * value - 2 * value * value - 1;

export class CameraTween {
  time = 0;
  timeScale = 1;
  state = 0;
  needsUpdate = false;
  ratio = 0;
  renderedRatio = 0;
  private renderedTime = 0;

  constructor(readonly duration: number, private readonly ease: (value: number) => number = easeInOut) {}

  play(time?: number): void {
    let changed = false;
    if (time !== undefined) {
      time = Math.max(0, Math.min(time, this.duration));
      changed = this.time !== time;
      this.time = time;
    }
    if (changed || this.time < this.duration) { this.state = 1; this.needsUpdate = true; }
    else this.state = 0;
  }

  reverse(): void {
    this.state = this.time > 0 ? -1 : 0;
    if (this.state) this.needsUpdate = true;
  }

  pause(time: number): void {
    if (this.state === 0 && time !== this.time) this.needsUpdate = true;
    this.state = 0;
    this.time = time;
  }

  update(dt: number): boolean {
    this.needsUpdate = false;
    const speed = this.state * this.timeScale;
    let time = this.time + dt * speed;
    if (speed > 0 && time >= this.duration - 1e-6) { time = this.duration; this.state = 0; }
    else if (speed < 0 && time <= 1e-6) { time = 0; this.state = 0; }
    else if (speed !== 0) this.needsUpdate = true;
    this.time = time;
    if (time < 1e-6) time = 0;
    if (this.renderedTime !== time) {
      this.renderedTime = time;
      this.ratio = time / this.duration;
      this.renderedRatio = this.ease(this.ratio);
    }
    return this.needsUpdate;
  }
}
