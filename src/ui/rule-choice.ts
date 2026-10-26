export interface RuleChoiceView {
  readonly text: string;
  readonly ownLabel: string;
  readonly otherLabel: string;
  readonly restoreLabel?: string;
}

export class RuleChoiceDom {
  readonly element: HTMLElement;
  private readonly message: HTMLElement;
  private readonly own: HTMLButtonElement;
  private readonly other: HTMLButtonElement;
  private readonly restore: HTMLButtonElement;

  constructor(choose: (self: boolean) => void, restore?: () => void, doc: Document = document) {
    this.element = doc.createElement("section");
    this.element.className = "rule-choice";
    this.element.setAttribute("aria-label", "下一杆选择");
    this.element.hidden = true;
    this.message = doc.createElement("p");
    this.message.setAttribute("role", "status");
    this.own = doc.createElement("button"); this.own.type = "button";
    this.other = doc.createElement("button"); this.other.type = "button";
    this.own.addEventListener("click", () => choose(true));
    this.other.addEventListener("click", () => choose(false));
    this.restore = doc.createElement("button"); this.restore.type = "button";
    this.restore.hidden = true;
    this.restore.addEventListener("click", () => restore?.());
    this.element.append(this.message, this.own, this.other, this.restore);
  }

  sync(view: RuleChoiceView | null): void {
    this.element.hidden = view === null;
    if (!view) return;
    this.message.textContent = view.text;
    this.own.textContent = view.ownLabel;
    this.other.textContent = view.otherLabel;
    this.restore.hidden = !view.restoreLabel;
    this.restore.textContent = view.restoreLabel ?? "";
  }

  dispose(): void { this.element.remove(); }
}
