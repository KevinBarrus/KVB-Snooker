export interface RulesView {
  readonly players: readonly { readonly pts: number; readonly penalty: number; readonly brk: number }[];
  readonly decision: { readonly playerIndex: number; readonly canReplace: boolean } | null;
  readonly freeBall: boolean;
  readonly nomination: { readonly enabled: boolean; readonly selected: number | null; readonly options: readonly number[] };
  readonly touching: readonly number[];
}

export type RuleAction = { readonly attemptId: string } & (
  | { readonly type: "place-cue"; readonly x: number; readonly z: number }
  | { readonly type: "nominate"; readonly ballIndex: number | null }
  | { readonly type: "replace-shot" }
);

export function isRuleAction(value: unknown): value is RuleAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.attemptId !== "string" || !v.attemptId.length || v.attemptId.length > 128) return false;
  if (v.type === "replace-shot") return true;
  if (v.type === "nominate") return v.ballIndex === null ||
    (typeof v.ballIndex === "number" && Number.isInteger(v.ballIndex) && v.ballIndex > 0 && v.ballIndex < 64);
  return v.type === "place-cue" && [v.x, v.z].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10);
}

export function isRulesView(value: unknown): value is RulesView {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<RulesView>;
  const index = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n > 0 && n < 64;
  return Array.isArray(v.players) && v.players.length === 2 && v.players.every(p => p &&
    [p.pts, p.penalty, p.brk].every(n => typeof n === "number" && Number.isFinite(n))) &&
    (v.decision === null || Boolean(v.decision && [0, 1].includes(v.decision.playerIndex) && typeof v.decision.canReplace === "boolean")) &&
    typeof v.freeBall === "boolean" && Boolean(v.nomination && typeof v.nomination.enabled === "boolean" &&
      (v.nomination.selected === null || index(v.nomination.selected)) && Array.isArray(v.nomination.options) &&
      v.nomination.options.length < 64 && v.nomination.options.every(index)) &&
    Array.isArray(v.touching) && v.touching.length < 64 && v.touching.every(index);
}
