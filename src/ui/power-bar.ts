// PCOL L1454-1514（powerui：percent / autoAlpha / trackLen 脏标记）/ L7637-7683（驱动方）。

// PCOL L492：H.BLUE
const HIGHLIGHT_COLOR = "rgb(32,179,255)";
// PCOL L1474
const BACKGROUND_ALPHA = 0.25;

export class PowerBar {
  private percentValue = 0;
  private autoAlphaValue = 0;
  needsUpdate = true;

  get percent(): number {
    return this.percentValue;
  }

  set percent(value: number) {
    if (this.percentValue !== value) {
      this.percentValue = value;
      this.needsUpdate = true;
    }
  }

  get autoAlpha(): number {
    return this.autoAlphaValue;
  }

  set autoAlpha(value: number) {
    if (this.autoAlphaValue !== value) {
      this.autoAlphaValue = value;
      this.needsUpdate = true;
    }
  }

  // PCOL L1508：alpha 为 0 即不可见
  get visible(): boolean {
    return this.autoAlphaValue !== 0;
  }
}

// ---- DOM 视图 ----

export class PowerBarDom {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "power-bar no-drag";
    this.element.style.display = "none";
    this.element.style.backgroundColor = "rgba(255,255,255," + BACKGROUND_ALPHA + ")";
    this.fill = doc.createElement("div");
    this.fill.className = "power-bar-fill";
    this.fill.style.backgroundColor = HIGHLIGHT_COLOR;
    this.fill.style.height = "100%";
    this.element.appendChild(this.fill);
  }

  sync(bar: PowerBar): void {
    if (!bar.needsUpdate) return;
    bar.needsUpdate = false;
    this.element.style.display = bar.visible ? "block" : "none";
    this.fill.style.width = bar.percent * 100 + "%";
    if (bar.visible) this.element.style.opacity = String(bar.autoAlpha);
  }
}
