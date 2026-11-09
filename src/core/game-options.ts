import type { PracticeOptions } from "./frame-setup.js";

export function copyPracticeOptions(options: PracticeOptions): PracticeOptions {
  const placement = options.cuePlacement;
  if (placement !== undefined && placement !== "d-area" && placement !== "anywhere") {
    throw new Error("Invalid practice options");
  }
  const target = options.respotTargetBallNumber;
  if (target !== undefined && (!Number.isInteger(target) || target < 1 || target > 7)) {
    throw new Error("Invalid practice options");
  }
  const ballOn = options.targetBallOn;
  if (ballOn !== undefined && ![2, 4, 8, 16, 32, 64, 128, 252].includes(ballOn)) {
    throw new Error("Invalid practice options");
  }
  if (options.score !== undefined && typeof options.score !== "boolean") {
    throw new Error("Invalid practice options");
  }
  if (options.freeScoring !== undefined && typeof options.freeScoring !== "boolean") {
    throw new Error("Invalid practice options");
  }
  if (options.respotColoursAfterReds !== undefined && typeof options.respotColoursAfterReds !== "boolean") {
    throw new Error("Invalid practice options");
  }
  return { ...options };
}
