export class ViewNotice {
  text = "";
  remaining = 0;
  show(text: string): void { this.text = text; this.remaining = 2.2; }
  update(dt: number): void { this.remaining = Math.max(0, this.remaining - Math.max(0, dt)); }
}

export class ViewNoticeDom {
  readonly element: HTMLElement;
  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "view-notice";
    this.element.setAttribute("role", "status");
    this.element.hidden = true;
  }
  sync(notice: ViewNotice): void {
    this.element.hidden = notice.remaining <= 0;
    if (this.element.textContent !== notice.text) this.element.textContent = notice.text;
  }
}
