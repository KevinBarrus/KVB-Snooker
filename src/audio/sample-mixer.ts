import type { ImpactEvent } from "../core/simulator/impact.js";
import { AUDIO_CALIBRATION, intensityAt, volumeAt, type AudioCalibration } from "./calibration.js";
import type { AudioSample, SampleGroup } from "./sample-manifest.js";
import type { SoundDecision } from "./mixer.js";

type SurfaceImpact = Extract<ImpactEvent, { kind: "surface" }>;
interface PocketHistory { jaw?: SurfaceImpact; entry?: SurfaceImpact; played?: boolean }

export class SampleMixer {
  private readonly bags = new Map<string, AudioSample[]>();
  private readonly last = new Map<SampleGroup, string>();
  private readonly pockets = new Map<number, PocketHistory>();

  constructor(private readonly samples: readonly AudioSample[], private readonly random: () => number,
    private readonly config: AudioCalibration = AUDIO_CALIBRATION) {}

  reset(): void { this.pockets.clear(); }

  mix(event: ImpactEvent): SoundDecision | null {
    if (![event.speed, event.time, event.x, event.z].every(Number.isFinite) || event.speed < 0) return null;
    if (event.kind === "cue") {
      this.reset();
      if (!Number.isFinite(event.tipHeight)) return null;
      const [a, b, c] = this.config.cueSpeedPolynomial;
      const power = Math.max(0, (-b + Math.sqrt(Math.max(0, b * b + 4 * a * (event.speed - c)))) / (2 * a));
      const [low, middle, high] = this.config.tipBands;
      const group = event.tipHeight < low ? "cue-low" : event.tipHeight < middle ? "cue-mid-low"
        : event.tipHeight <= high ? "cue-center" : "cue-high";
      return this.decide(group, intensityAt(power, this.config.cue), volumeAt(power, this.config.cue), "tip");
    }
    if (event.kind === "ball") return this.decide("ball", intensityAt(event.speed, this.config.ball), volumeAt(event.speed, this.config.ball), "ball-ball");
    if (![event.horizontalSpeed, event.entrySpeed].every(Number.isFinite) || event.horizontalSpeed < 0 || event.entrySpeed < 0) return null;
    let history = this.pockets.get(event.ballIndex);
    if (!history) { history = {}; this.pockets.set(event.ballIndex, history); }
    if (history.played) return null;
    if (history.jaw && !this.near(history.jaw, event)) delete history.jaw;
    if (history.entry && !this.near(history.entry, event)) delete history.entry;
    if (event.surface === "jaw") {
      if (event.speed >= this.config.pocketHistory.jawMinimumSpeed) history.jaw = event;
      return null;
    }
    if (event.surface === "pocket") { history.entry ??= event; return null; }
    history.played = true;
    const speed = history.entry?.entrySpeed ?? event.entrySpeed;
    const group = history.jaw ? "pocket-jaw" : "pocket-clean";
    return this.decide(group, intensityAt(speed, this.config.pocket), volumeAt(speed, this.config.pocket), group);
  }

  private near(a: SurfaceImpact, b: SurfaceImpact): boolean {
    return b.time >= a.time && b.time - a.time <= this.config.pocketHistory.seconds &&
      Math.hypot(a.x - b.x, a.z - b.z) <= this.config.pocketHistory.distance;
  }

  private decide(group: SampleGroup, intensity: number, volume: number, sound: SoundDecision["sound"]): SoundDecision | null {
    if (volume <= 0) return null;
    const candidates = this.samples.filter(sample => sample.group === group);
    if (!candidates.length) return null;
    const bands = [...new Set(candidates.map(sample => sample.intensity))].sort((a, b) => a - b);
    const lower = bands.filter(band => band <= intensity).at(-1) ?? bands[0];
    const upper = bands.find(band => band >= intensity) ?? bands.at(-1)!;
    const band = lower === upper || this.random() >= (intensity - lower) / (upper - lower) ? lower : upper;
    const key = `${group}:${band}`;
    let bag = this.bags.get(key);
    if (!bag?.length) {
      bag = candidates.filter(sample => sample.intensity === band);
      for (let i = bag.length - 1; i > 0; --i) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.bags.set(key, bag);
    }
    if (bag.length > 1 && bag.at(-1)!.id === this.last.get(group)) [bag[0], bag[bag.length - 1]] = [bag.at(-1)!, bag[0]];
    const sample = bag.pop()!;
    this.last.set(group, sample.id);
    return { sound, volume, sample };
  }
}
