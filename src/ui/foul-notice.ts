// PCOL L8014-8016（FOUL 消息）/ L8260-8285（message 自动关闭计时）/ L3212-3217（ERROR 类型类名）。

export class FoulNotice {
  head = "";
  body = "";
  active = false;
  autoCloseTimer = -1;

  // PCOL L8016、L8266-8272
  showFoul(score: number, description: string): void {
    this.show("FOUL", score + ": " + description);
  }

  // PCOL L8260-8274
  show(head: string, body: string): void {
    this.head = head;
    this.body = body;
    this.active = true;
    this.autoCloseTimer = Math.min(1 + 0.08 * (this.head.length + this.body.length), 15);
  }

  close(): void {
    this.active = false;
    this.autoCloseTimer = -1;
  }

  // PCOL L8285
  update(dt: number): void {
    if (this.autoCloseTimer > 0 && (this.autoCloseTimer -= dt) <= 0) this.close();
  }
}

// PCOL L8115-8140、L3255-3268
export class FoulNoticeDom {
  readonly element: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly copyEl: HTMLElement;
  private renderedActive = false;

  constructor(doc: Document = document, onClose?: () => void) {
    this.element = doc.createElement("div");
    this.element.className = "box message-box";
    this.element.style.display = "none";
    this.headEl = doc.createElement("h3");
    this.headEl.className = "box-head error-copy";
    const body = doc.createElement("div");
    body.className = "box-body";
    this.copyEl = doc.createElement("p");
    this.copyEl.className = "box-body-copy error-copy";
    body.appendChild(this.copyEl);
    this.element.appendChild(this.headEl);
    this.element.appendChild(body);
    if (onClose) {
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "message-close";
      close.textContent = "×";
      close.setAttribute("aria-label", "Close touching ball notice");
      close.addEventListener("click", onClose);
      this.element.appendChild(close);
    }
  }

  sync(notice: FoulNotice): void {
    if (notice.active !== this.renderedActive) {
      this.renderedActive = notice.active;
      this.element.style.display = notice.active ? "block" : "none";
    }
    if (!notice.active) return;
    this.headEl.innerHTML = notice.head;
    this.copyEl.innerHTML = notice.body;
  }
}
