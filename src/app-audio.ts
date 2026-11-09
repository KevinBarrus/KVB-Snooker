import type { EventBus } from "./core/event-bus.js";
import { AudioHooks } from "./audio/hooks.js";
import { SampleMixer } from "./audio/sample-mixer.js";
import { parseAudioManifest } from "./audio/sample-manifest.js";
import { BrowserSoundBackend } from "./audio/browser-backend.js";
import { AUDIO_CALIBRATION } from "./audio/calibration.js";
import type { AudioSample } from "./audio/sample-manifest.js";
import type { ImpactEvent } from "./core/simulator/impact.js";

export interface ReplayAudioEvent {
  readonly time: number;
  readonly impact: ImpactEvent;
}

export interface ReplayAudioView {
  readonly active: boolean;
  readonly playHead: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly revision: number;
  readonly events: readonly ReplayAudioEvent[];
}

export class BrowserAudio {
  readonly ready: Promise<boolean>;
  private backend: BrowserSoundBackend | null = null;
  private hooks: AudioHooks | null = null;
  private mixer: SampleMixer | null = null;
  private readonly abort = new AbortController();
  private readonly element = document.createElement("label");
  private readonly caption = document.createElement("span");
  private readonly slider = document.createElement("input");
  private session: object | null = null;
  private samples: readonly AudioSample[] | null = null;
  private replayMixer: SampleMixer | null = null;
  private replayEvents: readonly ReplayAudioEvent[] = [];
  private replayActive = false;
  private replayPaused = false;
  private replayRevision = -1;
  private replayCursor = 0;
  private evolution = 0;
  private replay = false;
  private loaded = false;
  private failed = false;
  private readonly random = (): number => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

  constructor(private readonly bus: EventBus, host: HTMLElement) {
    this.element.className = "audio-control";
    this.caption.textContent = "声音加载中";
    this.caption.setAttribute("role", "status");
    this.slider.type = "range"; this.slider.min = "0"; this.slider.max = "1"; this.slider.step = ".01";
    this.slider.setAttribute("aria-label", "音量（0 为静音）");
    this.slider.style.width = "80px";
    let volume = AUDIO_CALIBRATION.playback.master;
    try {
      const saved = localStorage.getItem("snk.volume");
      if (saved !== null && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved)));
    } catch {}
    this.slider.value = String(volume);
    this.element.append(this.caption, this.slider); host.append(this.element);
    const signal = this.abort.signal;
    this.slider.addEventListener("input", () => {
      this.backend?.setVolume(this.slider.valueAsNumber);
      try { localStorage.setItem("snk.volume", this.slider.value); } catch {}
      this.updateCaption();
    }, { signal });
    document.addEventListener("pointerdown", this.unlock, { capture: true, signal });
    document.addEventListener("pointerup", this.unlock, { capture: true, signal });
    document.addEventListener("click", this.unlock, { capture: true, signal });
    document.addEventListener("touchstart", this.unlock, { capture: true, signal });
    document.addEventListener("keydown", this.unlock, { capture: true, signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.backend?.stop(); }, { signal });
    try {
      this.backend = new BrowserSoundBackend(); this.backend.setVolume(volume);
      this.ready = this.load();
    } catch {
      this.failed = true; this.updateCaption(); this.ready = Promise.resolve(false);
    }
  }

  private readonly unlock = (): void => {
    void this.backend?.unlock().then(() => this.updateCaption()).catch(() => {
      this.caption.textContent = "声音待启用";
    });
  };

  /** 出杆开始前主动恢复音频上下文，避免首次触球声与后续碰撞声挤在一起。 */
  unlockNow(): void {
    this.unlock();
  }

  private async load(): Promise<boolean> {
    try {
      const response = await fetch("/assets/audio/manifest.json", { signal: this.abort.signal });
      if (!response.ok) throw new Error(`Audio manifest: HTTP ${response.status}`);
      const samples = parseAudioManifest(await response.json());
      await this.backend!.load(samples);
      if (this.abort.signal.aborted) return false;
      this.samples = samples;
      this.mixer = new SampleMixer(samples, this.random);
      this.hooks = new AudioHooks(this.backend!, this.mixer); this.hooks.attach(this.bus);
      this.loaded = true; this.updateCaption(); return true;
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.backend?.dispose(); this.backend = null;
        this.failed = true; this.updateCaption();
        console.warn("Sound unavailable", error);
      }
      return false;
    }
  }

  sync(session: object, evolution: number, replay: boolean): void {
    const replayChanged = replay !== this.replay;
    if (session !== this.session || evolution < this.evolution || replayChanged) {
      this.backend?.stop(); this.mixer?.reset();
    }
    this.session = session; this.evolution = evolution; this.replay = replay;
    if (replayChanged) this.backend?.setEnabled(!replay);
    // 浏览器可能在切模式/失焦后把上下文挂起；每帧尝试恢复，确保第一杆触球声不被整体推迟。
    if (this.backend && !this.backend.running) void this.backend.unlock().catch(() => undefined);
  }

  /**
   * 回放音频：按回放 playHead 消费录制好的 impact 事件。
   * 回放混音器独立于真实对局，seek/restart 时重建；音量共用 backend master。
   */
  syncReplay(view: ReplayAudioView): void {
    if (!view.active) { this.stopReplay(); return; }
    if (!this.replayActive || view.revision !== this.replayRevision) {
      this.backend?.stop();
      this.replayActive = true;
      this.replayRevision = view.revision;
      this.replayEvents = view.events;
      this.replayCursor = 0;
      this.replayPaused = false;
      this.replayMixer = this.samples ? new SampleMixer(this.samples, this.random) : null;
      this.backend?.setEnabled(true);
      this.consumeReplay(view.playHead, false, false);
    } else {
      this.backend?.setEnabled(true);
    }
    if (view.paused) {
      if (!this.replayPaused) { this.replayPaused = true; this.backend?.stop(); }
      return;
    }
    this.replayPaused = false;
    this.consumeReplay(view.playHead, true, true);
  }

  private consumeReplay(playHead: number, play: boolean, inclusive: boolean): void {
    while (this.replayCursor < this.replayEvents.length) {
      const item = this.replayEvents[this.replayCursor];
      if (inclusive ? item.time > playHead : item.time >= playHead) break;
      const decision = this.replayMixer?.mix(item.impact);
      if (decision && play) this.backend?.play(decision);
      this.replayCursor++;
    }
  }

  private stopReplay(): void {
    if (!this.replayActive) return;
    this.backend?.stop();
    this.replayActive = false;
    this.replayPaused = false;
    this.replayRevision = -1;
    this.replayEvents = [];
    this.replayCursor = 0;
    this.replayMixer = null;
  }

  private updateCaption(): void {
    this.caption.textContent = this.failed ? "声音不可用" : !this.loaded ? "声音加载中"
      : this.slider.valueAsNumber === 0 ? "已静音" : this.backend?.running ? "音量" : "点击启用声音";
  }

  dispose(): void {
    this.stopReplay();
    this.abort.abort(); this.hooks?.detach(); this.backend?.dispose(); this.element.remove();
  }
}
