export type VisualView = "aim" | "top" | "display";

export class VisualControls {
  view: VisualView = "aim";
  visible = false;
}

export class VisualControlsDom {
  readonly element: HTMLElement;
  private readonly buttons = new Map<VisualView, HTMLButtonElement>();

  constructor(change: (view: VisualView) => void, doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "visual-controls";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "镜头");
    this.element.hidden = true;
    const labels: Record<VisualView, string> = { aim: "瞄准", top: "俯视", display: "展示" };
    for (const view of ["aim", "top", "display"] as const) {
      const button = doc.createElement("button");
      button.type = "button"; button.textContent = labels[view];
      button.title = view === "display" ? "拖动环绕 · 滚轮缩放" : labels[view];
      button.addEventListener("click", () => change(view));
      this.buttons.set(view, button); this.element.append(button);
    }
  }

  sync(state: VisualControls): void {
    this.element.hidden = !state.visible;
    for (const [view, button] of this.buttons) button.setAttribute("aria-pressed", String(view === state.view));
  }

  dispose(): void { this.element.remove(); }
}
