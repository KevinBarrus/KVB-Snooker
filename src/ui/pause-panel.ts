import type { PauseView } from "../core/match-pause.js";

export type PauseControl = "request" | "accept" | "decline" | "cancel" | "ready";

export class PausePanel {
  readonly element: HTMLElement;
  readonly dialog: HTMLDialogElement;
  private readonly message: HTMLElement;
  private readonly modalMessage: HTMLElement;
  private readonly buttons = new Map<PauseControl, HTMLButtonElement>();
  private readonly resume: HTMLButtonElement;

  constructor(private readonly action: (action: PauseControl) => void, private readonly focus: () => void,
    doc: Document = document) {
    this.element = doc.createElement("section");
    this.element.className = "pause-actions";
    this.element.setAttribute("aria-label", "暂停控制");
    this.element.style.cssText = "position:fixed;bottom:80px;left:20px;z-index:300;color:white;background:#15231d;padding:12px;border-radius:6px";
    this.message = doc.createElement("span");
    this.message.setAttribute("aria-live", "polite");
    this.element.append(this.message);
    for (const [id, label] of [["request", "请求暂停"], ["accept", "同意暂停"], ["decline", "拒绝"], ["cancel", "撤回请求"]] as const) {
      const button = doc.createElement("button");
      button.type = "button"; button.textContent = label;
      button.addEventListener("click", () => action(id));
      this.buttons.set(id, button); this.element.append(button);
    }
    this.dialog = doc.createElement("dialog");
    this.dialog.className = "pause-cover";
    this.dialog.tabIndex = -1;
    this.dialog.setAttribute("aria-label", "比赛已暂停");
    this.dialog.style.cssText = "position:fixed;inset:0;box-sizing:border-box;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;border:0;background:#101a15;color:#f4f3ee;text-align:center;padding-top:35vh;overflow:auto";
    this.modalMessage = doc.createElement("h2");
    this.modalMessage.setAttribute("aria-live", "polite");
    this.resume = doc.createElement("button");
    this.resume.type = "button"; this.resume.textContent = "准备继续";
    this.resume.addEventListener("click", () => this.action("ready"));
    this.dialog.addEventListener("cancel", event => event.preventDefault());
    this.dialog.append(this.modalMessage, this.resume);
    doc.body.append(this.element, this.dialog);
  }

  sync(view: PauseView, seat: number, available: boolean, pending = false, showRequest = true, error = ""): void {
    const covered = view.phase === "paused" || view.phase === "resuming";
    if (covered && !this.dialog.open) { this.dialog.showModal(); this.dialog.focus(); }
    if (!covered && this.dialog.open) { this.dialog.close(); this.focus(); }
    this.element.hidden = covered || (!showRequest && view.phase === "running") || !available;
    const requested = view.phase === "requested";
    const owner = view.requester === seat;
    this.message.textContent = error || (requested ? owner ? "等待对手同意" : "对手请求暂停"
      : view.phase === "waiting" ? "本杆结束后暂停" : "");
    for (const [id, button] of this.buttons) {
      button.hidden = id === "request" ? view.phase !== "running" || !showRequest
        : id === "cancel" ? !requested || !owner : !requested || owner;
      button.disabled = pending;
    }
    this.modalMessage.textContent = !available ? "连接已断开" : error || (view.phase === "resuming" ? `${Math.ceil(view.countdownSeconds)} 秒后继续`
      : view.remainingSeconds === null ? "比赛已暂停" : `比赛已暂停 · ${Math.ceil(view.remainingSeconds)} 秒`);
    this.resume.hidden = view.phase === "resuming";
    this.resume.disabled = pending || !available || view.ready[seat];
    this.resume.textContent = view.ready[seat] ? "已准备，等待对手" : "准备继续";
  }

  dispose(): void { this.dialog.close(); this.dialog.remove(); this.element.remove(); }
}
