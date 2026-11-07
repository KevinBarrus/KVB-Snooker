export interface PracticeChoiceView {
  readonly message: string;
  readonly canRestore: boolean;
}

/** 练球模式专属控件：常驻“复位上一杆”按钮 + 犯规后的重摆/复位弹窗。 */
export class PracticeControlsDom {
  readonly element: HTMLElement;
  private readonly restoreButton: HTMLButtonElement;
  private readonly choice: HTMLElement;
  private readonly message: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly restoreChoiceButton: HTMLButtonElement;

  constructor(onRestore: () => void, onRestart: () => void, doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "practice-controls";
    this.restoreButton = doc.createElement("button");
    this.restoreButton.type = "button";
    this.restoreButton.className = "practice-restore no-drag";
    this.restoreButton.textContent = "复位上一杆";
    this.restoreButton.addEventListener("click", () => onRestore());
    this.choice = doc.createElement("section");
    this.choice.className = "practice-choice no-drag";
    this.choice.setAttribute("aria-label", "犯规处理");
    this.choice.hidden = true;
    this.message = doc.createElement("p");
    this.message.setAttribute("role", "status");
    this.restartButton = doc.createElement("button");
    this.restartButton.type = "button";
    this.restartButton.textContent = "重摆";
    this.restartButton.addEventListener("click", () => onRestart());
    this.restoreChoiceButton = doc.createElement("button");
    this.restoreChoiceButton.type = "button";
    this.restoreChoiceButton.textContent = "复位";
    this.restoreChoiceButton.addEventListener("click", () => onRestore());
    this.choice.append(this.message, this.restartButton, this.restoreChoiceButton);
    this.element.append(this.restoreButton, this.choice);
  }

  sync(restoreVisible: boolean, restoreEnabled: boolean, choice: PracticeChoiceView | null): void {
    this.restoreButton.hidden = !restoreVisible;
    this.restoreButton.disabled = !restoreEnabled;
    this.choice.hidden = choice === null;
    if (!choice) return;
    this.message.textContent = choice.message;
    this.restoreChoiceButton.disabled = !choice.canRestore;
  }

  dispose(): void {
    this.element.remove();
  }
}
