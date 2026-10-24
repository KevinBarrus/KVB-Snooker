import * as B from "babylonjs/es6.js";
import { EventBus } from "./core/event-bus.js";
import { GameSession, GAME_STATE, type GameMode } from "./core/game.js";
import { AIController } from "./core/ai/task-pipeline.js";
import { AI_PROFILES } from "./core/ai/profiles.js";
import { createGameView } from "./core/ai/play-area.js";
import { coreRandom } from "./core/rng.js";
import { SnookerRef } from "./core/rules/snooker.js";
import { getFoulDescription } from "./core/rules/foul.js";
import type { Simulator } from "./core/simulator/simulator.js";
import { PersonController } from "./controller/person-controller.js";
import { ShotController } from "./controller/shot-controller.js";
import { GamingInput } from "./controller/gaming-input.js";
import { AIRunner } from "./controller/ai-runner.js";
import { Hud, HudDom } from "./ui/hud.js";
import { ViewNotice, ViewNoticeDom } from "./ui/view-notice.js";
import { isShotViewMode } from "./controller/shot-view.js";

// PCOL L3662-3772, L7594-7627, L7990-8031
export class BrowserGame {
  readonly bus = new EventBus();
  readonly human: PersonController;
  readonly opponent: PersonController;
  readonly shots: ShotController;
  readonly controls: GamingInput;
  readonly hud: Hud;
  readonly hudDom = new HudDom();
  readonly viewNotice = new ViewNotice();
  readonly viewNoticeDom = new ViewNoticeDom();
  session: GameSession;
  private readonly ref = new SnookerRef();
  private brain = new AIController(AI_PROFILES.NORMAL);
  private readonly ai: AIRunner;
  private pendingShot = false;
  private outSeen = 0;
  private readonly disposeBus: () => void;

  constructor(readonly simulator: Simulator, private readonly scene: B.Scene,
    private readonly camera: B.TargetCamera, private readonly canvas: HTMLCanvasElement) {
    this.session = new GameSession(simulator, "practice");
    this.ref.syncAreaWithSimulator(simulator);
    this.human = new PersonController(simulator, this.bus, simulator.ballRadius);
    this.opponent = new PersonController(simulator, new EventBus(), simulator.ballRadius, 1);
    try {
      const mode = localStorage.getItem("snk.shot-view");
      if (isShotViewMode(mode)) this.human.camera.shotView.mode = mode;
    } catch {}
    this.shots = new ShotController(this.bus, {
      begin: index => {
        if (!this.canShoot(index)) return false;
        this.pendingShot = true; this.outSeen = simulator.getResult().outOfBoundsIndices.length;
        return true;
      },
      stroke: (index, vars) => {
        if (!this.pendingShot || !this.session.stroke(index, vars)) return false;
        this.pendingShot = false; this.outSeen = 0;
        this.human.camera.shotView.struck = true;
        return true;
      },
      step: dt => {
        if (!this.pendingShot && this.session.state !== GAME_STATE.SIMULATING) return;
        simulator.step(dt);
        const result = simulator.getResult();
        while (this.outSeen < result.outOfBoundsIndices.length) {
          const index = result.outOfBoundsIndices[this.outSeen++];
          this.bus.emit("sim/out-of-bounds", { ballIndex: index, ballNumber: simulator.getBallView(index).number });
        }
      }
    });
    const gameView = createGameView(simulator);
    this.ai = new AIRunner(this.opponent, this.shots, this.bus, {
      restart: () => this.brain.checkRestart(simulator, this.session.context),
      next: () => this.brain.step(gameView, simulator),
      random: coreRandom
    });
    this.controls = new GamingInput(canvas, this.human, this.shots, {
      state: () => this.pendingShot ? GAME_STATE.SIMULATING : this.session.state,
      canAim: () => this.canShoot(0),
      canPlace: () => this.canShoot(0) && this.session.context.inHand > 0,
      cycleView: () => this.cycleView()
    }, {
      ray: (x, y) => {
        const bounds = canvas.getBoundingClientRect();
        return scene.createPickingRay(x - bounds.left, y - bounds.top, B.Matrix.Identity(), camera);
      },
      valid: point => this.ref.placeCueBallCheck(point.x, simulator.spotY, point.z, simulator),
      place: point => {
        if (!this.canShoot(0) || this.session.context.inHand <= 0) return false;
        const placed = this.session.placeCueBall(point.x, simulator.spotY, point.z);
        if (placed) { this.human.activate(); this.syncHud(); }
        return placed;
      }
    });
    this.hud = new Hud(() => this.session.players);
    this.hud.attach(this.bus);
    this.disposeBus = this.bus.on("sim/shooting-start", ({ playerIndex }) => {
      if (playerIndex !== 0) this.human.camera.beginShotView();
      this.controls.update();
    });
    document.body.append(this.hudDom.element, this.viewNoticeDom.element);
    this.activateTurn(); this.syncHud();
  }

