import type { EventBus } from "./core/event-bus.js";
import { AudioHooks } from "./audio/hooks.js";
import { SampleMixer } from "./audio/sample-mixer.js";
import { parseAudioManifest } from "./audio/sample-manifest.js";
import { BrowserSoundBackend } from "./audio/browser-backend.js";
import { AUDIO_CALIBRATION } from "./audio/calibration.js";

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
  private evolution = 0;
  private replay = false;
  private loaded = false;
  private failed = false;

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

  private async load(): Promise<boolean> {
    try {
      const response = await fetch("/assets/audio/manifest.json", { signal: this.abort.signal });
      if (!response.ok) throw new Error(`Audio manifest: HTTP ${response.status}`);
      const samples = parseAudioManifest(await response.json());
      await this.backend!.load(samples);
      if (this.abort.signal.aborted) return false;
      const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      this.mixer = new SampleMixer(samples, random);
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
    if (session !== this.session || evolution < this.evolution || replay !== this.replay) {
      this.backend?.stop(); this.mixer?.reset();
    }
    this.session = session; this.evolution = evolution; this.replay = replay;
    this.backend?.setEnabled(!replay);
  }

  private updateCaption(): void {
    this.caption.textContent = this.failed ? "声音不可用" : !this.loaded ? "声音加载中"
      : this.slider.valueAsNumber === 0 ? "已静音" : this.backend?.running ? "音量" : "点击启用声音";
  }

  dispose(): void {
    this.abort.abort(); this.hooks?.detach(); this.backend?.dispose(); this.element.remove();
  }
}
