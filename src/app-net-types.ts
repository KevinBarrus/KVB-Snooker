import type { NetDiagnostics } from "./app-net-diagnostics.js";
import type { ShotTimingRecord } from "./net/net-session-state.js";
import type { ContextView, LatencyConfig, MatchProgressView, RoomPhase, SeatIndex } from "./net/protocol.js";

interface NetSnapshotView {
  readonly match: MatchProgressView;
  readonly seat: SeatIndex | null;
  readonly roomId: string | null;
  readonly version: number;
  readonly phase: RoomPhase;
  readonly context: ContextView;
  readonly balls: readonly { index: number; number: number; active: boolean; x: number; y: number; z: number }[];
}

export interface NetTestHandle {
  readonly ready: Promise<void>;
  snapshot(): NetSnapshotView | null;
  timing(): ShotTimingRecord;
  diagnostics(): ReturnType<NetDiagnostics["report"]>;
  readonly latency: LatencyConfig;
  readonly lastError: string | null;
  readonly lastRejectReason: string | null;
  readonly connectionState: string;
  readonly seat: SeatIndex | null;
  readonly cameraState: 0 | 1;
  readonly cameraPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly cameraTarget: { readonly x: number; readonly y: number; readonly z: number };
  readonly shotsBusy: boolean;
  readonly turn: boolean;
  readonly readyToStroke: boolean;
  readonly fps: number;
  readonly netStats: { readonly snapshotsPerSecond: number; readonly maxGapMs: number; readonly marginMs: number };
  readonly turnReady: boolean;
  readonly contactErrorMm: number | null;
  readonly localCueVisual: {
    readonly visible: boolean; readonly yaw: number; readonly pitch: number;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly remoteCueVisual: {
    readonly visible: boolean; readonly struck: boolean; readonly leadingSpace: number;
    readonly yaw: number; readonly pitch: number;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly shotVisual: {
    readonly cuePosition: { readonly x: number; readonly y: number; readonly z: number };
    readonly leadingSpace: number;
    readonly struck: boolean;
    readonly displayServerMs: number;
  };
}

declare global {
  interface Window { __snkNet?: NetTestHandle }
}

