import * as B from "babylonjs/es6.js";
import { EventBus } from "./core/event-bus.js";
import type { SerialData } from "./core/simulator/shot-result.js";
import type { Simulator } from "./core/simulator/simulator.js";
import type { CustomShapeBall, CustomShapeRecord } from "./core/practice/custom-shapes.js";
import { practiceTable, type PracticeTable } from "./core/practice/table-geometry.js";
import { Input } from "./controller/input.js";
import { CameraRig } from "./controller/camera-rig.js";
import { PlacementMarkers } from "./render/placement.js";
import { ShapeEditorPanelDom } from "./ui/shape-editor-panel.js";

export interface ShapeEditorCallbacks {
  create(name: string, balls: readonly CustomShapeBall[]): void;
  save(id: string, balls: readonly CustomShapeBall[]): void;
  exit(): void;
}

interface PlacedBall {
  readonly index: number;
  readonly x: number;
  readonly z: number;
}

const BALL_NUMBER_BY_INDEX = (index: number): number => index <= 15 ? 1 : index - 14;
const INDEX_BY_BALL_NUMBER = (number: number): number => number === 1 ? 0 : number + 14;

export class ShapeEditor {
  private readonly rig: CameraRig;
  private readonly markers: PlacementMarkers;
  private readonly input: Input;
  private readonly panel: ShapeEditorPanelDom;
  private readonly table: PracticeTable;
  private snapshot: SerialData | null = null;
  private recordId: string | null = null;
  private editingValue = false;
  private activeValue = false;
  private readonly placed = new Map<number, PlacedBall>();
  private readonly counts: Record<number, number> = { 1: 15, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };
  private selected: number | null = null;
  private haloIndex: number | null = null;
  private candidate: { x: number; z: number; valid: boolean } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private dialogOpen = false;

  constructor(private readonly simulator: Simulator, scene: B.Scene, private readonly camera: B.TargetCamera,
    private readonly canvas: HTMLCanvasElement, atlas: B.Texture, mask: B.Texture,
    private readonly callbacks: ShapeEditorCallbacks, private readonly doc: Document = document) {
    this.table = practiceTable(simulator);
    const bus = new EventBus();
    this.rig = new CameraRig(bus, { x: 0, y: simulator.spotY, z: 0 }, Math.PI);
    this.rig.setState(0, true);
    this.rig.update(0);
    this.rig.updateHead(0, 0, 0);
    this.markers = new PlacementMarkers(scene, atlas, mask);
    this.input = new Input(canvas, {
      "65|37": { states: 4, down: () => this.rig.orbit(1), up: () => this.rig.orbit(0) },
      "68|39": { states: 4, down: () => this.rig.orbit(undefined, 1), up: () => this.rig.orbit(undefined, 0) }
    }, {
      move: { states: 4, run: (x, y) => this.move(x, y) },
      click: { states: 4, run: (x, y) => this.click(x, y) },
      drag: { states: 4, run: (dx, dy) => this.rig.moveLookAt(.0025 * dx, .0025 * dy) }
    });
    this.input.state = 4;
    this.input.enabled = false;
    canvas.addEventListener("contextmenu", this.onContextMenu);
    const self = this;
    this.panel = new ShapeEditorPanelDom({
      get editing(): boolean { return self.editingValue; },
      inventory: () => [1, 2, 3, 4, 5, 6, 7].map(number => ({ ballNumber: number, count: this.counts[number] })),
      selectedBall: () => this.selected,
      selectBall: number => {
        this.selected = this.selected === number ? null : number;
        if (this.lastPointer && this.selected !== null) this.move(this.lastPointer.x, this.lastPointer.y);
        this.panel.sync();
      },
      finish: name => this.callbacks.create(name, this.balls()),
      save: () => { if (this.recordId) this.callbacks.save(this.recordId, this.balls()); },
      exit: () => this.callbacks.exit(),
      colourOptions: () => [2, 3, 4, 5, 6, 7].map(number => ({
        ballNumber: number,
        available: !this.isOnSpot(number),
        count: this.counts[number]
      })),
      applyColours: numbers => this.applyColours(numbers),
      colourName: number => ({ 2: "黄球", 3: "绿球", 4: "棕球", 5: "蓝球", 6: "粉球", 7: "黑球" })[number] ?? "",
      focusCanvas: () => this.canvas.focus(),
      dialogsOpen: open => {
        this.dialogOpen = open;
        if (open) this.candidate = null;
        else if (this.lastPointer && this.selected !== null) this.move(this.lastPointer.x, this.lastPointer.y);
      }
    }, doc);
    this.panel.element.hidden = true;
  }

