/**
 * 联机开发原型显示源：由权威快照生成只读 BallView 结构视图并做位置/姿态插值（架构 §4.8）。
 * 纯模块：零 DOM、零物理。渲染与控制器只读取这里输出的显示数据，不接触服务端 World/Body。
 *
 * 插值策略：
 * - 渲染目标时刻 = 本地 now + 时钟偏移 - 固定插值延迟（默认约两个快照间隔）。
 * - 只在相邻快照之间线性插值位置、归一化 nlerp 四元数；不跨阶段（不同回合/结算归位）混合。
 * - 首端早于最早快照时取最早帧，尾端晚于最新快照时保持最新帧（不外推），避免制造权威假象。
 * - 版本单调：旧 version 快照被丢弃，绝不用旧快照覆盖新快照。
 */
import { Vec3 } from "../core/math/vec3.js";
import type { BallView, SerialData, ShotResult } from "../core/simulator/shot-result.js";
import type { RoomPhase, SnapshotBall, SnapshotMessage, StateVersion } from "./protocol.js";

export interface RemoteViewOptions {
  /** 渲染延迟；约两个快照间隔（20Hz 时 100ms）。 */
  readonly interpolationDelayMs?: number;
  /** 缓冲上限；超出后丢最旧帧。 */
  readonly maxFrames?: number;
  /** 缓冲保留时间窗口。 */
  readonly maxBufferMs?: number;
}

interface RemoteFrame {
  readonly version: StateVersion;
  readonly serverTimeMs: number;
  readonly phase: RoomPhase;
  readonly balls: readonly SnapshotBall[];
}

interface QuaternionValue {
  x: number;
  y: number;
  z: number;
  w: number;
}

const DEFAULT_INTERPOLATION_DELAY_MS = 100;
const DEFAULT_MAX_FRAMES = 120;
const DEFAULT_MAX_BUFFER_MS = 1500;
const MAX_INTERPOLATABLE_VERSION_JUMP = 8;