  get activePerson(): PersonController { return this.shots.launchingController ?? (this.session.context.playerIndex === 0 ? this.human : this.opponent); }

  cycleView(): void {
    const view = this.human.camera.shotView;
    const mode = view.mode === "natural" ? "cue" : view.mode === "cue" ? "object" : "natural";
    view.setMode(mode, this.human.camera.target);
    this.viewNotice.show({ natural: "自然起身", cue: "视线跟随母球", object: "视线跟随子球" }[mode]);
    this.viewNoticeDom.sync(this.viewNotice);
    try { localStorage.setItem("snk.shot-view", mode); } catch {}
  }

  private canShoot(index: number): boolean {
    return !this.pendingShot && this.session.state === GAME_STATE.READY && !this.session.finished && this.session.context.playerIndex === index;
  }

  private activateTurn(): void {
    this.human.active = this.session.context.playerIndex === 0 && !this.session.finished;
    this.opponent.active = this.session.context.playerIndex === 1 && !this.session.finished;
    if (this.human.active) this.human.activate();
    if (this.opponent.active) this.ai.activate();
  }

  setMode(mode: GameMode, difficulty: keyof typeof AI_PROFILES = "NORMAL"): boolean {
    if (this.shots.busy) return false;
    this.controls.inHand.exit();
    this.shots.finish();
    this.human.camera.endShotView();
    this.session = new GameSession(this.simulator, mode);
    this.brain = new AIController(AI_PROFILES[difficulty]);
    this.human.gotoState0(true); this.opponent.gotoState0(true);
    this.activateTurn(); this.syncHud(); this.controls.update();
    this.canvas.focus();
    return true;
  }

  private syncHud(): void {
    const { playerIndex, ballOn, inHand } = this.session.context;
    this.hud.resetPlayers(this.session.players.map(player => player.type === "USER" ? "PLAYER" : "PCOL AI"));
    this.hud.playerIndex = playerIndex;
    this.hud.scorePanel.setPlayerIndex(playerIndex);
    this.bus.emit("game/ball-on-changed", { ballOn, inHand });
    this.bus.emit("game/frame-events", { potted: [], respotted: [] });
  }

  private judge(): void {
    const result = this.simulator.getResult();
    const before = Array.from({ length: this.simulator.getBallCount() }, (_, i) => this.simulator.getBallView(i));
    this.session.step(0);
    if (this.session.state !== GAME_STATE.READY) return;
    this.shots.finish();
    this.human.camera.endShotView();
    this.human.camera.unfollow();
    this.activateTurn();
    const respotted = before.filter(ball => {
      const after = this.simulator.getBallView(ball.index);
      return after.active && (!ball.active || after.position.distanceToSq(ball.position) > 1e-10);
    }).map(ball => ball.index);
    const { ballOn, inHand, playerIndex } = this.session.context;
    this.hud.playerIndex = playerIndex;
    this.hud.scorePanel.setPlayerIndex(playerIndex);
    this.bus.emit("game/ball-on-changed", { ballOn, inHand });
    this.bus.emit("game/frame-events", { potted: result.pottedIndices, respotted });
    const { foulCode, score } = this.session.result;
    if (foulCode) this.bus.emit("game/foul", { foulCode, score, description: getFoulDescription(foulCode) });
  }

  update(dt: number): void {
    this.human.camera.shotView.smoothing.aspect = this.scene.getEngine().getAspectRatio(this.camera);
    this.human.camera.shotView.smoothing.verticalFov = this.camera.fov;
    this.viewNotice.update(dt); this.viewNoticeDom.sync(this.viewNotice);
    this.controls.update();
    this.ai.update(dt);
    this.shots.update(dt, step => { this.human.update(step); this.opponent.update(step); });
    if (this.shots.canJudge && !Array.from({ length: this.simulator.getBallCount() }, (_, i) => this.simulator.getBallView(i)).some(ball => ball.async)) this.judge();
    if (!this.shots.busy && this.canShoot(0)) this.human.updatePrediction();
    this.camera.position.copyFrom(this.human.camera.position);
    this.camera.lockedTarget = this.human.camera.target;
    this.controls.update();
    this.hud.powerBar.percent = this.human.strokePower;
    const alpha = (1 - (this.shots.busy ? this.shots.motion.pullbackProgress : 0)) * this.human.camera.renderedRatio;
    this.hud.powerBar.autoAlpha = this.human.active && alpha > 0.8 ? (alpha - 0.8) / 0.2 : 0;
    this.hud.shortcutsBar.active = !this.controls.inHand.active && this.canShoot(0) && !this.shots.busy &&
      (this.human.camera.stateRatio === 0 || this.human.camera.stateRatio === 1);
    this.hud.shortcutsBar.group = this.human.camera.state;
    this.hud.update(dt); this.hudDom.sync(this.hud);
  }

  dispose(): void {
    this.controls.dispose(); this.disposeBus();
    this.hud.detach(); this.hudDom.element.remove(); this.shots.finish();
    this.viewNoticeDom.element.remove();
  }
}
