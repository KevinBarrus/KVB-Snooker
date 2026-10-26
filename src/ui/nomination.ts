export interface NominationPanelView {
  readonly text: string;
  readonly selected: number | null;
  readonly enabled: boolean;
  readonly options: readonly { readonly index: number; readonly label: string }[];
}

export class NominationDom {
  readonly element: HTMLElement;
  private readonly message: HTMLElement;
  private readonly select: HTMLSelectElement;
  private optionsKey = "";

  constructor(select: (index: number | null) => void, private readonly doc: Document = document) {
    this.element = doc.createElement("section"); this.element.className = "nomination";
    this.element.hidden = true;
    this.message = doc.createElement("span"); this.message.setAttribute("role", "status");
    this.select = doc.createElement("select"); this.select.setAttribute("aria-label", "提名目标球");
    this.select.addEventListener("change", () => select(this.select.value === "" ? null : Number(this.select.value)));
    this.element.append(this.message, this.select);
  }

  sync(view: NominationPanelView | null): void {
    this.element.hidden = view === null;
    if (!view) return;
    const key = JSON.stringify(view.options);
    if (key !== this.optionsKey) {
      this.optionsKey = key;
      this.select.replaceChildren();
      const options = [{ index: null, label: "自动识别" }, ...view.options];
      for (const option of options) {
        const item = this.doc.createElement("option");
        item.value = option.index === null ? "" : String(option.index); item.textContent = option.label;
        this.select.append(item);
      }
    }
    this.message.textContent = view.text;
    this.select.value = view.selected === null ? "" : String(view.selected);
    this.select.disabled = !view.enabled;
  }

  dispose(): void { this.element.remove(); }
}
