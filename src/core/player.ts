// PCOL L9973-10025
export interface PlayerSnapshot {
  readonly pts: number;
  readonly penalty: number;
  readonly shootingCount: number;
  readonly scoreCount: number;
  readonly currentBreak: number;
  readonly maxBreak: number;
}

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

  snapshot(): PlayerSnapshot {
    return { pts: this.pts, penalty: this.penalty, shootingCount: this.shootingCount,
      scoreCount: this.scoreCount, currentBreak: this.currentBreak, maxBreak: this.maxBreak };
  }

  /** 练习复位用：完整回滚比分/连击/杆数统计；正式比赛不使用本路径。 */
  restore(snapshot: PlayerSnapshot): void {
    this.pts = snapshot.pts;
    this.penalty = snapshot.penalty;
    this.shootingCount = snapshot.shootingCount;
    this.scoreCount = snapshot.scoreCount;
    this.currentBreak = snapshot.currentBreak;
    this.maxBreak = snapshot.maxBreak;
  }
}
