/** 拖动判定阈值：CSS 像素，不随设备像素比变化。 */
export const DRAG_THRESHOLD = 4;

export interface GestureStep {
  readonly dragging: boolean;
  readonly dx: number;
  readonly dy: number;
}

/** 按下、移动、松开的判定与点击/拖动区分；不接触 DOM。 */
export class PointerGesture {
  private pointer: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private dragging = false;

  get active(): boolean { return this.pointer !== null; }

  down(pointerId: number, x: number, y: number): boolean {
    if (this.pointer !== null) return false;
    this.pointer = pointerId;
    this.downX = this.lastX = x;
    this.downY = this.lastY = y;
    this.dragging = false;
    return true;
  }

  move(pointerId: number, x: number, y: number): GestureStep | null {
    if (pointerId !== this.pointer) return null;
    const dx = x - this.lastX, dy = y - this.lastY;
    this.lastX = x; this.lastY = y;
    if (this.dragging) return { dragging: true, dx, dy };
    if (Math.hypot(x - this.downX, y - this.downY) <= DRAG_THRESHOLD) return { dragging: false, dx: 0, dy: 0 };
    this.dragging = true;
    return { dragging: true, dx: x - this.downX, dy: y - this.downY };
  }

  up(pointerId: number): "click" | "drag" | null {
    if (pointerId !== this.pointer) return null;
    const ended = this.dragging ? "drag" : "click";
    this.cancel();
    return ended;
  }

  cancel(): void {
    this.pointer = null;
    this.dragging = false;
  }
}
