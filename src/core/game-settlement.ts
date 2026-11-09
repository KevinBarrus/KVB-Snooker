import { BALL_ON } from "./rules/snooker.js";
import { targetPenalty } from "./rules/nine-hundred.js";
import { FOUL } from "./rules/foul.js";
import type { GameSession } from "./game.js";
import type { PracticeOptions } from "./frame-setup.js";
import type { NineHundredMatch } from "./nine-hundred-match.js";
import { Vec3 } from "./math/vec3.js";
import { practiceTable } from "./practice/table-geometry.js";

export function settleFreePractice(game: GameSession, options: PracticeOptions, initialColours: readonly number[], index: number): void {
  const player = game.players[index];
  const values = [1, 1, 2, 3, 4, 5, 6, 7];
  const result = game.simulator.getResult();
  const score = result.pottedIndices.reduce((sum, ballIndex) => {
    const ball = game.simulator.getBallView(ballIndex);
    return sum + (ballIndex === 0 ? 0 : values[ball.number] ?? 0);
  }, 0);
  game.result.score = score;
  game.result.foulCode = 0;
  if (score > 0) {
    player.pts += score;
    player.scoreCount++;
    player.brk += score;
  } else {
    player.brk = 0;
  }
  game.context.playerIndex = index;
  respotFreePracticeColours(game, options, initialColours, result.pottedIndices, result.outOfBoundsIndices);
  if (!game.simulator.getBallView(0).active) {
    game.simulator.respotIndexDefault(0);
    game.context.inHand = 2;
  }
}

function respotFreePracticeColours(game: GameSession, options: PracticeOptions, initialColours: readonly number[], potted: readonly number[], outOfBounds: readonly number[]): void {
  const inactive = [...new Set([...potted, ...outOfBounds])];
  const reds = (): number => game.simulator.getBalls().filter(ball => ball.number === 1 && ball.active).length;
  const redsAfter = reds();
  const redsPotted = inactive.filter(index => game.simulator.getBallView(index).number === 1).length;
  const redsBefore = redsAfter + redsPotted;
  const colours = inactive.filter(index => game.simulator.getBallView(index).number >= 2);
  const continueRespot = options.respotColoursAfterReds === true;
  if (redsBefore > 0 && redsAfter === 0) {
    if (continueRespot) initialColours.forEach(index => respotFreePracticeColour(game, index));
    return;
  }
  if (redsAfter > 0 || continueRespot) colours.forEach(index => respotFreePracticeColour(game, index));
}

function respotFreePracticeColour(game: GameSession, index: number): void {
  const ball = game.simulator.getBallAtIndex(index);
  if (!game.simulator.touchBalls(index, ball.spot)) { game.simulator.respotIndexDefault(index); return; }
  const table = practiceTable(game.simulator);
  for (let radius = .05; radius <= Math.max(table.maxX - table.minX, table.maxZ - table.minZ); radius += .05) {
    for (let step = -radius; step <= radius + 1e-9; step += .05) {
      for (const [x, z] of [[ball.spot.x + step, ball.spot.z + radius], [ball.spot.x + radius, ball.spot.z + step],
        [ball.spot.x + step, ball.spot.z - radius], [ball.spot.x - radius, ball.spot.z + step]] as const) {
        if (x < table.minX || x > table.maxX || z < table.minZ || z > table.maxZ) continue;
        const point = new Vec3(x, game.simulator.spotY, z);
        if (game.simulator.touchBalls(index, point)) continue;
        game.simulator.respotIndexXYZ(index, x, game.simulator.spotY, z);
        return;
      }
    }
  }
}

export function settleTimedScore(game: GameSession, nine: NineHundredMatch, index: number): boolean {
  const player = game.players[index];
  if (game.result.score > 0) {
    player.pts += game.result.score;
    player.scoreCount++;
    player.brk += game.result.score;
  } else {
    player.penalty += game.result.score;
    player.brk = 0;
    game.context.playerIndex = (index + 1) % game.players.length;
    if (game.result.foulCode !== 0) { game.context.inHand = 2; nine.fullTable = true; }
  }
  if (nine.clock.view.phase === "frame-expired" || game.context.ballOn === 0) return true;
  nine.clock.beginTurn(game.context.inHand > 0);
  return false;
}

export function applyTimeoutFoul(game: GameSession, nine: NineHundredMatch): void {
  const index = game.context.playerIndex;
  const penalty = targetPenalty(game.context, game.simulator);
  game.players[index].penalty -= penalty;
  game.players[index].brk = 0;
  game.result.score = -penalty;
  game.result.foulCode = FOUL.SHOT_TIMEOUT;
  if (game.context.ballOn === BALL_ON.RED || game.context.ballOn === BALL_ON.COLOR_ALL) {
    game.context.ballOn = game.simulator.getBalls().some(ball => ball.number === 1 && ball.active) ? BALL_ON.RED : BALL_ON.YELLOW;
  }
  game.context.playerIndex = (index + 1) % game.players.length;
  game.context.inHand = 2;
  game.context.nRounds++;
  nine.fullTable = true;
}
