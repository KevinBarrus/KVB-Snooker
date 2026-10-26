import type { BrowserGame } from "../app-game.js";
import { makeRuleTestSetup, RULE_TEST_PRESETS, type RuleTestPreset } from "./presets.js";

export function mountRulesTest(form: HTMLFormElement, game: BrowserGame) {
  const mode = form.querySelector<HTMLSelectElement>('select[name="mode"]');
  const difficulty = form.querySelector<HTMLSelectElement>('select[name="difficulty"]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!mode || !difficulty || !submit) throw new Error("Missing game options");
  const option = new Option("双人规则测试", "rules-test");
  mode.add(option);
  const group = document.createElement("span");
  group.className = "rule-test";
  const label = document.createElement("label");
  label.textContent = "测试球局 ";
  const presets = document.createElement("select");
  presets.name = "test-position";
  for (const preset of RULE_TEST_PRESETS) presets.add(new Option(preset.name, preset.id));
  label.append(presets);
  const reset = document.createElement("button");
  reset.type = "button"; reset.textContent = "重置当前球局";
  group.append(label, reset); form.insertBefore(group, submit);
  let loaded: RuleTestPreset | null = null;
  let loadedSession = game.session;
  const start = () => {
    if (mode.value !== "rules-test") { loaded = null; return false; }
    const selected = RULE_TEST_PRESETS.find(preset => preset.id === presets.value);
    if (selected && game.setMode("single-play", "NORMAL", { players: ["USER", "USER"], setup: makeRuleTestSetup(selected.id) })) {
      loaded = selected.id; loadedSession = game.session;
    }
    return true;
  };
  const restart = () => {
    if (!loaded || loadedSession !== game.session || !game.canReset) return;
    presets.value = loaded; start();
  };
  const sync = () => {
    const testing = mode.value === "rules-test";
    group.hidden = !testing;
    if (difficulty.parentElement) difficulty.parentElement.hidden = testing;
    submit.textContent = testing ? "加载球局" : "开始新局";
    mode.disabled = presets.disabled = !game.canReset;
    reset.disabled = !game.canReset || !loaded || loadedSession !== game.session;
  };
  mode.addEventListener("change", sync); reset.addEventListener("click", restart); sync();
  return { start, sync, dispose: () => {
    mode.removeEventListener("change", sync); reset.removeEventListener("click", restart);
    group.remove(); option.remove();
  } };
}
