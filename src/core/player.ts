// PCOL L9973-10025
export class Player {
  pts = 0;
  penalty = 0;
  shootingCount = 0;
  scoreCount = 0;
  private currentBreak = 0;
  private maxBreak = 0;

  constructor(readonly type: "USER" | "AI") {}

  get brk(): number { return this.currentBreak; }
  set brk(value: number) {
    this.currentBreak = value;
    if (this.maxBreak < value) this.maxBreak = value;
  }
  get maxbrk(): number { return this.maxBreak; }
  get accuracy(): number { return this.shootingCount === 0 ? 0 : this.scoreCount / this.shootingCount; }

  clearScores(): void {
    this.pts = this.penalty = this.shootingCount = this.scoreCount = this.currentBreak = this.maxBreak = 0;
  }
}
