// PCOL L7990-8031（_onModelResponse：记分同步 + FOUL 消息）/ L6233-6234、L6306-6309（快捷键条联动）。
import type { EventBus } from "../core/event-bus";
import { FoulNotice, FoulNoticeDom } from "./foul-notice";
import { PowerBar, PowerBarDom } from "./power-bar";
import { ScorePanel, ScorePanelDom, type ScoreSource } from "./score-panel";
import { ShortcutsBar, ShortcutsBarDom } from "./shortcuts-bar";

export class Hud {
  readonly scorePanel = new ScorePanel();
  readonly foulNotice = new FoulNotice();
  readonly powerBar = new PowerBar();
  readonly shortcutsBar = new ShortcutsBar();
  playerIndex = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly players: () => readonly ScoreSource[]) {}

  resetPlayers(names: readonly string[]): void {
    this.scorePanel.resetPlayers(names);
  }

  attach(bus: EventBus): void {
    this.disposers.push(
      bus.on("sim/shooting-start", ({ playerIndex }) => {
        this.playerIndex = playerIndex;
        this.scorePanel.setPlayerIndex(playerIndex);
        this.shortcutsBar.active = true;
      }),
      bus.on("game/ball-on-changed", ({ ballOn }) => this.scorePanel.setBallOn(ballOn)),
      bus.on("game/frame-events", () => {
        this.scorePanel.syncResults(this.players(), this.playerIndex);
      }),
      // PCOL L8012-8016
      bus.on("game/foul", ({ foulCode, description, score }) => {
        if (foulCode !== 0 && this.scorePanel.ballOn !== 0) this.foulNotice.showFoul(score, description);
      }),
      bus.on("ctrl/state-change-start", () => {
        this.shortcutsBar.active = false;
      }),
      bus.on("ctrl/state-change-end", ({ to }) => {
        this.shortcutsBar.group = to;
        this.shortcutsBar.active = true;
      })
    );
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  update(dt: number): void {
    this.foulNotice.update(dt);
  }
}

export class HudDom {
  readonly element: HTMLElement;
  private readonly scorePanel: ScorePanelDom;
  private readonly foulNotice: FoulNoticeDom;
  private readonly powerBar: PowerBarDom;
  private readonly shortcutsBar: ShortcutsBarDom;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "hud";
    this.scorePanel = new ScorePanelDom(doc);
    this.foulNotice = new FoulNoticeDom(doc);
    this.powerBar = new PowerBarDom(doc);
    this.shortcutsBar = new ShortcutsBarDom(doc);
    this.element.append(
      this.scorePanel.element,
      this.foulNotice.element,
      this.powerBar.element,
      this.shortcutsBar.element
    );
  }

  sync(hud: Hud): void {
    this.scorePanel.sync(hud.scorePanel);
    this.foulNotice.sync(hud.foulNotice);
    this.powerBar.sync(hud.powerBar);
    this.shortcutsBar.sync(hud.shortcutsBar);
  }
}
