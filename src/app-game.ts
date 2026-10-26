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
import { BrowserReplay } from "./app-replay.js";
import type { ReplayCapture } from "./controller/replay-frame.js";
import type { GameOptions } from "./core/frame-setup.js";
import { RuleChoiceDom } from "./ui/rule-choice.js";
import { NominationDom } from "./ui/nomination.js";

const BALL_NAMES = ["母球", "红球", "黄球", "绿球", "棕球", "蓝球", "粉球", "黑球"];

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
  readonly replay: BrowserReplay;
  readonly ruleChoice: RuleChoiceDom;
  readonly nomination: NominationDom;
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
        const person = this.human.active ? this.human : this.opponent;
        if (!this.session.prepareStroke(index, person.getStrokeVars())) {
          this.viewNotice.show("目标不明确，请先提名彩球");
          return false;
        }
        this.pendingShot = true; this.outSeen = simulator.getResult().outOfBoundsIndices.length;
        return true;
      },
      stroke: (index, vars) => {
        if (!this.pendingShot || !this.session.stroke(index, vars)) return false;
        this.pendingShot = false; this.outSeen = 0;
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
      next: () => {
        const route = this.brain.step(gameView, simulator);
        if (route && this.session.context.ballOn === 252) this.session.nominate(this.opponent.playerIndex, route.ballBIndex ?? null);
        return route;
      },
      random: coreRandom
    });
    this.controls = new GamingInput(canvas, this.human, this.shots, {
      state: () => this.pendingShot ? GAME_STATE.SIMULATING : this.session.state,
      canAim: () => this.human.active && this.canShoot(this.human.playerIndex),
      canPlace: () => this.human.active && this.canShoot(this.human.playerIndex) && this.session.context.inHand > 0,
      cycleView: () => this.cycleView()
    }, {
      ray: (x, y) => {
        const bounds = canvas.getBoundingClientRect();
        return scene.createPickingRay(x - bounds.left, y - bounds.top, B.Matrix.Identity(), camera);
      },
      valid: point => this.ref.placeCueBallCheck(point.x, simulator.spotY, point.z, simulator),
      place: point => {
        if (!this.human.active || !this.canShoot(this.human.playerIndex) || this.session.context.inHand <= 0) return false;
        const placed = this.session.placeCueBall(point.x, simulator.spotY, point.z);
        if (placed) { this.human.activate(); this.syncHud(); }
        return placed;
      }
    });
    this.hud = new Hud(() => this.session.players);
    this.hud.attach(this.bus);
    this.replay = new BrowserReplay(camera, canvas, () => this.captureReplay(),
      () => !this.shots.busy && !this.pendingShot && this.session.state === GAME_STATE.READY && !this.controls.inHand.active,
      active => {
        this.controls.input.enabled = !active && !this.shots.inputLocked;
        this.hudDom.element.hidden = active;
      }, () => this.cycleView());
    this.disposeBus = this.bus.on("sim/shooting-start", () => {
      this.replay.begin();
      this.controls.update();
    });
    this.ruleChoice = new RuleChoiceDom(self => {
      const decision = this.session.decision;
      if (!decision || this.session.players[decision.playerIndex].type !== "USER") return;
      if (!this.session.chooseNextPlayer(decision.playerIndex, self ? decision.playerIndex : 1 - decision.playerIndex)) return;
      this.hud.foulNotice.close();
      this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.canvas.focus();
    });
    this.nomination = new NominationDom(index => {
      if (!this.canShoot(this.human.playerIndex) || !this.human.active) return;
      if (this.session.nominate(this.human.playerIndex, index)) this.canvas.focus();
    });
    document.body.append(this.hudDom.element, this.viewNoticeDom.element, this.ruleChoice.element, this.nomination.element);
    this.activateTurn(); this.syncHud();
  }

  get activePerson(): PersonController { return this.shots.launchingController ?? (this.human.active ? this.human : this.opponent); }

  get canReset(): boolean { return !this.shots.busy && !this.pendingShot && !this.replay.active; }

  get touchingNotice(): string {
    if (!this.human.active || this.shots.busy || this.session.mode === "practice") return "";
    const indices = this.session.touchingBallIndices;
    if (!indices.length) return "";
    const names = [...new Set(indices.map(index => BALL_NAMES[this.simulator.getBallView(index).number]))].join("、");
    return `贴球：${names} · 请打离且不要推动贴球；贴合法目标可免再次首碰，贴非目标仍需打到目标`;
  }

  get aimBallOn(): number {
    const vars = this.human.getStrokeVars();
    const index = this.session.getNomination(vars[3], vars[5]).ballIndex;
    return index === null ? this.session.context.ballOn : 2 ** this.simulator.getBallView(index).number;
  }

  cycleView(): void {
    if (!this.replay.active && !this.human.active) return;
    const view = this.human.camera.shotView;
    const mode = view.mode === "natural" ? "cue" : view.mode === "cue" ? "object" : "natural";
    if (this.replay.active) { view.mode = mode; this.replay.setMode(mode); }
    else view.setMode(mode, this.human.camera.target);
    this.viewNotice.show({ natural: "自然起身", cue: "视线跟随母球", object: "视线跟随子球" }[mode]);
    this.viewNoticeDom.sync(this.viewNotice);
    try { localStorage.setItem("snk.shot-view", mode); } catch {}
  }

  private canShoot(index: number): boolean {
    return !this.replay?.active && !this.pendingShot && this.session.state === GAME_STATE.READY && !this.session.finished && this.session.context.playerIndex === index;
  }

  private activateTurn(): void {
    const decision = this.session.decision;
    if (decision && this.session.players[decision.playerIndex].type === "AI") {
      this.session.chooseNextPlayer(decision.playerIndex, decision.playerIndex);
    }
    const index = this.session.context.playerIndex;
    const ready = this.session.state === GAME_STATE.READY && !this.session.finished;
    this.human.active = this.session.players[index].type === "USER" && ready;
    this.opponent.active = this.session.players[index].type === "AI" && ready;
    if (this.human.active) { this.human.playerIndex = index; this.human.activate(); }
    if (this.opponent.active) { this.opponent.playerIndex = index; this.ai.activate(); }
  }

  private syncRuleChoice(): void {
    const decision = this.session.decision;
    this.ruleChoice.sync(decision && !this.replay.active ? {
      text: decision.kind === "black" ? `比分相同，重新摆黑。玩家 ${decision.playerIndex + 1} 抽中选择权。下一位获得 D 区手中球。`
        : `犯规罚 ${-this.session.result.score} 分，已入账。玩家 ${decision.playerIndex + 1} 选择下一杆。${this.session.freeBallAvailable ? "接手可选择自由球。" : ""}`,
      ownLabel: decision.kind === "black" ? "自己先打" : "自己接手",
      otherLabel: decision.kind === "black" ? "让对方先打" : "让对手继续（当前位置）"
    } : null);
    const free = this.session.freeBallAvailable;
    if ((!free && this.session.context.ballOn !== 252) || !this.human.active || this.replay.active) {
      this.nomination.sync(null);
      return;
    }
    const vars = this.human.getStrokeVars();
    const nomination = this.session.getNomination(vars[3], vars[5]);
    const options = Array.from({ length: this.simulator.getBallCount() }, (_, index) => this.simulator.getBallView(index))
      .filter(ball => ball.active && ball.number > 0 && (free ? (2 ** ball.number & this.session.context.ballOn) === 0 : ball.number > 1))
      .map(ball => ({ index: ball.index, label: BALL_NAMES[ball.number] }));
    const label = options.find(option => option.index === nomination.ballIndex)?.label;
    this.nomination.sync((nomination.required || free) && this.human.active && !this.replay.active ? {
      text: free ? (label ? `自由球：${label}，按 ${Math.log2(this.session.context.ballOn)} 分计` : "可选自由球；不使用则击打原目标")
        : label ? `本杆目标：${label}${nomination.manual ? "（已提名）" : "（自动）"}` : "目标不明确，请选择彩球",
      defaultLabel: free ? "不使用自由球" : "自动识别",
      selected: nomination.manual ? nomination.ballIndex : null,
      enabled: this.canShoot(this.human.playerIndex), options
    } : null);
  }

  setMode(mode: GameMode, difficulty: keyof typeof AI_PROFILES = "NORMAL", options: GameOptions = {}): boolean {
    if (!this.canReset) return false;
    this.controls.inHand.exit();
    this.shots.finish();
    this.human.camera.endShotView();
    this.replay.clear();
    this.session = new GameSession(this.simulator, mode, options);
    this.brain = new AIController(AI_PROFILES[difficulty]);
    this.human.gotoState0(true); this.opponent.gotoState0(true);
    this.hud.foulNotice.close();
    this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.controls.update();
    this.canvas.focus();
    return true;
  }

  private syncHud(): void {
    const { playerIndex, ballOn, inHand } = this.session.context;
    const allLocal = this.session.players.length === 2 && this.session.players.every(player => player.type === "USER");
    this.hud.resetPlayers(this.session.players.map((player, index) => allLocal ? `玩家 ${index + 1}` : player.type === "USER" ? "PLAYER" : "PCOL AI"));
    this.hud.playerIndex = playerIndex;
    this.hud.scorePanel.setPlayerIndex(playerIndex);
    this.bus.emit("game/ball-on-changed", { ballOn, inHand });
    this.bus.emit("game/frame-events", { potted: [], respotted: [] });
  }

  private judge(): void {
    const result = this.simulator.getResult();
    const before = Array.from({ length: this.simulator.getBallCount() }, (_, i) => this.simulator.getBallView(i));
    this.replay.finish();
    this.session.step(0);
    if (this.session.state !== GAME_STATE.READY && this.session.state !== GAME_STATE.DECIDING) return;
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
    this.syncRuleChoice();
    if (this.replay.active) { this.replay.update(dt); return; }
    this.controls.update();
    this.ai.update(dt);
    this.shots.update(dt, step => { this.human.update(step); this.opponent.update(step); this.replay.record(step); });
    if (this.shots.canJudge && !Array.from({ length: this.simulator.getBallCount() }, (_, i) => this.simulator.getBallView(i)).some(ball => ball.async)) this.judge();
    if (!this.shots.busy && this.human.active && this.canShoot(this.human.playerIndex)) this.human.updatePrediction();
    this.camera.position.copyFrom(this.human.camera.position);
    this.camera.lockedTarget = this.human.camera.target;
    this.controls.update();
    this.hud.powerBar.percent = this.human.strokePower;
    const alpha = (1 - (this.shots.busy ? this.shots.motion.pullbackProgress : 0)) * this.human.camera.renderedRatio;
    this.hud.powerBar.autoAlpha = this.human.active && alpha > 0.8 ? (alpha - 0.8) / 0.2 : 0;
    this.hud.shortcutsBar.active = !this.controls.inHand.active && this.human.active && this.canShoot(this.human.playerIndex) && !this.shots.busy &&
      (this.human.camera.stateRatio === 0 || this.human.camera.stateRatio === 1);
    this.hud.shortcutsBar.group = this.human.camera.state;
    this.hud.update(dt); this.hudDom.sync(this.hud);
    this.replay.sync();
  }

  getDisplayBallView(index: number): ReturnType<Simulator["getBallView"]> {
    return this.replay.active ? this.replay.clip.getBallView(index) : this.simulator.getBallView(index);
  }

  private captureReplay(): ReplayCapture {
    const camera = this.human.camera, person = this.activePerson;
    const point = (value: { x: number; y: number; z: number }) => ({ x: value.x, y: value.y, z: value.z });
    return { balls: Array.from({ length: this.simulator.getBallCount() }, (_, index) => this.simulator.getBallView(index)),
      eye: point(camera.position), target: point(camera.target), aimRatio: camera.renderedRatio,
      struck: !this.pendingShot, firstKissIndex: this.pendingShot ? 0 : this.simulator.getResult().firstKissIndex,
      cue: { visible: person.camera.stateRatio > 0, position: point(person.stick.position), yaw: person.stick.rotation.y, pitch: person.stick.rotation.z } };
  }

  dispose(): void {
    this.controls.dispose(); this.disposeBus();
    this.hud.detach(); this.hudDom.element.remove(); this.shots.finish();
    this.viewNoticeDom.element.remove();
    this.replay.dispose();
    this.ruleChoice.dispose();
    this.nomination.dispose();
  }
}
