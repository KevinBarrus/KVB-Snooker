import type { Simulator } from "./core/simulator/simulator.js";
import { SnookerRef } from "./core/rules/snooker.js";
import { inferColour } from "./core/rules/nomination.js";
import type { PersonController } from "./controller/person-controller.js";
import type { PlacementCommands } from "./controller/in-hand.js";
import { RuleChoiceDom } from "./ui/rule-choice.js";
import { NominationDom } from "./ui/nomination.js";
import { TurnCommands } from "./net/turn-commands.js";
import type { NetSessionState } from "./net/net-session-state.js";
import type { CommandMessage, ClientCommandAction, ServerMessage } from "./net/protocol.js";

const NAMES = ["母球", "红球", "黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"];

export class NetRules {
  readonly commands: TurnCommands;
  readonly choice: RuleChoiceDom;
  readonly nomination: NominationDom;
  readonly placement: PlacementCommands;
  private readonly ref = new SnookerRef();
  private mirrorVersion = -1;
  private notified = "";

  constructor(private readonly session: NetSessionState, private readonly simulator: Simulator,
    private readonly person: PersonController, send: (message: CommandMessage) => boolean,
    ray: PlacementCommands["ray"], private readonly notice: (text: string) => void, focus: () => void) {
    this.ref.syncAreaWithSimulator(simulator);
    this.commands = new TurnCommands(send, () => `rule-${typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`);
    this.choice = new RuleChoiceDom(takeOver => { this.submit({ type: "decide-turn", takeOver }); focus(); },
      () => { const s = session.latestSnapshot; if (s) this.submit({ type: "replace-shot", attemptId: s.match.attemptId }); focus(); });
    this.nomination = new NominationDom(ballIndex => {
      const s = session.latestSnapshot; if (s) this.submit({ type: "nominate", ballIndex, attemptId: s.match.attemptId }); focus();
    });
    this.placement = {
      ray,
      valid: p => { this.restoreMirror(); return this.canPlace && this.ref.placeCueBallCheck(p.x, simulator.spotY, p.z, simulator); },
      place: p => {
        const s = session.latestSnapshot;
        return Boolean(s && this.canPlace && this.submit({ type: "place-cue", attemptId: s.match.attemptId, x: p.x, z: p.z }));
      },
      begin: () => this.canPlace,
      focus: () => session.latestSnapshot?.balls[0] ?? null,
      end: () => !this.commands.busy && Boolean(session.latestSnapshot?.balls[0].active)
    };
    document.body.append(this.choice.element, this.nomination.element);
  }
  get canPlace(): boolean { return this.session.canLaunch() && !this.commands.busy && (this.session.context?.inHand ?? 0) > 0; }
  receive(message: ServerMessage): void { this.commands.receive(message); }
  update(now: number): void {
    this.commands.update(now, this.session.version);
    if (this.commands.error && this.commands.error !== this.notified) { this.notified = this.commands.error; this.notice(this.notified); }
    if (!this.commands.error) this.notified = "";
    const s = this.session.latestSnapshot;
    if (!s) return;
    const decision = s.rules.decision;
    this.choice.sync(this.session.canDecide() && !this.commands.busy && decision ? {
      text: `${decision.canReplace ? "FOUL AND A MISS" : "FOUL"}${s.rules.freeBall ? " · 可选自由球" : ""}`,
      ownLabel: "自己接手", otherLabel: "让对手继续", restoreLabel: decision.canReplace ? "复位，让对手重打" : undefined
    } : null);
    if (!s.rules.nomination.enabled || !this.session.isLocalTurn() || this.session.paused) { this.nomination.sync(null); return; }
    this.restoreMirror();
    const n = s.rules.nomination, vars = this.person.getStrokeVars();
    const selected = n.selected ?? (s.rules.freeBall ? null : inferColour(this.simulator, vars[3], vars[5]));
    const label = selected === null ? "" : NAMES[s.balls[selected]?.number];
    this.nomination.sync({ selected: n.selected, enabled: this.session.canLaunch() && !this.commands.busy,
      defaultLabel: s.rules.freeBall ? "不使用自由球" : "自动识别",
      text: s.rules.freeBall ? `自由球${label ? `：${label}` : "可选"}` : label ? `本杆目标：${label}` : "目标不明确，请选择彩球",
      options: n.options.map(index => ({ index, label: NAMES[s.balls[index].number] })) });
  }
  private submit(action: ClientCommandAction): boolean {
    if (this.session.paused || this.session.connectionState !== "ready") return false;
    return this.commands.submit(action, this.session.version, performance.now());
  }
  private restoreMirror(): void {
    const s = this.session.latestSnapshot;
    if (!s?.checkpoint || this.mirrorVersion === s.version) return;
    this.simulator.restore(s.checkpoint); this.mirrorVersion = s.version;
  }
  dispose(): void { this.choice.dispose(); this.nomination.dispose(); }
}
