import { Vec3 } from "../../src/core/math/vec3.js";
import type { StrokeVars } from "../../src/core/simulator/shot-result.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { DEFAULT_SCENE } from "../../src/core/simulator/scene.js";
import { GAME_STATE, GameSession } from "../../src/core/game.js";
import type { FrameSetup } from "../../src/core/frame-setup.js";
import type { CommandMessage, ServerEventMessage, SnapshotMessage } from "../../src/net/protocol.js";
import { RoomSession, type RoomOptions, type RoomTickResult } from "../../src/server/room.js";
import { makePocketTable } from "../fixtures/table.js";

/** 服务端测试统一使用合成六袋台面（tests/fixtures/table.ts）；mesh.id 为 six-pocket-test-table。 */
export const TEST_BALL_SET = [0, 0.2, 0.5, 1, 0.1, -0.4, 7, 0.8, 0.2];

export function makeSimulator(ballSet: readonly number[] = TEST_BALL_SET): Simulator {
  return new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: [...ballSet] });
}

export function settleSimulator(sim: Simulator, maxSteps = 200): void {
  for (let count = 0; sim.nAwakened && count < maxSteps; ++count) sim.step(0.1);
}

export interface StrokeTarget {
  readonly dx: number;
  readonly dz: number;
  readonly speed?: number;
  /** 皮头触点相对球心在方向右手侧的偏移（米）；0 为定杆中心击球。 */
  readonly sideOffset?: number;
  readonly tipRadius?: number;
}

/** 用真实 Simulator 的母球位置构造合法 StrokeVars：e[0..2]=触点世界坐标，e[3..5]=方向。 */
export function makeStrokeVarsFor(sim: Simulator, target: StrokeTarget): StrokeVars {
  const direction = new Vec3(target.dx, 0, target.dz).normalize();
  const side = new Vec3().crossVectors(direction, Vec3.UNIT_Y).normalize().scale(target.sideOffset ?? 0);
  const cue = sim.getCueBallPosition();
  const contact = new Vec3().subVectors(cue, direction.clone().scale(sim.ballRadius)).add(side);
  return new Float32Array([
    contact.x, contact.y, contact.z,
    direction.x, 0, direction.z,
    target.speed ?? 6,
    target.tipRadius ?? 0.005
  ]);
}

/** 结算后若持权者需要选择接手方，选择自己接手，让脚本继续下一杆。 */
export function takeOverDecision(game: GameSession): void {
  const decision = game.decision;
  if (decision) game.chooseNextPlayer(decision.playerIndex, decision.playerIndex);
}

/** 以固定物理步长把当前杆推进到稳定（READY/DECIDING）。 */
export function advanceToSettled(game: GameSession, dt = 0.05, maxSteps = 4000): number {
  let steps = 0;
  while (game.state === GAME_STATE.SIMULATING && steps < maxSteps) {
    game.step(dt);
    steps++;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// 房间测试辅助
// ---------------------------------------------------------------------------

export const TEST_ROOM_ID = "test-room";

export function makeTestRoom(options: Partial<RoomOptions> = {}): RoomSession {
  return new RoomSession(TEST_ROOM_ID, {
    prepareLeadMs: 700,
    tickHz: 100,
    snapshotHz: 20,
    seed: 2026, bestOf: 1, firstOpeningPlayer: 0, matchId: "test-match",
    ...options
  }, makePocketTable());
}

export function joinSeats(room: RoomSession, nowMs = 0): { readonly c0: string; readonly c1: string } {
  const c0 = "connection-0";
  const c1 = "connection-1";
  room.join(c0, undefined, nowMs);
  room.join(c1, undefined, nowMs);
  return { c0, c1 };
}

export function prepareCommand(
  commandId: string, expectedVersion: number, vars: number[] | Float32Array, clientSentAtMs = 0
): CommandMessage {
  return {
    type: "command", commandId, expectedVersion,
    action: { type: "prepare-shot", vars: Array.from(vars), clientSentAtMs }
  };
}

export function decideCommand(commandId: string, expectedVersion: number, takeOver: boolean): CommandMessage {
  return { type: "command", commandId, expectedVersion, action: { type: "decide-turn", takeOver } };
}

export type ServerEventOfType<T extends ServerEventMessage["event"]["type"]> = ServerEventMessage & {
  readonly event: Extract<ServerEventMessage["event"], { readonly type: T }>;
};

export function eventsOfType<T extends ServerEventMessage["event"]["type"]>(
  events: readonly ServerEventMessage[], type: T
): readonly ServerEventOfType<T>[] {
  return events.filter((message): message is ServerEventOfType<T> => message.event.type === type);
}

export interface SettleRun {
  readonly events: readonly ServerEventMessage[];
  readonly snapshots: readonly SnapshotMessage[];
  readonly last: RoomTickResult;
  readonly finalSnapshot: SnapshotMessage;
}

/** 以固定 10ms tick 推进房间直到离开 simulating；收集期间的所有事件与快照。 */
export function runTicks(room: RoomSession, startMs: number, stepMs = 10, maxTicks = 4000): SettleRun {
  const events: ServerEventMessage[] = [];
  const snapshots: SnapshotMessage[] = [];
  let nowMs = startMs;
  let last: RoomTickResult = { events: [], snapshot: null };
  let ticks = 0;
  for (; ticks < maxTicks; ++ticks) {
    nowMs += stepMs;
    last = room.tick(nowMs);
    events.push(...last.events);
    if (last.snapshot) snapshots.push(last.snapshot);
    if (room.session.state !== GAME_STATE.SIMULATING) break;
  }
  if (ticks >= maxTicks) throw new Error("room tick budget exhausted before settle");
  const finalSnapshot = last.snapshot ?? room.snapshot(nowMs);
  return { events, snapshots, last, finalSnapshot };
}

/** 参考实现：与房间相同台面/局面，直接驱动真实 GameSession，用来核对物理只施加一次冲量。 */
/** 用 DEFAULT_SCENE 的 22 球初始位置生成 FrameSetup；active 指定保留哪些球。 */
export function defaultFrameSetup(active: (index: number) => boolean = () => true): FrameSetup {
  const ballCount = DEFAULT_SCENE.ballSet.length / 3;
  const balls = [];
  for (let index = 0; index < ballCount; ++index) {
    balls.push({
      index,
      x: DEFAULT_SCENE.ballSet[3 * index + 1],
      z: DEFAULT_SCENE.ballSet[3 * index + 2],
      active: active(index)
    });
  }
  return { balls, ballOn: 2, inHand: 2, playerIndex: 0, scores: [0, 0] };
}

/** 只有母球在 (0, 0.3) 并朝 -z 直冲中袋的局面：用于验证母球摔袋后的手中球放置与 ready 快照时机。 */
export function cuePotSetup(): FrameSetup {
  const setup = defaultFrameSetup(index => index === 0);
  return { ...setup, inHand: 0, balls: setup.balls.map(ball => ball.index === 0 ? { ...ball, x: 0, z: 0.3 } : ball) };
}

export function makeReferenceSession(ballSet: readonly number[], frameSetup?: FrameSetup): GameSession {
  const sim = new Simulator(makePocketTable(), { ...DEFAULT_SCENE, ballSet: [...ballSet] });
  return new GameSession(sim, "single-play", {
    players: ["USER", "USER"], ruleset: "classic",
    ...(frameSetup ? { setup: frameSetup } : {})
  });
}
