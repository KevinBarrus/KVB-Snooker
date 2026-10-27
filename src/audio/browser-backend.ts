import type { SoundBackend, SoundDecision } from "./mixer.js";
import type { AudioSample } from "./sample-manifest.js";
import { AUDIO_CALIBRATION, type AudioCalibration } from "./calibration.js";

export class BrowserSoundBackend implements SoundBackend {
  private readonly context = new AudioContext();
  private readonly master = this.context.createGain();
  private readonly compressor = this.context.createDynamicsCompressor();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Map<AudioBufferSourceNode, GainNode>();
  private readonly abort = new AbortController();
  private disposed = false;
  private enabled = true;
  private volume = AUDIO_CALIBRATION.playback.master;

  constructor(private readonly config: AudioCalibration = AUDIO_CALIBRATION) {
    const playback = config.playback;
    for (const key of ["threshold", "knee", "ratio", "attack", "release"] as const) this.compressor[key].value = playback[key];
    this.master.gain.value = playback.master;
    this.compressor.connect(this.master); this.master.connect(this.context.destination);
  }

  get running(): boolean { return this.context.state === "running"; }

  async load(samples: readonly AudioSample[]): Promise<void> {
    await Promise.all(samples.map(async sample => {
      const response = await fetch(sample.url, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`Audio ${sample.id}: HTTP ${response.status}`);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (sample.offset >= buffer.duration) throw new Error(`Invalid audio offset: ${sample.id}`);
      if (!this.disposed) this.buffers.set(sample.id, buffer);
    }));
  }

  async unlock(): Promise<void> { if (!this.disposed && !this.running) await this.context.resume(); }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume) || this.disposed) return;
    this.volume = volume;
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.context.currentTime, .015);
    if (volume === 0) this.stop();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  play(decision: SoundDecision): void {
    const sample = decision.sample;
    if (!sample || !this.running || !this.enabled || this.volume <= 0 || this.disposed || !Number.isFinite(decision.volume) || decision.volume <= 0) return;
    const buffer = this.buffers.get(sample.id);
    if (!buffer) return;
    while (this.voices.size >= this.config.playback.voices) this.remove(this.voices.keys().next().value!);
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(1, decision.volume) * sample.gain;
    source.connect(gain); gain.connect(this.compressor);
    this.voices.set(source, gain);
    source.onended = () => this.remove(source, false);
    source.start(0, sample.offset);
  }

  stop(): void { for (const source of [...this.voices.keys()]) this.remove(source); }

  private remove(source: AudioBufferSourceNode, stop = true): void {
    source.onended = null;
    if (stop) source.stop();
    source.disconnect(); this.voices.get(source)?.disconnect(); this.voices.delete(source);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); this.stop(); this.buffers.clear();
    this.compressor.disconnect(); this.master.disconnect(); void this.context.close();
  }
}
