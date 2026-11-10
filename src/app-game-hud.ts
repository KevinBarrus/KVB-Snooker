import { GAME_STATE } from "./core/game.js";
import { FoulNotice } from "./ui/foul-notice.js";
import type { BrowserGame } from "./app-game.js";
const TOUCHING_BALL_NAMES = ["cue ball", "red", "yellow", "green", "brown", "blue", "pink", "black"];
const BALL_NAMES = ["母球", "红球", "黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"];

export class BrowserGameHud {
  readonly touchingMessage = new FoulNotice();
  touchingKey = "";
  constructor(private readonly game: BrowserGame) {}
  get touchingNotice(): string {
    if (this.game.session.state !== GAME_STATE.READY || this.game.session.finished || this.game.shots.busy || this.game.replay.active || this.game.session.mode === "practice") return "";
    const indices = this.game.session.touchingBallIndices;
    if (!indices.length) return "";
    const names = [...new Set(indices.map(index => TOUCHING_BALL_NAMES[this.game.simulator.getBallView(index).number]))].join(", ");
    return `Play away without moving the ${names}.`;
  }

  syncRules(canShoot: boolean): void {
    const decision = this.game.session.decision;
    this.game.ruleChoice.sync(decision && !this.game.replay.active ? {
      text: `${decision.canReplace ? "犯规与 Miss（FOUL AND A MISS）" : "犯规"}罚 ${-this.game.session.result.score} 分，已入账。玩家 ${decision.playerIndex + 1} 选择下一杆。${this.game.session.context.inHand > 0 ? "从当前位置继续的一方获得 D 区手中球。" : ""}${this.game.session.freeBallAvailable ? "接手可选择自由球。" : ""}`,
      ownLabel: "自己接手",
      otherLabel: this.game.session.context.inHand > 0 ? "让对手继续（D 区手中球）" : "让对手继续（当前位置）",
      restoreLabel: decision.canReplace ? "复位，让对手重打" : undefined
    } : null);
    const free = this.game.session.freeBallAvailable;
    if ((!free && this.game.session.context.ballOn !== 252) || !this.game.human.active || this.game.replay.active) {
      this.game.nomination.sync(null);
      return;
    }
    const vars = this.game.human.getStrokeVars();
    const nomination = this.game.session.getNomination(vars[3], vars[5]);
    const options = Array.from({ length: this.game.simulator.getBallCount() }, (_, index) => this.game.simulator.getBallView(index))
      .filter(ball => ball.active && ball.number > 0 && (free ? (2 ** ball.number & this.game.session.context.ballOn) === 0 : ball.number > 1))
      .map(ball => ({ index: ball.index, label: BALL_NAMES[ball.number] }));
    const label = options.find(option => option.index === nomination.ballIndex)?.label;
    this.game.nomination.sync((nomination.required || free) && this.game.human.active && !this.game.replay.active ? {
      text: free ? (label ? `自由球：${label}，按 ${Math.log2(this.game.session.context.ballOn)} 分计` : "可选自由球；不使用则击打原目标")
        : label ? `本杆目标：${label}${nomination.manual ? "（已提名）" : "（自动）"}` : "目标不明确，请选择彩球",
      defaultLabel: free ? "不使用自由球" : "自动识别",
      selected: nomination.manual ? nomination.ballIndex : null,
      enabled: canShoot, options
    } : null);
  }

  syncHud(custom: boolean): void {
    const { playerIndex, ballOn, inHand } = this.game.session.context;
    this.game.hud.scorePanel.visible = this.game.session.mode !== "practice" || this.game.session.practiceScored;
    this.game.hud.scorePanel.ballOnVisible = !custom;
    const allLocal = this.game.session.players.length === 2 && this.game.session.players.every(player => player.type === "USER");
    this.game.hud.resetPlayers(this.game.session.players.map((player, index) => allLocal ? `玩家 ${index + 1}` : player.type === "USER" ? "PLAYER" : "PCOL AI"));
    this.game.hud.playerIndex = playerIndex;
    this.game.hud.scorePanel.setPlayerIndex(playerIndex);
    this.game.bus.emit("game/ball-on-changed", { ballOn, inHand });
    this.game.bus.emit("game/frame-events", { potted: [], respotted: [] });
  }

  update(dt: number): void {
    this.game.viewNotice.update(dt); this.game.viewNoticeDom.sync(this.game.viewNotice);
    const touching = this.touchingNotice;
    const touchingKey = `${this.game.session.context.nRounds}:${touching}`;
    if (!touching || this.game.hud.foulNotice.active) this.touchingMessage.close();
    else if (touchingKey !== this.touchingKey) {
      this.touchingKey = touchingKey;
      this.touchingMessage.show("TOUCHING BALL", touching);
    }
    this.touchingMessage.update(dt);
    this.game.touchingNoticeDom.sync(this.touchingMessage);
  }
  suspend(suspended: boolean): void {
    this.game.controls.input.enabled = !suspended;
    if (!suspended) {
      this.game.hudDom.element.hidden = false;
      this.game.practiceControls.element.hidden = false;
      this.game.viewNoticeDom.element.hidden = false;
      this.game.touchingNoticeDom.element.hidden = false;
      this.game.ruleChoice.element.hidden = false;
      this.game.nomination.element.hidden = false;
      return;
    }
    this.game.controls.inHand.exit();
    this.game.shots.finish();
    this.game.replay.clear();
    this.game.human.camera.endShotView();
    this.game.hud.foulNotice.close();
    this.game.hudDom.element.hidden = true;
    this.game.practiceControls.element.hidden = true;
    this.game.practiceCompletion.element.hidden = true;
    this.game.viewNoticeDom.element.hidden = true;
    this.game.touchingNoticeDom.element.hidden = true;
    this.game.ruleChoice.element.hidden = true;
    this.game.nomination.element.hidden = true;
    this.game.controls.input.enabled = false;
  }
}
