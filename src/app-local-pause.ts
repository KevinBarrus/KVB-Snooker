import { MatchPause } from "./core/match-pause.js";
import { PausePanel } from "./ui/pause-panel.js";
import type { BrowserGame } from "./app-game.js";

export class LocalPause {
  private state: MatchPause;
  private readonly panel: PausePanel;

  constructor(private readonly game: BrowserGame, private readonly canvas: HTMLCanvasElement) {
    this.state = this.createState();
    this.panel = new PausePanel(() => this.ready(), () => canvas.focus());
    this.sync();
  }

  get view() { return this.state.view; }
  get blocksPlay(): boolean { return this.state.blocksPlay; }

  request(): boolean {
    if (this.game.isSuspended || this.game.session.finished || this.game.replay.active) return false;
    const player = this.requester();
    if (!this.state.request(player)) {
      this.game.viewNotice.show("本局暂停次数已用完，或正在等待暂停");
      return false;
    }
    if (this.state.policy.players === 2) this.state.respond(1 - player, true);
    this.update(0);
    return true;
  }

  update(seconds: number): number {
    const wasBlocked = this.blocksPlay;
    const elapsed = this.state.advance(seconds, !this.game.shots.busy && this.game.session.canPause, this.game.session.finished);
    if (this.blocksPlay || wasBlocked) this.game.controls.input.enabled = false;
    this.sync();
    if (wasBlocked && !this.blocksPlay) { this.game.controls.update(); this.canvas.focus(); }
    return elapsed;
  }

  ready(): void {
    const player = this.state.view.requester;
    if (player === null || !this.state.ready(player)) return;
    if (this.state.policy.players === 2) this.state.ready(1 - player);
    this.sync();
  }

  reset(): void { this.state = this.createState(); this.sync(); }
  dispose(): void { this.panel.dispose(); }

  private createState(): MatchPause {
    const timed = this.game.session.ruleset === "snooker-900";
    return new MatchPause({ players: this.game.session.players.length, maxPerPlayer: timed ? 1 : null,
      maxSeconds: timed ? 180 : null, countdownSeconds: 3 });
  }

  private requester(): number {
    return this.game.session.players.every(player => player.type === "USER") ? this.game.session.context.playerIndex
      : this.game.session.players.findIndex(player => player.type === "USER");
  }

  private sync(): void { this.panel.sync(this.state.view, this.state.view.requester ?? this.requester(), true, false, false); }
}
