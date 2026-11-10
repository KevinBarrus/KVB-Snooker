import { BrowserGameHud } from "./app-game-hud.js";
import { BrowserPractice } from "./app-practice.js";
import { LocalPause } from "./app-local-pause.js";
import * as B from "babylonjs/es6.js";
import { EventBus } from "./core/event-bus.js";
import { GameSession, GAME_STATE, type GameMode } from "./core/game.js";
import { AIController } from "./core/ai/task-pipeline.js";
import { AI_PROFILES } from "./core/ai/profiles.js";
import { createGameView } from "./core/ai/play-area.js";
import { coreRandom } from "./core/rng.js";
import { placementCommands, placeForAI } from "./app-placement.js";
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
import { FoulNoticeDom } from "./ui/foul-notice.js";
import { NominationDom } from "./ui/nomination.js";
import { PracticeControlsDom } from "./ui/practice-controls.js";
import { PracticeCompletionDom } from "./ui/practice-completion.js";
import type { CueBallStyle } from "./ui/game-menu.js";
import type { PracticeShapeId } from "./core/practice/shapes.js";
import type { CustomShapeRecord } from "./core/practice/custom-shapes.js";


// PCOL L3662-3772, L7594-7627, L7990-8031
export class BrowserGame {
  readonly bus = new EventBus();
  readonly human: PersonController;
  readonly opponent: PersonController;
  readonly shots: ShotController;
  readonly controls: GamingInput;
  readonly hud: Hud;
  readonly hudDom = new HudDom(document, () => this.canvas.focus());
  readonly viewNotice = new ViewNotice();
  readonly viewNoticeDom = new ViewNoticeDom(document, () => this.canvas.focus());
  readonly replay: BrowserReplay;
  readonly ruleChoice: RuleChoiceDom;
  readonly nomination: NominationDom;
  readonly practiceControls: PracticeControlsDom;
  readonly practiceCompletion: PracticeCompletionDom;
  onExitPractice?: () => void;
  private readonly display = new BrowserGameHud(this);
  readonly touchingNoticeDom = new FoulNoticeDom(document, () => this.canvas.focus());
  session: GameSession;
  private difficulty: keyof typeof AI_PROFILES = "NORMAL";
  private brain = new AIController(AI_PROFILES.NORMAL);
  private readonly ai: AIRunner;
  private pendingShot = false;
  private outSeen = 0;
  private nextOpeningIndex = 0;
  private cueBallStyle: CueBallStyle = "classic";
  private suspended = false;
  readonly pause: LocalPause;
  private readonly practice: BrowserPractice;
  private readonly disposeBus: () => void;
  constructor(readonly simulator: Simulator, private readonly scene: B.Scene,
    private readonly camera: B.TargetCamera, private readonly canvas: HTMLCanvasElement) {
    this.session = new GameSession(simulator, "practice");
    this.human = new PersonController(simulator, this.bus, simulator.ballRadius);
    this.opponent = new PersonController(simulator, new EventBus(), simulator.ballRadius, 1);
    try {
      const mode = localStorage.getItem("snk.shot-view");
      if (isShotViewMode(mode)) this.human.camera.shotView.mode = mode;
    } catch {}
    this.shots = new ShotController(this.bus, {
      advanceTime: dt => {
        const expiry = this.session.advanceTime(dt);
        if (expiry !== null) this.handleClockExpiry();
        return expiry === null || this.session.state === GAME_STATE.SIMULATING;
      },
      begin: index => {
        if (!this.canShoot(index)) return false;
        const person = this.human.active ? this.human : this.opponent;
        if (!this.session.prepareStroke(index, person.getStrokeVars())) {
          this.viewNotice.show(this.session.clock?.phase === "placement" ? "请先放置母球并确认，计时继续" : "目标不明确，请先提名彩球");
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
      },
      cancelled: () => {
        this.pendingShot = false; this.outSeen = 0;
        this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.controls.update();
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
    this.practice = new BrowserPractice(this, () => {
      this.controls.inHand.exit(); this.shots.finish(); this.human.camera.endShotView();
      this.human.gotoState0(true); this.opponent.gotoState0(true);
      this.outSeen = 0; this.pendingShot = false; this.display.touchingKey = ""; this.display.touchingMessage.close(); this.hud.foulNotice.close();
      this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.controls.update();
    }, () => this.setMode("practice", this.difficulty, this.practice.launchOptions, this.practice.shapeId, this.practice.customShape),
      () => this.openOpeningPlacement(), () => this.canvas.focus());
    this.controls = new GamingInput(canvas, this.human, this.shots, {
      state: () => this.pendingShot ? GAME_STATE.SIMULATING : this.session.state,
      canAim: () => {
        if (this.practice.practiceChoicePending || this.practice.completionPending) return false;
        if (!this.human.active || !this.canShoot(this.human.playerIndex)) return false;
        if (!simulator.getBallView(0).active) {
          this.viewNotice.show("母球需要先放到合法位置");
          return false;
        }
        if (this.session.clock?.phase === "placement" && !this.session.confirmPlacement(this.human.playerIndex)) {
          this.viewNotice.show("母球需要先放到合法位置");
          return false;
        }
        return true;
      },
      canPlace: () => this.human.active && this.canShoot(this.human.playerIndex) && this.session.context.inHand > 0,
      cycleView: () => this.cycleView(),
      locked: () => this.practice.practiceChoicePending || (this.pause?.blocksPlay ?? false)
    }, placementCommands(simulator, () => this.session, () => this.human.playerIndex,
      () => this.human.active && this.canShoot(this.human.playerIndex) && this.session.context.inHand > 0,
      (x, y) => {
        const bounds = canvas.getBoundingClientRect();
        return scene.createPickingRay(x - bounds.left, y - bounds.top, B.Matrix.Identity(), camera);
      }, () => { this.human.reanchorCueBall(); this.syncHud(); this.syncRuleChoice(); }, text => this.viewNotice.show(text)));
    this.hud = new Hud(() => this.session.players);
    this.hud.attach(this.bus);
    this.replay = new BrowserReplay(camera, canvas, () => this.captureReplay(),
      () => !this.pause?.blocksPlay && !this.shots.busy && !this.pendingShot && this.session.state === GAME_STATE.READY && !this.controls.inHand.active &&
        (this.session.ruleset !== "snooker-900" || this.session.finished),
      active => {
        this.controls.input.enabled = !active && !this.shots.inputLocked;
        this.hudDom.element.hidden = active;
      }, () => this.cycleView());
    const offImpact = simulator.onImpact(event => {
      this.bus.emit("sim/impact", event);
      this.replay.recordImpact(event);
    });
    const offShooting = this.bus.on("sim/shooting-start", () => {
      this.replay.begin();
      this.controls.update();
    });
    this.disposeBus = () => { offImpact(); offShooting(); };
    this.ruleChoice = new RuleChoiceDom(self => {
      const decision = this.session.decision;
      if (this.pause?.blocksPlay || !decision || this.session.players[decision.playerIndex].type !== "USER") return;
      if (!this.session.chooseNextPlayer(decision.playerIndex, self ? decision.playerIndex : 1 - decision.playerIndex)) return;
      this.hud.foulNotice.close();
      this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.canvas.focus();
    }, () => {
      const decision = this.session.decision;
      if (!decision || !this.canReset || this.session.players[decision.playerIndex].type !== "USER" ||
          !this.session.restorePreviousShot(decision.playerIndex)) return;
      this.controls.inHand.exit(); this.shots.finish(); this.replay.clear();
      this.human.camera.endShotView();
      this.human.gotoState0(true); this.opponent.gotoState0(true);
      this.brain = new AIController(AI_PROFILES[this.difficulty]);
      this.outSeen = 0;
      this.display.touchingKey = ""; this.display.touchingMessage.close();
      this.hud.foulNotice.close();
      this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.controls.update(); this.canvas.focus();
    });
    this.nomination = new NominationDom(index => {
      if (!this.canShoot(this.human.playerIndex) || !this.human.active) return;
      if (this.session.nominate(this.human.playerIndex, index)) this.canvas.focus();
    });
    this.touchingNoticeDom.element.classList.add("touching-notice");
    this.touchingNoticeDom.element.setAttribute("role", "status");
    this.practiceControls = new PracticeControlsDom(
      () => this.practice.restore(),
      () => this.practice.restart()
    );
    this.practiceCompletion = new PracticeCompletionDom({
      restart: () => this.practice.restart(),
      restore: () => { this.practice.close(); this.practice.restore(); },
      continuePlaying: () => this.practice.close(),
      exit: () => { this.practice.close(); this.onExitPractice?.(); }
    });
    document.body.append(this.touchingNoticeDom.element, this.hudDom.element, this.viewNoticeDom.element,
      this.ruleChoice.element, this.nomination.element, this.practiceControls.element, this.practiceCompletion.element);
    this.pause = new LocalPause(this, canvas);
    this.activateTurn();
    this.openOpeningPlacement();
    this.syncHud();
  }
  get activePerson(): PersonController { return this.shots.launchingController ?? (this.human.active ? this.human : this.opponent); }
  get cueBallRedDots(): boolean {
    return this.session.ruleset === "snooker-900" || this.cueBallStyle === "red-dot";
  }
  setCueBallStyle(style: CueBallStyle): void { this.cueBallStyle = style; }
  get canReset(): boolean { return !this.pause?.blocksPlay && !this.shots.busy && !this.pendingShot && !this.replay.active; }
  get touchingNotice(): string { return this.display.touchingNotice; }
  get aimBallOn(): number {
    const vars = this.human.getStrokeVars();
    const index = this.session.getNomination(vars[3], vars[5]).ballIndex;
    return index === null ? this.session.context.ballOn : 2 ** this.simulator.getBallView(index).number;
  }
  cycleView(): void {
    if (this.pause?.blocksPlay || (!this.replay.active && !this.human.active)) return;
    const view = this.human.camera.shotView;
    const mode = view.mode === "natural" ? "cue" : view.mode === "cue" ? "object" : "natural";
    if (this.replay.active) { view.mode = mode; this.replay.setMode(mode); }
    else view.setMode(mode, this.human.camera.target);
    this.viewNotice.show({ natural: "自然起身", cue: "视线跟随母球", object: "视线跟随子球" }[mode]);
    this.viewNoticeDom.sync(this.viewNotice);
    try { localStorage.setItem("snk.shot-view", mode); } catch {}
  }
  private canShoot(index: number): boolean {
    return !this.pause?.blocksPlay && !this.replay?.active && !this.pendingShot && this.session.state === GAME_STATE.READY && !this.session.finished && this.session.context.playerIndex === index;
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
    if (this.opponent.active) {
      this.opponent.playerIndex = index;
      if (this.session.clock) {
        if (this.session.clock.phase === "placement") placeForAI(this.session, this.simulator, this.opponent.playerIndex);
        this.brain = new AIController(AI_PROFILES[this.difficulty]);
      }
      this.ai.activate();
    }
    if (this.human.active && this.session.clock?.phase === "placement") this.controls.inHand.enter();
  }
  private openOpeningPlacement(): void {
    if (!this.human.active || this.session.context.inHand === 0 || this.controls.inHand.active) return;
    this.controls.inHand.enter();
  }
  private syncRuleChoice(): void { this.display.syncRules(this.canShoot(this.human.playerIndex)); }
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.practice.close();
    this.display.suspend(suspended);
  }
  get isSuspended(): boolean { return this.suspended; }
  setMode(mode: GameMode, difficulty: keyof typeof AI_PROFILES = "NORMAL", options: GameOptions = {},
    shapeId: PracticeShapeId | null = null, customShape: CustomShapeRecord | null = null): boolean {
    if (!this.canReset) return false;
    this.controls.inHand.exit();
    this.shots.finish();
    this.human.camera.endShotView();
    this.replay.clear();
    this.practice.shapeId = shapeId;
    this.practice.customShape = customShape;
    this.practice.launchOptions = options;
    this.practice.practiceChoicePending = false;
    this.practice.practiceChoiceMessage = "";
    this.practice.completionPending = false;
    this.practice.startedWithObjectBalls = options.setup?.balls.some(ball => ball.active && ball.index > 0) ?? false;
    this.practiceCompletion.sync(false, false);
    const formal = mode === "single-play" && !options.setup;
    this.session = new GameSession(this.simulator, mode, formal
      ? { ...options, openingPlayerIndex: options.openingPlayerIndex ?? this.nextOpeningIndex } : options);
    this.pause.reset();
    if (formal) this.nextOpeningIndex = 1 - this.session.openingPlayerIndex;
    this.display.touchingKey = ""; this.display.touchingMessage.close();
    this.difficulty = difficulty;
    this.brain = new AIController(AI_PROFILES[difficulty]);
    this.human.gotoState0(true); this.opponent.gotoState0(true);
    this.hud.foulNotice.close();
    this.activateTurn();
    if (!options.setup || this.session.mode === "practice") this.openOpeningPlacement();
    this.syncHud(); this.syncRuleChoice(); this.controls.update(); this.practice.sync();
    this.canvas.focus();
    return true;
  }
  private syncHud(): void { this.display.syncHud(this.practice.customShape !== null); }
  private judge(): void {
    const result = this.simulator.getResult();
    const before = Array.from({ length: this.simulator.getBallCount() }, (_, i) => this.simulator.getBallView(i));
    this.replay.finish();
    this.session.step(0);
    const missed = this.session.decision?.canReplace ?? false;
    if (this.session.state !== GAME_STATE.READY && this.session.state !== GAME_STATE.DECIDING) return;
    if (this.session.clock) this.shots.launchingController?.gotoState0();
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
    if (missed) this.hud.foulNotice.head = "FOUL AND A MISS";
    if (this.practice.shapeId !== null || this.practice.customShape !== null) this.afterPracticeShot();
  }
  private afterPracticeShot(): void { this.practice.afterShot(); }
  private handleClockExpiry(): void {
    if (this.session.state === GAME_STATE.SIMULATING) return;
    this.pendingShot = false; this.outSeen = 0;
    this.shots.finish(); this.controls.inHand.exit();
    this.replay.clear();
    this.human.gotoState0(true); this.opponent.gotoState0(true);
    this.hud.foulNotice.close();
    const { foulCode, score } = this.session.result;
    if (foulCode) this.bus.emit("game/foul", { foulCode, score, description: getFoulDescription(foulCode) });
    this.activateTurn(); this.syncHud(); this.syncRuleChoice(); this.controls.update();
  }
  update(dt: number): void {
    if (this.suspended) return;
    dt = this.pause.update(dt);
    if (this.pause.blocksPlay) return;
    this.human.camera.shotView.smoothing.aspect = this.scene.getEngine().getAspectRatio(this.camera);
    this.human.camera.shotView.smoothing.verticalFov = this.camera.fov;
    this.display.update(dt);
    this.syncRuleChoice(); this.practice.sync();
    if (this.replay.active) { this.replay.update(dt); return; }
    let remaining = dt;
    do {
      const slice = this.session.clock ? Math.min(remaining, 1 / 30, this.session.timeUntilExpiry) : remaining;
      if (this.session.clock) this.hud.update(slice);
      this.controls.update();
      if (!this.session.clock || this.session.clock.phase === "aiming") this.ai.update(slice);
      this.shots.update(slice, step => { this.human.update(step); this.opponent.update(step); this.replay.record(step); });
      if (this.session.state === GAME_STATE.SIMULATING && (this.session.clock || this.shots.canJudge) &&
          this.simulator.nAwakened === 0) this.judge();
      remaining -= slice;
      this.pause.update(0);
      if (this.pause.blocksPlay) return;
      if (this.session.finished || slice === 0) break;
    } while (remaining > 1e-9);
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
    this.hud.matchClock.sync(this.session.clock);
    if (!this.session.clock) this.hud.update(dt);
    this.hudDom.sync(this.hud);
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
    this.pause.dispose();
    this.controls.dispose(); this.disposeBus();
    this.hud.detach(); this.hudDom.element.remove(); this.shots.finish();
    this.viewNoticeDom.element.remove();
    this.replay.dispose();
    this.practiceControls.dispose();
    this.practiceCompletion.dispose();
    this.ruleChoice.dispose();
    this.nomination.dispose();
    this.touchingNoticeDom.element.remove();
  }
}
