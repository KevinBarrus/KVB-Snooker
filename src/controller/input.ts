export interface KeyBinding {
  states: number;
  down(): void;
  up?(): void;
}

export interface PointerBinding {
  states: number;
  run(x: number, y: number, modifier: boolean): void;
}

export interface PointerBindings {
  press?: PointerBinding;
  move?: PointerBinding;
  drag?: PointerBinding;
  wheel?: { states: number; run(delta: number, modifier: boolean): void };
}

// PCOL L3803-4040
export class Input {
  private readonly keys = new Map<number, KeyBinding & { triggered: boolean }>();
  private stateValue = 0;
  private enabledValue = true;
  private pointerId: number | null = null;

  constructor(private readonly canvas: HTMLElement, bindings: Record<string, KeyBinding>, private readonly pointer: PointerBindings) {
    for (const [codes, binding] of Object.entries(bindings)) {
      for (const code of codes.split("|")) this.keys.set(Number(code), { ...binding, triggered: false });
    }
    canvas.addEventListener("keydown", this.keyDown);
    canvas.addEventListener("keyup", this.keyUp);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerUp);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    canvas.addEventListener("blur", this.blur);
    window.addEventListener("blur", this.blur);
  }

  get state(): number { return this.stateValue; }
  set state(value: number) {
    if (value === this.stateValue) return;
    this.stateValue = value;
    if (this.enabled) { this.cancelKeys(value); this.releasePointer(); }
  }
  get enabled(): boolean { return this.enabledValue; }
  set enabled(value: boolean) {
    if (value === this.enabledValue) return;
    this.enabledValue = value;
    if (!value) this.blur();
  }

  private cancelKeys(states: number): void {
    for (const key of this.keys.values()) {
      if (key.triggered && !(key.states & states)) { key.triggered = false; key.up?.(); }
    }
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.repeat || !this.enabled) return;
    if (event.altKey || event.metaKey) { event.preventDefault(); this.cancelKeys(0); return; }
    const key = this.keys.get(event.keyCode);
    if (key && key.states & this.state && !key.triggered) {
      event.preventDefault(); key.triggered = true; key.down();
    }
  };

  private keyUp = (event: KeyboardEvent): void => {
    const key = this.keys.get(event.keyCode);
    if (key?.triggered) { event.preventDefault(); key.triggered = false; key.up?.(); }
  };

  private pointerDown = (event: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    if (!this.enabled) return;
    if (this.pointerId === null && this.pointer.drag && this.pointer.drag.states & this.state) {
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
    }
    const binding = this.pointer.press;
    if (binding && binding.states & this.state) binding.run(event.clientX, event.clientY, event.altKey || event.metaKey);
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const { move, drag } = this.pointer;
    if (move && move.states & this.state) {
      event.preventDefault(); move.run(event.clientX, event.clientY, event.altKey || event.metaKey);
    }
    if (this.pointerId !== null && drag && drag.states & this.state) {
      event.preventDefault(); drag.run(event.movementX, event.movementY, event.altKey || event.metaKey);
    }
  };

  private releasePointer(): void {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    this.pointerId = null;
  }
  private pointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== null) { event.preventDefault(); this.releasePointer(); }
  };
  private blur = (): void => { this.cancelKeys(0); this.releasePointer(); };
  private wheel = (event: WheelEvent): void => {
    const binding = this.pointer.wheel;
    if (this.enabled && binding && binding.states & this.state) {
      event.preventDefault(); binding.run(event.deltaY * (1 + 39 * event.deltaMode), event.altKey || event.metaKey);
    }
  };

  dispose(): void {
    this.blur();
    this.canvas.removeEventListener("keydown", this.keyDown);
    this.canvas.removeEventListener("keyup", this.keyUp);
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerUp);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("blur", this.blur);
    window.removeEventListener("blur", this.blur);
  }
}