  get active(): boolean { return this.activeValue; }
  get editing(): boolean { return this.editingValue; }

  enter(record: CustomShapeRecord | null): void {
    if (this.activeValue) return;
    this.snapshot = this.simulator.serialize();
    this.recordId = record?.id ?? null;
    this.editingValue = record !== null;
    this.selected = null;
    this.haloIndex = null;
    this.candidate = null;
    this.lastPointer = null;
    this.dialogOpen = false;
    this.placed.clear();
    for (let number = 1; number <= 7; number++) this.counts[number] = number === 1 ? 15 : 1;
    for (const ball of this.simulator.getBalls()) this.simulator.resetBallPosition(ball, null);
    for (const ball of record?.balls ?? []) {
      const placed = this.placeBallAt(ball.index, ball.x, ball.z);
      if (placed) {
        this.placed.set(ball.index, placed);
        this.counts[BALL_NUMBER_BY_INDEX(ball.index)]--;
      }
    }
    this.activeValue = true;
    this.input.enabled = true;
    this.panel.element.hidden = false;
    this.panel.sync();
    this.canvas.focus();
    this.rig.setState(0, true);
    this.applyCamera();
  }

  close(): void {
    if (!this.activeValue) return;
    this.activeValue = false;
    this.input.enabled = false;
    this.panel.element.hidden = true;
    this.markers.origin.isVisible = false;
    this.markers.preview.isVisible = false;
    if (this.snapshot) this.simulator.restore(this.snapshot);
    this.snapshot = null;
  }

  update(dt: number): void {
    if (!this.activeValue) return;
    this.rig.update(dt);
    this.rig.updateHead(0, 0, dt);
    this.applyCamera();
    const haloIndex = this.haloIndex;
    const haloView = haloIndex === null ? null : this.simulator.getBallView(haloIndex);
    const halo = haloView?.position ?? null;
    const candidate = this.candidate;
    this.markers.sync(halo ?? { x: 0, z: 0 }, {
      active: haloView?.active ?? false,
      visible: candidate !== null,
      valid: candidate?.valid ?? false,
      spot: candidate ?? { x: 0, z: 0 },
      previewVisible: candidate !== null
    });
    if (halo) { this.markers.origin.position.x = halo.x; this.markers.origin.position.z = halo.z; }
    this.panel.sync();
  }

  getBallView(index: number): ReturnType<Simulator["getBallView"]> {
    return this.simulator.getBallView(index);
  }

  dispose(): void {
    this.close();
    this.input.dispose();
    this.markers.dispose();
    this.panel.dispose();
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  private applyCamera(): void {
    this.camera.position.copyFrom(this.rig.position);
    this.camera.lockedTarget = this.rig.target;
  }

  private balls(): CustomShapeBall[] {
    return [...this.placed.values()].map(ball => ({ index: ball.index, x: ball.x, z: ball.z }));
  }

  private isOnSpot(number: number): boolean {
    const index = INDEX_BY_BALL_NUMBER(number);
    const ball = this.simulator.getBallView(index);
    if (!ball.active) return false;
    const spot = this.table.spots[index];
    return Math.abs(ball.position.x - spot.x) < 1e-6 && Math.abs(ball.position.z - spot.z) < 1e-6;
  }

  private placeBallAt(index: number, x: number, z: number): PlacedBall | null {
    if (!this.insideTable(x, z) || this.touches(index, x, z)) return null;
    this.simulator.respotIndexXYZ(index, x, this.simulator.spotY, z);
    return { index, x, z };
  }

  private insideTable(x: number, z: number): boolean {
    return x >= this.table.minX - 1e-6 && x <= this.table.maxX + 1e-6 &&
      z >= this.table.minZ - 1e-6 && z <= this.table.maxZ + 1e-6;
  }

  private touches(index: number, x: number, z: number): boolean {
    return this.simulator.getBalls().some((ball, i) => i !== index && ball.active &&
      Math.hypot(ball.position.x - x, ball.position.z - z) < 2 * this.simulator.ballRadius - 1e-6);
  }

  private pickPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const bounds = this.canvas.getBoundingClientRect();
    const ray = this.camera.getScene().createPickingRay(clientX - bounds.left, clientY - bounds.top,
      B.Matrix.Identity(), this.camera);
    if (!Number.isFinite(ray.direction.y) || Math.abs(ray.direction.y) < 1e-9) return null;
    const distance = (this.simulator.spotY - ray.origin.y) / ray.direction.y;
    if (!Number.isFinite(distance) || distance < 0) return null;
    return { x: ray.origin.x + distance * ray.direction.x, z: ray.origin.z + distance * ray.direction.z };
  }

