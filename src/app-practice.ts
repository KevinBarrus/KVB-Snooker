import { GAME_STATE } from "./core/game.js";
import type { GameOptions } from "./core/frame-setup.js";
import type { PracticeShapeId } from "./core/practice/shapes.js";
import type { CustomShapeRecord } from "./core/practice/custom-shapes.js";
import { getFoulDescription } from "./core/rules/foul.js";
import type { BrowserGame } from "./app-game.js";

export class BrowserPractice {
  shapeId: PracticeShapeId | null = null;
  launchOptions: GameOptions = {};
  practiceChoicePending = false;
  practiceChoiceMessage = "";
  customShape: CustomShapeRecord | null = null;
  startedWithObjectBalls = false;
  completionPending = false;
  constructor(private readonly game: BrowserGame, private readonly resetAfterRestore: () => void,
    private readonly restartMode: () => boolean, private readonly openPlacement: () => void,
    private readonly focus: () => void) {}
  afterShot(): void {
    if (this.shapeId === "five-spots") {
      const pausePending = this.game.pause.view.phase === "waiting";
      this.restart();
      if (pausePending) this.game.pause.request();
      return;
    }
    const objectBalls = this.game.simulator.getBalls().filter(ball => ball.index > 0 && ball.active).length;
    if (this.customShape !== null) {
      if (this.startedWithObjectBalls && objectBalls === 0 && !this.completionPending) {
        this.completionPending = true;
        this.game.practiceCompletion.sync(true, this.game.session.canRestorePreviousShot);
        this.game.controls.update();
        return;
      }
      const shotResult = this.game.simulator.getResult();
      if (shotResult.pottedIndices.includes(0) || shotResult.outOfBoundsIndices.includes(0)) this.openPlacement();
      return;
    }
    if (this.shapeId !== null && this.startedWithObjectBalls && objectBalls === 0 && !this.completionPending) {
      this.completionPending = true;
      this.game.practiceCompletion.sync(true, this.game.session.canRestorePreviousShot);
      this.game.controls.update();
      return;
    }
    const foulCode = this.game.session.result.foulCode;
    if (foulCode === 0) return;
    this.practiceChoicePending = true;
    this.practiceChoiceMessage = `犯规：${getFoulDescription(foulCode)}。选择重摆或复位。`;
    this.game.controls.update();
    this.sync();
  }

  private get canRestore(): boolean {
    return (this.shapeId !== null || this.customShape !== null) && !this.practiceChoicePending &&
      this.game.session.state === GAME_STATE.READY && this.game.session.canRestorePreviousShot &&
      this.game.canReset;
  }

  sync(): void {
    const restoreVisible = this.shapeId !== null || this.customShape !== null;
    const choice = this.practiceChoicePending
      ? { message: this.practiceChoiceMessage, canRestore: this.game.session.canRestorePreviousShot }
      : null;
    this.game.practiceControls.sync(restoreVisible, this.canRestore, choice);
  }

  restore(): boolean {
    this.close();
    if ((this.shapeId === null && this.customShape === null) || !this.game.session.canRestorePreviousShot || this.game.session.state !== GAME_STATE.READY ||
        !this.game.canReset) return false;
    if (this.game.session.restorePreviousShot(this.game.session.context.playerIndex) === false) return false;
    this.practiceChoicePending = false;
    this.practiceChoiceMessage = "";
    this.resetAfterRestore();
    this.sync();
    this.focus();
    return true;
  }

  restart(): boolean {
    if (this.shapeId === null && this.customShape === null) return false;
    this.practiceChoicePending = false;
    this.close();
    return this.restartMode();
  }

  close(): void {
    this.completionPending = false;
    this.game.practiceCompletion.sync(false, false);
    this.game.controls.update();
  }

}
