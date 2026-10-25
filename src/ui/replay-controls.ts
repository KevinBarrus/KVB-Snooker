export interface ReplayActions {
  open(): void;
  toggle(): void;
  slow(): void;
  restart(): void;
  close(): void;
  seek(progress: number): void;
  cycleView(): void;
}

export class ReplayControls {
  available = false;
  active = false;
  paused = false;
  slow = false;
  progress = 0;
}

// PCOL L4134, L6481-6584, L12113
export class ReplayControlsDom {
  readonly element: HTMLElement;
  readonly openButton: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly slowButton: HTMLButtonElement;
  private readonly progress: HTMLInputElement;

  constructor(actions: ReplayActions, doc: Document = document) {
    this.element = doc.createElement("div"); this.element.className = "replay-controls";
    const button = (text: string, label: string, action: () => void): HTMLButtonElement => {
      const item = doc.createElement("button"); item.type = "button"; item.textContent = text;
      item.setAttribute("aria-label", label); item.title = label; item.addEventListener("click", action);
      return item;
    };
    this.openButton = button("📹 回放", "回看上一杆", actions.open);
    this.openButton.className = "replay-open"; this.openButton.hidden = true; this.openButton.disabled = true;
    this.panel = doc.createElement("section"); this.panel.className = "replay-panel";
    this.panel.setAttribute("aria-label", "上一杆回放"); this.panel.hidden = true;
    const title = doc.createElement("strong"); title.textContent = "上一杆回放";
    this.toggleButton = button("暂停", "播放或暂停回放", actions.toggle);
    this.slowButton = button("¼ 慢放", "切换四分之一慢放", actions.slow);
    this.progress = doc.createElement("input"); this.progress.type = "range";
    this.progress.min = "0"; this.progress.max = "1"; this.progress.step = ".001";
    this.progress.setAttribute("aria-label", "回放进度");
    this.progress.addEventListener("input", () => actions.seek(Number(this.progress.value)));
    this.panel.addEventListener("keydown", event => {
      if (event.repeat) return;
      const action = event.key === "Escape" ? actions.close : event.key.toLowerCase() === "v" ? actions.cycleView
        : event.code === "Space" && event.target === this.progress ? actions.toggle : null;
      if (action) { event.preventDefault(); action(); }
    });
    const hint = doc.createElement("span"); hint.textContent = "Space 暂停 · V 视线 · 拖拽观察 · Esc 退出";
    this.panel.append(title, this.toggleButton, this.slowButton, button("重播", "重新播放上一杆", actions.restart),
      this.progress, button("退出", "退出回放", actions.close), hint);
    this.element.append(this.openButton, this.panel);
  }

  sync(state: ReplayControls): void {
    this.openButton.hidden = !state.available || state.active;
    this.openButton.disabled = !state.available || state.active;
    this.panel.hidden = !state.active;
    this.toggleButton.textContent = state.paused ? "播放" : "暂停";
    this.slowButton.setAttribute("aria-pressed", String(state.slow));
    this.progress.value = String(state.progress);
  }

  dispose(): void { this.element.remove(); }
}