  private move(clientX: number, clientY: number): void {
    this.lastPointer = { x: clientX, y: clientY };
    if (this.dialogOpen) { this.candidate = null; return; }
    const point = this.pickPoint(clientX, clientY);
    if (!point || this.selected === null) { this.candidate = null; return; }
    const index = this.nextIndex(this.selected);
    this.candidate = { ...point, valid: index !== null && this.counts[this.selected] > 0 &&
      this.insideTable(point.x, point.z) && !this.touches(index, point.x, point.z) };
  }

  private click(clientX: number, clientY: number): void {
    if (this.selected === null || !this.candidate || !this.candidate.valid) return;
    const index = this.nextIndex(this.selected);
    if (index === null) return;
    const placed = this.placeBallAt(index, this.candidate.x, this.candidate.z);
    if (!placed) return;
    this.placed.set(index, placed);
    this.counts[this.selected]--;
    this.candidate = null;
    this.panel.sync();
  }

  private nextIndex(ballNumber: number): number | null {
    const start = ballNumber === 1 ? 1 : INDEX_BY_BALL_NUMBER(ballNumber);
    const end = ballNumber === 1 ? 15 : start;
    for (let index = start; index <= end; index++) if (!this.simulator.getBallView(index).active) return index;
    return null;
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.activeValue) return;
    event.preventDefault();
    this.candidate = null;
    const point = this.pickPoint(event.clientX, event.clientY);
    if (!point) return;
    const radius = this.simulator.ballRadius * 1.35;
    let found = -1;
    let best = Infinity;
    for (const ball of this.simulator.getBalls()) {
      if (!ball.active || ball.index === 0) continue;
      const distance = Math.hypot(ball.position.x - point.x, ball.position.z - point.z);
      if (distance < radius && distance < best) { found = ball.index; best = distance; }
    }
    if (found < 0) return;
    this.haloIndex = found;
    const number = BALL_NUMBER_BY_INDEX(found);
    this.panel.showRecycle(number, () => this.recycle(found));
  };

  private recycle(index: number): void {
    const view = this.simulator.getBallView(index);
    if (!view.active || index < 1) return;
    this.candidate = null;
    this.simulator.resetBallPosition(this.simulator.getBallAtIndex(index), null);
    this.placed.delete(index);
    this.counts[BALL_NUMBER_BY_INDEX(index)]++;
    this.haloIndex = null;
    this.panel.sync();
    this.canvas.focus();
  }

  private applyColours(numbers: readonly number[]): { readonly ok: boolean; readonly occupied: readonly string[] } {
    const selectedIndices = new Set(numbers.map(number => INDEX_BY_BALL_NUMBER(number)));
    const occupied: string[] = [];
    const names: Record<number, string> = { 2: "黄球", 3: "绿球", 4: "棕球", 5: "蓝球", 6: "粉球", 7: "黑球" };
    for (const number of numbers) {
      const index = INDEX_BY_BALL_NUMBER(number);
      const spot = this.table.spots[index];
      const blocker = this.simulator.getBalls().find(ball => ball.active &&
        !selectedIndices.has(ball.index) && ball.index !== index &&
        Math.hypot(ball.position.x - spot.x, ball.position.z - spot.z) < 2 * this.simulator.ballRadius - 1e-6);
      if (blocker) occupied.push(names[number] ?? "");
    }
    if (occupied.length > 0) return { ok: false, occupied };
    for (const number of numbers) {
      const index = INDEX_BY_BALL_NUMBER(number);
      const spot = this.table.spots[index];
      this.simulator.resetBallPosition(this.simulator.getBallAtIndex(index), null);
      this.placed.delete(index);
      this.counts[number] = 1;
      this.simulator.respotIndexXYZ(index, spot.x, this.simulator.spotY, spot.z);
      this.placed.set(index, { index, x: spot.x, z: spot.z });
      this.counts[number] = 0;
    }
    this.candidate = null;
    this.panel.sync();
    this.canvas.focus();
    return { ok: true, occupied: [] };
  }
}
