export interface FrameSetup {
  readonly balls: readonly { readonly index: number; readonly x: number; readonly z: number; readonly active: boolean }[];
  readonly ballOn: number;
  readonly inHand: 0 | 1 | 2;
  readonly playerIndex: number;
  readonly scores: readonly number[];
}

export type RuleSet = "classic" | "snooker-900";

/** 母球自由摆放范围；练习专用，不改变正式对局的 D 区手中球。 */
export type PracticeCuePlacement = "d-area" | "anywhere";

/** 练习模式的可选行为，只影响练习，不复用为正式对局规则。 */
export interface PracticeOptions {
  /** 默认 "d-area"：沿用练习原有的 D 区手中球。 */
  readonly cuePlacement?: PracticeCuePlacement;
  /** 每次击球后把该号码的目标球放回置球点（五分点练习的蓝球）。 */
  readonly respotTargetBallNumber?: number;
  /** 配合 respotTargetBallNumber，把目标阶段固定回该值。 */
  readonly targetBallOn?: number;
  /** 默认 true；清彩与五分点练习不计分。 */
  readonly score?: boolean;
  /** 自建球形练习：任意球合法，按落袋球面值累计分数与单杆，不判犯规。 */
  readonly freeScoring?: boolean;
}

export interface GameOptions {
  readonly ruleset?: RuleSet;
  readonly openingPlayerIndex?: number;
  readonly players?: readonly ("USER" | "AI")[];
  readonly setup?: FrameSetup;
  readonly practice?: PracticeOptions;
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
