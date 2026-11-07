import type { LatencyConfig } from "../net/protocol.js";
import { serverNowMs } from "./clock.js";

export interface DevLatencyOptions {
  readonly inboundMs: number;
  readonly outboundMs: number;
  readonly jitterMs: number;
  readonly dropNextAck: boolean;
  readonly random?: () => number;
}

/**
 * 仅开发环境的延迟/故障注入（原型设计 §6）。
 * 配置值是单程延迟：入站与出站各自生效，往返约为 inbound + outbound + 处理时间。
 * 用 setTimeout 排队投递，不 sleep、不阻塞物理主循环；延迟消息保留原始接收时刻。
 */
export class DevLatency {
  private readonly inboundMs: number;
  private readonly outboundMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private dropAckArmed: boolean;

  constructor(options: DevLatencyOptions) {
    for (const value of [options.inboundMs, options.outboundMs, options.jitterMs]) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid latency value: ${value}`);
    }
    this.inboundMs = options.inboundMs;
    this.outboundMs = options.outboundMs;
    this.jitterMs = options.jitterMs;
    this.random = options.random ?? Math.random;
    this.dropAckArmed = options.dropNextAck;
  }

  get dropNextAckPending(): boolean { return this.dropAckArmed; }
  get pendingTimerCount(): number { return this.timers.size; }

  get config(): LatencyConfig {
    return {
      enabled: this.inboundMs > 0 || this.outboundMs > 0 || this.jitterMs > 0,
      inboundMs: this.inboundMs,
      outboundMs: this.outboundMs,
      jitterMs: this.jitterMs,
      appliesTo: "one-way-per-direction"
    };
  }

  /**
   * 入站消息：按单程延迟投递。回调同时给出原始接收时刻与真正投递时刻；
   * 房间只用投递时刻作为权威 nowMs，接收时刻仅供日志/测量（否则入站延迟会吃掉 prepareLead）。
   */
  scheduleInbound(deliver: (receivedAtMs: number, deliveredAtMs: number) => void): void {
    const receivedAtMs = serverNowMs();
    this.schedule(this.delay(this.inboundMs), () => deliver(receivedAtMs, serverNowMs()));
  }

  /** 出站消息：按单程延迟投递。 */
  scheduleOutbound(deliver: () => void): void {
    this.schedule(this.delay(this.outboundMs), deliver);
  }

  /** 仅开发故障注入：丢弃“下一条 Ack”（一次），其余消息不受影响。 */
  consumeDropNextAck(): boolean {
    if (!this.dropAckArmed) return false;
    this.dropAckArmed = false;
    return true;
  }

  close(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private delay(baseMs: number): number {
    if (this.jitterMs <= 0) return baseMs;
    return baseMs + Math.floor(this.random() * (this.jitterMs + 1));
  }

  private schedule(delayMs: number, task: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      task();
    }, Math.max(0, Math.round(delayMs)));
    this.timers.add(timer);
  }
}
