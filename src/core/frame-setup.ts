export interface FrameSetup {
  readonly balls: readonly { readonly index: number; readonly x: number; readonly z: number; readonly active: boolean }[];
  readonly ballOn: number;
  readonly inHand: 0 | 1 | 2;
  readonly playerIndex: number;
  readonly scores: readonly number[];
}

export interface GameOptions {
  readonly openingPlayerIndex?: number;
  readonly players?: readonly ("USER" | "AI")[];
  readonly setup?: FrameSetup;
}

export function copyFrameSetup(setup: FrameSetup, ballCount: number, playerCount: number): FrameSetup {
  const indices = new Set(setup.balls.map(ball => ball.index));
  if (setup.balls.length !== ballCount || indices.size !== ballCount ||
      setup.balls.some(ball => !Number.isInteger(ball.index) || ball.index < 0 || ball.index >= ballCount ||
        !Number.isFinite(ball.x) || !Number.isFinite(ball.z) || typeof ball.active !== "boolean") ||
      !setup.balls.find(ball => ball.index === 0)?.active ||
      ![2, 4, 8, 16, 32, 64, 128, 252].includes(setup.ballOn) || ![0, 1, 2].includes(setup.inHand) ||
      !Number.isInteger(setup.playerIndex) || setup.playerIndex < 0 || setup.playerIndex >= playerCount ||
      setup.scores.length !== playerCount || setup.scores.some(score => !Number.isSafeInteger(score) || score < 0)) {
    throw new Error("Invalid frame setup");
  }
  return { ...setup, balls: setup.balls.map(ball => ({ ...ball })), scores: [...setup.scores] };
}
