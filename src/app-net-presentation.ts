import { EventBus } from "./core/event-bus.js";
import { getFoulDescription } from "./core/rules/foul.js";
import type { PersonController } from "./controller/person-controller.js";
import type { NetShotLauncher } from "./app-net-shot.js";
import { BrowserAudio } from "./app-audio.js";
import { Hud, HudDom } from "./ui/hud.js";
import { FoulNotice, FoulNoticeDom } from "./ui/foul-notice.js";
import type { NetSessionState } from "./net/net-session-state.js";
import { PresentationEvents } from "./net/presentation-events.js";
import type { ServerMessage } from "./net/protocol.js";

export class NetPresentation {
  readonly bus = new EventBus();
  readonly hud: Hud;
  readonly dom: HudDom;
  readonly audio: BrowserAudio;
  readonly tools = document.createElement("div");
  private readonly touching = new FoulNotice();
  private readonly touchingDom: FoulNoticeDom;
  private readonly events = new PresentationEvents();
  private touchingKey = "";
  private attempt = "";
  private namesKey = "";
  constructor(private readonly session: NetSessionState, private readonly person: PersonController,
    private readonly launcher: NetShotLauncher, canvas: HTMLCanvasElement) {
    this.hud = new Hud(() => session.latestSnapshot?.rules.players ?? []);
    this.hud.resetPlayers(["PLAYER 1", "PLAYER 2"]);
    this.dom = new HudDom(document, () => canvas.focus());
    this.touchingDom = new FoulNoticeDom(document, () => canvas.focus());
    this.touchingDom.element.classList.add("touching-notice");
    this.tools.className = "net-tools";
    this.tools.style.cssText = "position:fixed;top:116px;right:16px;z-index:300";
    this.audio = new BrowserAudio(this.bus, this.tools);
    document.body.append(this.dom.element, this.touchingDom.element, this.tools);
  }
  receive(message: ServerMessage): void {
    if (message.type === "event") this.events.receive(message);
  }
  update(dt: number, displayMs: number, placing: boolean): void {
    const s = this.session.latestSnapshot;
    if (!s) return;
    const names = [0, 1].map(seat => this.session.lobby?.players.find(p => p.seat === seat)?.name ?? `PLAYER ${seat + 1}`);
    const namesKey = JSON.stringify(names);
    if (namesKey !== this.namesKey) { this.namesKey = namesKey; this.hud.resetPlayers(names); }
    if (this.attempt !== s.match.attemptId) {
      this.attempt = s.match.attemptId; this.hud.foulNotice.close(); this.touching.close(); this.touchingKey = "";
    }
    this.audio.sync(this.session, s.version, false);
    this.events.consume(displayMs, message => {
      const event = message.event;
      if (event.type === "shot-impact") this.bus.emit("sim/impact", event.impact);
      if (event.type === "shot-settled" && event.foulCode) {
        this.hud.foulNotice.showFoul(event.score, getFoulDescription(event.foulCode));
        if (s.rules.decision?.canReplace) this.hud.foulNotice.head = "FOUL AND A MISS";
      }
    });
    this.hud.playerIndex = s.context.playerIndex;
    this.hud.scorePanel.setBallOn(s.context.ballOn);
    this.hud.scorePanel.syncResults(s.rules.players, s.context.playerIndex);
    this.hud.powerBar.percent = this.person.strokePower;
    const alpha = (1 - (this.launcher.busy ? this.launcher.motion.pullbackProgress : 0)) * this.person.camera.renderedRatio;
    this.hud.powerBar.autoAlpha = this.session.isLocalTurn() && !placing && alpha > .8 ? (alpha - .8) / .2 : 0;
    this.hud.shortcutsBar.group = this.person.camera.state;
    this.hud.shortcutsBar.active = this.session.canLaunch() && !placing && !this.launcher.busy;
    const key = `${s.match.attemptId}:${s.match.shotCount}:${s.rules.touching.join(",")}`;
    if (s.phase === "ready" && !s.pendingShot && s.rules.touching.length && !this.hud.foulNotice.active) {
      if (key !== this.touchingKey) { this.touchingKey = key; this.touching.show("TOUCHING BALL", "Play away without moving the touching ball."); }
    } else this.touching.close();
    if (!this.session.paused) { this.hud.update(dt); this.touching.update(dt); }
    this.dom.sync(this.hud); this.touchingDom.sync(this.touching);
  }
  dispose(): void { this.audio.dispose(); this.dom.element.remove(); this.touchingDom.element.remove(); this.tools.remove(); }
}
