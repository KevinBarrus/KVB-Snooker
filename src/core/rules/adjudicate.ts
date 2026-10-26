import { FOUL } from "./foul.js";
import type { RefSimulator, RulesContext } from "./snooker.js";
import { snookerView } from "./snookered.js";

export function adjudicate(ctx: RulesContext, sim: RefSimulator): { score: number; foulCode: number } {
  const result = sim.result, evidence = sim.getContactEvidence?.();
  const contacts = evidence?.firstContactIndices ?? (result.firstKissIndex ? [result.firstKissIndex] : []);
  const firstNumber = sim.getBallAtIndex(contacts[0] ?? 0).number;
  const colour = ctx.ballOn === 252;
  const legalNumber = colour ? (ctx.nominatedBallIndex === undefined ? (firstNumber > 1 ? firstNumber : 0)
    : sim.getBallAtIndex(ctx.nominatedBallIndex).number) : Math.log2(ctx.ballOn);
  const value = colour && legalNumber === 0 ? 7 : legalNumber;
  const free = ctx.freeBallIndex;
  const number = (index: number): number => index === free ? value : sim.getBallAtIndex(index).number;
  const on = (index: number): boolean => sim.getBallAtIndex(index).number === legalNumber;
  const touchingOn = evidence?.touchingIndices.some(index => free === undefined ? on(index) : index === free) ?? false;
  let foulCode = 0, penalty = Math.max(4, value), score = 0;
  if (!touchingOn) {
    if (!contacts.length) foulCode |= FOUL.MISS_TARGET;
    else if (free !== undefined ? !contacts.includes(free) || contacts.some(index => index !== free && !on(index))
      : contacts.some(index => !on(index))) foulCode |= FOUL.ILLEGAL_FIRST_HIT;
    if (foulCode) for (const index of contacts) penalty = Math.max(penalty, number(index));
  }
  for (const index of result.outOfBoundsIndices) {
    foulCode |= FOUL.OFF_TABLE;
    penalty = Math.max(penalty, number(index));
  }
  for (const index of result.pottedIndices) {
    if (index !== 0 && (on(index) || index === free)) score += value;
    else {
      foulCode |= index === 0 ? FOUL.POTTING_CUE_BALL : FOUL.ILLEGAL_POTTING;
      penalty = Math.max(penalty, number(index));
    }
  }
  if (free !== undefined && value !== 1 && score > value) score = value;
  if (evidence?.pushedIndices.length) {
    foulCode |= FOUL.PUSH_STROKE;
    for (const index of evidence.pushedIndices) penalty = Math.max(penalty, number(index));
  }
  const objects = sim.getBalls().filter(ball => ball.active && ball.number > 0);
  const finalPair = objects.length === 2 && objects.every(ball => ball.number > 1) && objects.some(ball => ball.number === 7);
  if (free !== undefined && score === 0 && foulCode === 0 && !finalPair &&
      snookerView(sim, ctx.ballOn).effectiveBlockers.includes(free)) foulCode |= FOUL.FREE_BALL_SNOOKER;
  return { score: foulCode ? -penalty : score, foulCode };
}
