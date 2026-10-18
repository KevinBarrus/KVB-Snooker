// PCOL L8014-8016（FOUL 消息）/ L8260-8282（message 自动关闭计时）/ L3212-3216（消息类型）。

export const MESSAGE_TYPE = { INFO: 0, SUCCESS: 1, WARNING: 2, ERROR: 3 } as const;
export type MessageType = typeof MESSAGE_TYPE[keyof typeof MESSAGE_TYPE];

// PCOL L3217
const MESSAGE_TYPE_CLASS = ["", "success-copy", "warning-copy", "error-copy"] as const;

export class FoulNotice {
  head = "";
  body = "";
  type: MessageType = MESSAGE_TYPE.INFO;
  active = false;
  /** 剩余秒数；-1 表示不自动关闭。 */
  autoCloseTimer = -1;

  // PCOL L8016：正文为 "score: description"
  showFoul(score: number, description: string): void {
    this.message("FOUL", score + ": " + description, MESSAGE_TYPE.ERROR);
  }

  // PCOL L8260-8275：未钉住时计时 1 + 0.08·(标题长 + 正文长)，封顶 15s
  message(head: string, body: string, type: MessageType): void {
    this.head = head;
    this.body = body;
    this.type = type;
    this.active = true;
    this.autoCloseTimer = Math.min(1 + 0.08 * (head.length + body.length), 15);
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

// ---- DOM 视图 ----

// PCOL L8115-8140（message-box：h3.box-head + p.box-body-copy）
export class FoulNoticeDom {
  readonly element: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly copyEl: HTMLElement;
  private renderedType: MessageType = MESSAGE_TYPE.INFO;
  private renderedActive = false;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "box message-box";
    this.element.style.display = "none";
    this.headEl = doc.createElement("h3");
    this.headEl.className = "box-head";
    const body = doc.createElement("div");
    body.className = "box-body";
    this.copyEl = doc.createElement("p");
    this.copyEl.className = "box-body-copy";
    body.appendChild(this.copyEl);
    this.element.appendChild(this.headEl);
    this.element.appendChild(body);
  }

  // PCOL L3255-3268 / L8130-8139：类型类名同时挂在标题与正文上
  sync(notice: FoulNotice): void {
    if (notice.active !== this.renderedActive) {
      this.renderedActive = notice.active;
      this.element.style.display = notice.active ? "block" : "none";
    }
    if (!notice.active) return;
    this.headEl.innerHTML = notice.head;
    this.copyEl.innerHTML = notice.body;
    if (notice.type !== this.renderedType) {
      const prev = MESSAGE_TYPE_CLASS[this.renderedType];
      if (prev !== "") {
        this.headEl.classList.remove(prev);
        this.copyEl.classList.remove(prev);
      }
      this.renderedType = notice.type;
      const next = MESSAGE_TYPE_CLASS[notice.type];
      if (next !== "") {
        this.headEl.classList.add(next);
        this.copyEl.classList.add(next);
      }
    }
  }
}
