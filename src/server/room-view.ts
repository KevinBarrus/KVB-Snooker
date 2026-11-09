import type { Simulator } from "../core/simulator/simulator.js";
import type { GameSession } from "../core/game.js";
import { GAME_STATE } from "../core/game.js";
import type { LatencyConfig, MatchProgressView, PendingShotView, RoomPhase, ServerEvent, ServerEventMessage, SnapshotBall, SnapshotMessage } from "../net/protocol.js";

/** welcome.latency 的缺省值：未开启延迟注入。 */
export const NO_LATENCY: LatencyConfig = {
  enabled: false,
  inboundMs: 0,
  outboundMs: 0,
  jitterMs: 0,
  appliesTo: "one-way-per-direction"
};

/** 房间阶段是核心 GameState 的窄映射：finished 优先于 READY（终局后不再允许击球）。 */
export function roomPhase(session: GameSession): RoomPhase {
  if (session.finished) return "finished";
  switch (session.state) {
    case GAME_STATE.READY:
      return "ready";
    case GAME_STATE.SIMULATING:
      return "simulating";
    case GAME_STATE.DECIDING:
      return "deciding";
    default:
      // PENDING/NO_GAME/JUDGING 只会出现在构造或裁判内部同步过程，公开快照时已回到 READY；
      // 若出现意外状态，返回 ready 而不是抛错，保持快照可用。
      return "ready";
  }
}

export function buildSnapshot(
  session: GameSession,
  version: number,
  eventSeq: number,
  nowMs: number,
  pendingShot: PendingShotView | null,
  match: MatchProgressView
): SnapshotMessage {
  const phase = match.phase === "active" ? roomPhase(session) : match.phase;
  const simulator = session.simulator;
  return {
    type: "snapshot",
    match,
    version,
    eventSeq,
    serverTimeMs: nowMs,
    phase,
    context: {
      playerIndex: session.context.playerIndex,
      ballOn: session.context.ballOn,
      inHand: session.context.inHand,
      scores: [session.getScore(0), session.getScore(1)],
      round: session.context.nRounds
    },
    balls: snapshotBalls(simulator),
    checkpoint: phase === "simulating" ? null : session.simulator.serialize(),
    pendingShot
  };
}

export function eventMessage(seq: number, nowMs: number, event: ServerEvent): ServerEventMessage {
  return { type: "event", seq, serverTimeMs: nowMs, event };
}

export function snapshotBalls(simulator: Simulator): SnapshotBall[] {
  const balls: SnapshotBall[] = [];
  for (let index = 0; index < simulator.getBallCount(); ++index) {
    const view = simulator.getBallView(index);
    balls.push({
      index: view.index,
      number: view.number,
      active: view.active,
      x: view.position.x,
      y: view.position.y,
      z: view.position.z,
      qx: view.renderOrientation.x,
      qy: view.renderOrientation.y,
      qz: view.renderOrientation.z,
      qw: view.renderOrientation.w
    });
  }
  return balls;
}
