import { FOUL } from "./foul.js";
import type { RefSimulator } from "./snooker.js";

export function availablePoints(sim: Pick<RefSimulator, "getBalls">, ballOn: number): number {
  if (ballOn === 0 || ballOn === 65535) return 0;
  const balls = sim.getBalls().filter(ball => ball.active && ball.number > 0);
  const reds = balls.filter(ball => ball.number === 1).length;
  const colours = balls.filter(ball => ball.number > 1);
  const highest = Math.max(0, ...colours.map(ball => ball.number));
  if (ballOn === 2 || ballOn === 252) {
    return reds * (1 + highest) + colours.reduce((sum, ball) => sum + ball.number, 0) + (ballOn === 252 ? highest : 0);
  }
  return colours.filter(ball => 2 ** ball.number >= ballOn).reduce((sum, ball) => sum + ball.number, 0);
}

export function isMiss(foulCode: number, beforeGap: number, beforePoints: number, afterGap: number, afterPoints: number): boolean {
  return (foulCode & (FOUL.MISS_TARGET | FOUL.ILLEGAL_FIRST_HIT)) !== 0 &&
    Math.abs(beforeGap) <= beforePoints && Math.abs(afterGap) <= afterPoints;
}
