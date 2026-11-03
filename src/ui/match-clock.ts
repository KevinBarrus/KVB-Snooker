import type { MatchClockView } from "../core/match-clock";

export function formatFrame(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatShot(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--";
  return seconds > 5 ? String(Math.ceil(seconds)) : Math.max(0, seconds).toFixed(1);
}

export function clockPhaseText(view: MatchClockView): string {
  switch (view.phase) {
    case "placement": return view.shootout ? "蓝球决胜 · 摆球计时中" : "摆球中 · 计时继续";
    case "aiming": return view.shootout ? "蓝球决胜 · 瞄准" : "瞄准中";
    case "rolling": return "球运动中";
    case "settling": return "等待本杆结算";
    case "frame-expired": return "局时结束 · 等待本杆结算";
    case "shot-expired": return "出杆超时";
    case "finished": return "本局结束";
  }
}

export class MatchClock {
  view: MatchClockView | null = null;

  get visible(): boolean { return this.view !== null; }
  get frameText(): string { return this.view ? formatFrame(this.view.frameSeconds) : ""; }
  get shotText(): string { return this.view ? formatShot(this.view.shotSeconds) : ""; }
  get phaseText(): string { return this.view ? clockPhaseText(this.view) : ""; }
  get shotRatio(): number {
    const seconds = this.view?.shotSeconds ?? 0;
    return Number.isFinite(seconds) ? Math.max(0, Math.min(1, seconds / 20)) : 0;
  }
  get shotWarn(): boolean { return this.view !== null && this.view.shotSeconds > 3 && this.view.shotSeconds <= 10; }
  get shotUrgent(): boolean { return this.view !== null && this.view.shotSeconds <= 3; }

  sync(view: MatchClockView | null): void {
    this.view = view && { ...view };
  }
}

export class MatchClockDom {
  readonly element: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly shot: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly fill: HTMLElement;
  private shown = "";

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "match-clock";
    this.element.setAttribute("role", "timer");
    this.frame = doc.createElement("span");
    this.frame.className = "match-clock-frame";
    this.shot = doc.createElement("span");
    this.shot.className = "match-clock-shot";
    this.phase = doc.createElement("span");
    this.phase.className = "match-clock-phase";
    this.progress = doc.createElement("div");
    this.progress.className = "match-clock-progress";
    this.progress.setAttribute("role", "progressbar");
    this.progress.setAttribute("aria-label", "出杆剩余时间");
    this.progress.setAttribute("aria-valuemin", "0");
    this.progress.setAttribute("aria-valuemax", "20");
    this.fill = doc.createElement("div");
    this.fill.className = "match-clock-fill";
    this.fill.setAttribute("aria-hidden", "true");
    this.progress.append(this.fill);
    this.element.append(this.frame, this.shot, this.progress, this.phase);
    this.element.hidden = true;
  }

  sync(clock: MatchClock): void {
    this.element.hidden = !clock.visible;
    if (!clock.visible) return;
    const key = `${clock.frameText}|${clock.shotText}|${clock.phaseText}|${clock.shotRatio}|${clock.shotWarn}|${clock.shotUrgent}`;
    if (key === this.shown) return;
    this.shown = key;
    this.frame.textContent = `本局 ${clock.frameText}`;
    this.shot.textContent = `出杆 ${clock.shotText}`;
    this.phase.textContent = clock.phaseText;
    this.progress.classList.toggle("warn", clock.shotWarn);
    this.progress.classList.toggle("urgent", clock.shotUrgent);
    this.progress.setAttribute("aria-valuenow", clock.view ? String(clock.view.shotSeconds) : "0");
    this.progress.setAttribute("aria-valuetext", `${clock.shotText} 秒 · ${clock.phaseText}`);
    this.fill.style.transform = `scaleX(${clock.shotRatio})`;
  }
}
