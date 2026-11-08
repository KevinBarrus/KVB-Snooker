export interface PracticeCompletionActions {
  restart(): void;
  restore(): void;
  continuePlaying(): void;
  exit(): void;
}

/** 练习清完最后一颗球后的四选项；不锁镜头输入，只阻止继续瞄准。 */
export class PracticeCompletionDom {
  readonly element: HTMLElement;
  private readonly restoreButton: HTMLButtonElement;

  constructor(private readonly actions: PracticeCompletionActions, doc: Document = document) {
    this.element = doc.createElement("section");
    this.element.className = "practice-completion";
    this.element.setAttribute("aria-label", "球形练习完成");
    this.element.hidden = true;
    const title = doc.createElement("strong");
    title.textContent = "球形已完成";
    const row = doc.createElement("div");
    row.className = "practice-completion-actions";
    const restart = doc.createElement("button");
    restart.type = "button";
    restart.textContent = "重摆";
    restart.addEventListener("click", () => actions.restart());
    this.restoreButton = doc.createElement("button");
    this.restoreButton.type = "button";
    this.restoreButton.textContent = "复位";
    this.restoreButton.addEventListener("click", () => actions.restore());
    const carryOn = doc.createElement("button");
    carryOn.type = "button";
    carryOn.textContent = "继续";
    carryOn.addEventListener("click", () => actions.continuePlaying());
    const exit = doc.createElement("button");
    exit.type = "button";
    exit.textContent = "退出";
    exit.addEventListener("click", () => actions.exit());
    row.append(restart, this.restoreButton, carryOn, exit);
    this.element.append(title, row);
  }

  sync(visible: boolean, canRestore: boolean): void {
    this.element.hidden = !visible;
    this.restoreButton.disabled = !canRestore;
  }

  dispose(): void {
    this.element.remove();
  }
}
