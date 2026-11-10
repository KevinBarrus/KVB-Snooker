import { Input } from "./input.js";
import { InHand, type PlacementCommands } from "./in-hand.js";
import type { PersonController } from "./person-controller.js";
import type { ShotLauncher } from "./shot-controller.js";

export interface InputGame {
  state(): number;
  canAim(): boolean;
  canPlace(): boolean;
  cycleView?(): void;
  /** 练习犯规选择等装配根需要暂时锁住输入时返回 true。 */
  locked?(): boolean;
}

// PCOL L6130-6230, L4177-4345
export class GamingInput {
  readonly input: Input;
  readonly inHand: InHand;

  constructor(canvas: HTMLElement, private readonly person: PersonController,
    private readonly shots: ShotLauncher, private readonly game: InputGame, private readonly placement: PlacementCommands) {
    const camera = person.camera;
    const all = 4 | 8 | 16;
    this.inHand = new InHand(camera, placement);
    this.input = new Input(canvas, {
      "86": { states: all, down: () => game.cycleView?.() },
      "68|39": { states: all, down: () => camera.orbit(undefined, 1), up: () => camera.orbit(undefined, 0) },
      "65|37": { states: all, down: () => camera.orbit(1), up: () => camera.orbit(0) },
      "87|38": { states: 4, down: () => this.aim() },
      "83|40": { states: 4 | 8, down: () => { if (!this.inHand.active) person.gotoState0(); } },
      "88": { states: all, down: () => { if (!this.inHand.active) camera.squatDown(); }, up: () => camera.standUp() },
      "82": { states: all, down: () => { if (!this.inHand.active) camera.resetLookAt(); } },
      "67": { states: 4, down: () => { if (!this.inHand.active) person.stick.clearTip(camera.state === 1); } },
      "80": { states: 4, down: () => this.pickUp() },
      "27": { states: 4, down: () => this.finishPlacement() },
      "32": { states: 4, down: () => { if (!this.inHand.active && game.canAim()) shots.launch(person); } }
    }, {
      drag: { states: all, run: (dx, dy, modifier) => {
        if (!this.inHand.active && modifier) {
          if (camera.state === 1) person.stick.moveLocTip(-dx, -dy);
        } else camera.moveLookAt(0.0025 * dx, 0.0025 * dy);
      } },
      wheel: { states: 4, run: (delta, modifier) => {
        if (this.inHand.active || camera.state === 0) return;
        if (modifier) person.stick.moveAngleV(-2e-4 * delta);
        else person.strokePower += 1e-4 * delta;
      } },
      move: { states: 4, run: (x, y) => { if (this.inHand.active) this.inHand.move(x, y); } },
      click: { states: 4, run: (x, y) => { if (this.inHand.active) this.inHand.click(x, y); } }
    });
    this.update();
  }

  aim(): void {
    if (!this.game.canAim()) return;
    this.inHand.exit();
    this.person.gotoState1();
  }

  pickUp(): void {
    if (this.inHand.active) { this.finishPlacement(); return; }
    if (this.game.canPlace() && !this.shots.busy) this.inHand.enter();
  }

  update(): void {
    this.input.state = this.game.state();
    this.input.enabled = !this.shots.inputLocked && !(this.game.locked?.() ?? false);
    if (!this.game.canPlace()) this.inHand.exit();
    this.inHand.update();
  }

  dispose(): void { this.input.dispose(); this.inHand.exit(); }

  private finishPlacement(): void {
    if (!this.inHand.active) return;
    if (this.placement.end?.() === false) return;
    this.inHand.exit();
  }
}
