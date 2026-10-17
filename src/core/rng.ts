/**
 * core 层全局随机源（09-扩展规划 §0.1：一切 core 随机必须可播种）。
 * 原作使用 Math.random 的路径（Body.serialize 兜底 UID、AI 误差注入等）统一改为 coreRandom()。
 */
export interface RandomSource {
  /** 返回 [0, 1) */
  next(): number;
}

/** mulberry32：32 位种子、周期 2^32，合成质量满足回放/联机确定性。 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

let activeRandom: RandomSource | null = null;

/** 注入全局随机源（null 回退 Math.random）。 */
export function setCoreRandom(source: RandomSource | null): void {
  activeRandom = source;
}

export function coreRandom(): number {
  return activeRandom ? activeRandom.next() : Math.random();
}
