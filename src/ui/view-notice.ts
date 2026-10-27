export class ViewNotice {
  text = "";
  remaining = 0;
  show(text: string): void { this.text = text; this.remaining = 2.2; }
  close(): void { this.remaining = 0; }
  update(dt: number): void { this.remaining = Math.max(0, this.remaining - Math.max(0, dt)); }
}

export class ViewNoticeDom {
  readonly element: HTMLElement;
  private readonly copy: HTMLElement;
  private notice: ViewNotice | null = null;
  constructor(doc: Document = document, onClose?: () => void) {
    this.element = doc.createElement("div");
    this.element.className = "view-notice";
    this.element.setAttribute("role", "status");
    this.element.hidden = true;
    this.copy = doc.createElement("span");
    this.copy.className = "view-notice-copy";
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "message-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close message");
    close.addEventListener("click", () => {
      this.notice?.close();
      if (this.notice) this.sync(this.notice);
      onClose?.();
    });
    this.element.append(this.copy, close);
  }
  sync(notice: ViewNotice): void {
    this.notice = notice;
    this.element.hidden = notice.remaining <= 0;
    if (this.copy.textContent !== notice.text) this.copy.textContent = notice.text;
  }
}
