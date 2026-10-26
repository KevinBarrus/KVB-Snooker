import type { FrameSetup } from "../core/frame-setup.js";
import { DEFAULT_SCENE } from "../core/simulator/scene.js";

export const RULE_TEST_PRESETS = [
  { id: "standard", name: "标准开局" },
  { id: "last-red", name: "最后一红" },
  { id: "colours", name: "清彩" }
] as const;
export type RuleTestPreset = typeof RULE_TEST_PRESETS[number]["id"];

export function makeRuleTestSetup(id: RuleTestPreset): FrameSetup {
  if (!RULE_TEST_PRESETS.some(preset => preset.id === id)) throw new Error("Unknown rule test preset");
  const set = DEFAULT_SCENE.ballSet;
  const balls = Array.from({ length: set.length / 3 }, (_, index) => ({ index,
    x: set[index * 3 + 1], z: set[index * 3 + 2],
    active: id === "standard" || set[index * 3] !== 1 || (id === "last-red" && index === 1) }));
  if (id === "last-red") {
    balls[0].x = 0; balls[0].z = -.25;
    balls[1].x = 0; balls[1].z = -.55;
  } else if (id === "colours") {
    balls[0].x = -1.04; balls[0].z = -.65;
  }
  return { balls, ballOn: id === "colours" ? 4 : 2, inHand: id === "standard" ? 2 : 0,
    playerIndex: 0, scores: [0, 0] };
}
