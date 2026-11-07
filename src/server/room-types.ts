import type { FrameSetup } from "../core/frame-setup.js";
import type {
  AckMessage, LatencyConfig, RejectReason, SeatIndex, ServerEventMessage, SnapshotMessage, WelcomeMessage
} from "../net/protocol.js";

/** 架构 §4.8 登记的 RoomOptions；latency/frameSetup 为服务端内部扩展字段。 */
export interface RoomOptions {
  readonly prepareLeadMs: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
  /** 内部扩展：由传输层配置注入 welcome.latency，房间自身不做延迟。 */
  readonly latency?: LatencyConfig;
  /** 内部扩展：开发/测试夹具的初始局面；正式流程不传。 */
  readonly frameSetup?: FrameSetup;
}

export interface RoomJoinResult {
  readonly seat: SeatIndex;
  readonly welcome: WelcomeMessage;
}

export interface RoomTickResult {
  readonly ack?: AckMessage;
  readonly snapshot: SnapshotMessage | null;
  readonly events: readonly ServerEventMessage[];
}

export type RoomJoinOutcome = RoomJoinResult | { readonly reason: RejectReason };
