/**
 * 联机开发原型 ping 时钟同步：offset = serverTime - (clientTime + rtt/2)，取最近样本中位数。
 * 纯状态，零 DOM、零定时器；时间由调用方显式传入。
 * 页面加载或主线程卡顿时 pong 会迟到，产生巨大 RTT 样本；估计优先采用低 RTT 样本的中位数，
 * 避免一次进度条卡顿把服务器时刻投影偏出数百毫秒。
 */
const DEFAULT_CAPACITY = 9;
const MAX_ACCEPTABLE_RTT_MS = 2_000;
const MIN_OUTLIER_WINDOW_MS = 25;

interface ClockSample {
  readonly rttMs: number;
  readonly offsetMs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class PingClock {
  private readonly samples: ClockSample[] = [];
  private offsetValue: number | null = null;
  private rttValue: number | null = null;

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  get offsetMs(): number | null { return this.offsetValue; }
  get rttMs(): number | null { return this.rttValue; }
  get sampleCount(): number { return this.samples.length; }

  /** welcome 到达时先用单程近似播种，后续 pong 中位数修正。 */
  seed(serverTimeMs: number, localTimeMs: number): void {
    if (this.offsetValue !== null || !Number.isFinite(serverTimeMs) || !Number.isFinite(localTimeMs)) return;
    this.offsetValue = serverTimeMs - localTimeMs;
  }

  /** 返回 false 表示样本非法（时钟回拨、负 RTT 或超出合理范围），不污染估计。 */
  add(serverTimeMs: number, clientTimeMs: number, localNowMs: number): boolean {
    const rtt = localNowMs - clientTimeMs;
    const offset = serverTimeMs - (clientTimeMs + rtt / 2);
    if (!Number.isFinite(rtt) || !Number.isFinite(offset) || rtt < 0 || rtt > MAX_ACCEPTABLE_RTT_MS) return false;
    this.samples.push({ rttMs: rtt, offsetMs: offset });
    while (this.samples.length > this.capacity) this.samples.shift();
    this.recompute();
    return true;
  }

  /** 把服务器时刻投影到本地时钟。 */
  project(serverTimeMs: number): number {
    return this.offsetValue === null ? serverTimeMs : serverTimeMs - this.offsetValue;
  }

  private recompute(): void {
    if (this.samples.length === 0) return;
    const minimumRtt = Math.min(...this.samples.map(sample => sample.rttMs));
    const window = Math.max(MIN_OUTLIER_WINDOW_MS, minimumRtt * 4 + 10);
    const trusted = this.samples.filter(sample => sample.rttMs <= window);
    this.offsetValue = median(trusted.map(sample => sample.offsetMs));
    this.rttValue = median(this.samples.map(sample => sample.rttMs));
  }
}