function normalizeQuaternion(values: QuaternionValue): QuaternionValue {
  const lengthSq = values.x * values.x + values.y * values.y + values.z * values.z + values.w * values.w;
  if (!Number.isFinite(lengthSq) || lengthSq < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const scale = 1 / Math.sqrt(lengthSq);
  return { x: values.x * scale, y: values.y * scale, z: values.z * scale, w: values.w * scale };
}

function nlerp(a: QuaternionValue, b: QuaternionValue, t: number): QuaternionValue {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = dot < 0 ? -1 : 1;
  const x = a.x + (b.x * sign - a.x) * t;
  const y = a.y + (b.y * sign - a.y) * t;
  const z = a.z + (b.z * sign - a.z) * t;
  const w = a.w + (b.w * sign - a.w) * t;
  return normalizeQuaternion({ x, y, z, w });
}

export class RemoteView {
  private readonly interpolationDelayMs: number;
  private readonly maxFrames: number;
  private readonly maxBufferMs: number;
  private frames: RemoteFrame[] = [];
  private views: BallView[] = [];
  private versionValue: StateVersion = -1;
  private phaseValue: RoomPhase = "ready";
  private offsetMs: number | null = null;
  private checkpointValue: SerialData | null = null;
  private readonly emptyResult: ShotResult = { nKissed: 0, firstKissIndex: 0, pottedIndices: [], outOfBoundsIndices: [] };

  constructor(options: RemoteViewOptions = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS;
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.maxBufferMs = options.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS;
  }

  get version(): StateVersion { return this.versionValue; }
  get phase(): RoomPhase { return this.phaseValue; }
  get frameCount(): number { return this.frames.length; }

  /** offset = serverTime - localTime（来自 ping 时钟估计）；null 时按无偏移处理。 */
  setClockOffset(offsetMs: number | null): void {
    this.offsetMs = offsetMs;
  }

  /** 接收入站快照；返回 false 表示过期/乱序被丢弃。 */
  pushSnapshot(snapshot: SnapshotMessage, nowMs: number): boolean {
    void nowMs;
    const latest = this.frames[this.frames.length - 1];
    if (latest) {
      if (snapshot.version < latest.version) return false;
      if (snapshot.version === latest.version && snapshot.serverTimeMs <= latest.serverTimeMs) return false;
      const discontinuous = snapshot.serverTimeMs <= latest.serverTimeMs ||
        (snapshot.version > latest.version + MAX_INTERPOLATABLE_VERSION_JUMP) ||
        snapshot.phase !== latest.phase;
      if (discontinuous) this.frames = [];
    }
    this.versionValue = snapshot.version;
    this.phaseValue = snapshot.phase;
    this.frames.push({
      version: snapshot.version,
      serverTimeMs: snapshot.serverTimeMs,
      phase: snapshot.phase,
      balls: snapshot.balls
    });
    if (this.frames.length > this.maxFrames) this.frames.splice(0, this.frames.length - this.maxFrames);
    this.trimBuffer();
    if (snapshot.checkpoint !== null) this.checkpointValue = copySerialData(snapshot.checkpoint);
    return true;
  }

  /** 每帧调用一次：把 nowMs 投影到服务器时钟并计算插值后的显示视图。 */
  update(nowMs: number): void {
    const frames = this.frames;
    if (frames.length === 0) { this.views = []; return; }
    const target = nowMs + (this.offsetMs ?? 0) - this.interpolationDelayMs;
    let before = frames[0];
    let after = frames[frames.length - 1];
    let ratio = 0;
    if (target <= before.serverTimeMs) {
      after = before;
    } else if (target >= after.serverTimeMs) {
      before = after;
    } else {
      for (let index = 1; index < frames.length; ++index) {
        const candidate = frames[index];
        if (candidate.serverTimeMs >= target) {
          after = candidate;
          before = frames[index - 1];
          const span = candidate.serverTimeMs - before.serverTimeMs;
          ratio = span > 0 ? (target - before.serverTimeMs) / span : 0;
          break;
        }
      }
    }
    this.views = this.interpolate(before, after, Math.min(1, Math.max(0, ratio)));
  }

  getBallCount(): number {
    return this.views.length;
  }

  getBallView(index: number): BallView {
    const view = this.views[index];
    if (!view) throw new RangeError(`RemoteView ball index out of range: ${index}`);
    return view;
  }

  getCueBallPosition(): Readonly<Vec3> {
    const cue = this.views[0];
    return cue ? cue.position.clone() : new Vec3();
  }

  /** 联机原型不计算本地 FirstKiss；ShotView 的 object 模式退化为母球焦点。 */
  getResult(): Readonly<ShotResult> {
    return { ...this.emptyResult, pottedIndices: [], outOfBoundsIndices: [] };
  }

  /** 最近一次稳定阶段的检查点（用于本地 Simulator.restore 后 predict）。 */
  getCheckpoint(): SerialData | null {
    return this.checkpointValue === null ? null : copySerialData(this.checkpointValue);
  }

  reset(): void {
    this.frames = [];
    this.views = [];
    this.versionValue = -1;
    this.phaseValue = "ready";
    this.checkpointValue = null;
  }

  private interpolate(before: RemoteFrame, after: RemoteFrame, ratio: number): BallView[] {
    const views: BallView[] = [];
    const count = before.balls.length;
    for (let index = 0; index < count; ++index) {
      const from = before.balls[index];
      const to = after.balls[index] ?? from;
      const active = ratio < 0.5 ? from.active : to.active;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      const z = from.z + (to.z - from.z) * ratio;
      const fromOrientation = normalizeQuaternion({ x: from.qx, y: from.qy, z: from.qz, w: from.qw });
      const toOrientation = normalizeQuaternion({ x: to.qx, y: to.qy, z: to.qz, w: to.qw });
      const orientation = nlerp(fromOrientation, toOrientation, ratio);
      const async = from.x !== to.x || from.y !== to.y || from.z !== to.z ||
        fromOrientation.x !== toOrientation.x || fromOrientation.w !== toOrientation.w;
      views.push({
        index: from.index,
        number: from.number,
        active,
        position: new Vec3(x, y, z),
        async,
        renderPosition: { x, y, z },
        renderOrientation: orientation
      });
    }
    return views;
  }

  private trimBuffer(): void {
    const latest = this.frames[this.frames.length - 1];
    while (this.frames.length > 2 && latest.serverTimeMs - this.frames[0].serverTimeMs > this.maxBufferMs) {
      this.frames.shift();
    }
  }
}

function copySerialData(data: SerialData): SerialData {
  return { balls: [...data.balls], mbid: data.mbid, evolution: data.evolution };
}
