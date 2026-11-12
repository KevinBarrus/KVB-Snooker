import type * as B from "babylonjs/es6.js";
import type { BrowserGame } from "./app-game.js";
import { Input } from "./controller/input.js";
import { CinemaCamera } from "./render/cinema-camera.js";
import { VisualControls, VisualControlsDom, type VisualView } from "./ui/visual-controls.js";

export class BrowserVisual {
  private readonly state = new VisualControls();
  private readonly dom: VisualControlsDom;
  private readonly camera: CinemaCamera;
  private readonly input: Input;
  private readonly observer: B.Nullable<B.Observer<B.Scene>>;

  constructor(private readonly game: BrowserGame, private readonly scene: B.Scene, camera: B.TargetCamera,
    private readonly canvas: HTMLCanvasElement, private readonly editing: () => boolean,
    private readonly hideGuides: () => void) {
    this.camera = new CinemaCamera(camera);
    this.dom = new VisualControlsDom(view => this.change(view));
    this.input = new Input(canvas, {
      "27": { states: 1, down: () => this.change("aim", false) },
      "87|38": { states: 1, down: () => this.change("aim") },
      "80": { states: 1, down: () => { this.change("aim", false); this.game.controls.pickUp(); } }
    }, {
      drag: { states: 1, run: (dx, dy) => {
        this.camera.orbit(dx, dy); this.state.view = "display";
      } },
      wheel: { states: 1, run: delta => this.camera.zoom(delta) }
    });
    this.input.state = 1; this.input.enabled = false;
    document.body.append(this.dom.element);
    this.observer = scene.onBeforeRenderObservable.add(() => this.sync());
  }

  private get blocked(): boolean {
    return this.editing() || this.game.isSuspended || this.game.pause.blocksPlay ||
      this.game.replay.active || this.game.controls.inHand.active;
  }

  private change(view: VisualView, aim = true): void {
    if (this.blocked) return;
    this.state.view = view;
    this.input.enabled = view !== "aim";
    if (view === "aim") {
      this.camera.release();
      this.game.controls.update();
      if (aim) this.game.controls.aim();
    } else {
      this.game.controls.input.enabled = false;
      this.camera.begin(view);
    }
    this.dom.sync(this.state);
    this.canvas.focus();
  }

  private sync(): void {
    this.state.visible = !this.blocked;
    if (this.blocked) {
      this.state.view = "aim"; this.input.enabled = false;
      this.camera.release(false);
    } else if (this.state.view !== "aim") {
      this.game.controls.input.enabled = false;
      this.input.enabled = true;
      this.camera.apply(); this.hideGuides();
    }
    this.dom.sync(this.state);
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.input.dispose(); this.dom.dispose(); this.camera.release();
  }
}
