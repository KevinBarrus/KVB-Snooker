import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import type { ImpactEvent } from "../../core/simulator/impact.js";
import { SampleMixer } from "../sample-mixer.js";
import { AUDIO_CALIBRATION, volumeAt } from "../calibration.js";
import { parseAudioManifest, SAMPLE_GROUPS, type AudioSample } from "../sample-manifest.js";
import { AudioHooks } from "../hooks.js";
import type { SoundDecision } from "../mixer.js";

const samples: AudioSample[] = SAMPLE_GROUPS.flatMap(group => [.3, .75].flatMap(intensity =>
  [1, 2, 3].map(index => ({ id: `${group}-${intensity}-${index}`, group, intensity,
    url: "/assets/audio/test.wav", gain: 1, offset: 0, duration: .3 }))));
const position = { time: 1, ballIndex: 0, x: 0, z: 0 };
const surface = (name: "jaw" | "pocket" | "tunnel" | "end", horizontalSpeed = 1, time = 1): Extract<ImpactEvent, { kind: "surface" }> =>
  ({ ...position, time, kind: "surface", surface: name, speed: 1, horizontalSpeed, entrySpeed: horizontalSpeed });
const cue = (tipHeight: number, power = .3): ImpactEvent => ({ ...position, kind: "cue",
  speed: 66 * power ** 2 + 38.2 * power + 1.6, tipHeight });
const mixer = () => new SampleMixer(samples, () => .42);

describe("sample playback decisions", () => {
  it.each([[-.5, "cue-low"], [-.2, "cue-mid-low"], [0, "cue-center"], [.3, "cue-high"]] as const)("maps actual tip height %s", (height, group) => {
    expect(mixer().mix(cue(height))?.sample?.group).toBe(group);
  });

  it("uses every variant once per shuffle and avoids boundary repeats", () => {
    const mix = mixer();
    const ids = Array.from({ length: 12 }, () => mix.mix(cue(-.2))!.sample!.id);
    for (let i = 0; i < 12; i += 3) expect(new Set(ids.slice(i, i + 3)).size).toBe(3);
    for (let i = 1; i < 12; ++i) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it("keeps volume continuous when a neighbouring timbre band changes", () => {
    const mix = mixer();
    const volumes = Array.from({ length: 100 }, (_, index) => mix.mix(cue(-.2, .01 + index / 100))!.volume);
    for (let i = 1; i < volumes.length; ++i) {
      expect(volumes[i]).toBeGreaterThan(volumes[i - 1]);
      expect(volumes[i] - volumes[i - 1]).toBeLessThan(.02);
    }
    expect(mix.mix(cue(-.2, 0))).toBeNull();
  });

  it("ball collision uses its own normal speed, independently of cue power", () => {
    const mix = mixer(); mix.mix(cue(0, 1));
    const soft = mix.mix({ ...position, kind: "ball", speed: .1 });
    const hard = mix.mix({ ...position, kind: "ball", speed: 4 });
    expect(soft!.volume).toBeLessThan(hard!.volume / 5);
    expect(hard!.sample!.group).toBe("ball");
  });

  it("retains horizontal entrance speed before pocket response and plays only once", () => {
    const mix = mixer();
    expect(mix.mix(surface("pocket", 2))).toBeNull();
    const pot = mix.mix(surface("tunnel", .01, 1.1));
    expect(pot?.sound).toBe("pocket-clean");
    expect(pot?.volume).toBeCloseTo(volumeAt(2, AUDIO_CALIBRATION.pocket));
    expect(mix.mix(surface("end", 3, 1.2))).toBeNull();
    mix.reset(); expect(mix.mix(surface("end", 1, 2))?.sound).toBe("pocket-clean");
  });

  it("uses jaw samples only for recent nearby jaw contact", () => {
    const mix = mixer(); mix.mix(surface("jaw")); mix.mix(surface("pocket", 2, 1.1));
    expect(mix.mix(surface("tunnel", .01, 1.2))?.sound).toBe("pocket-jaw");
    mix.reset(); mix.mix(surface("jaw"));
    expect(mix.mix(surface("tunnel", 2, 3))?.sound).toBe("pocket-clean");
    mix.reset(); mix.mix({ ...surface("jaw"), x: 1 });
    expect(mix.mix(surface("tunnel", 2, 1.1))?.sound).toBe("pocket-clean");
  });

  it("quiet pots remain silent even after a powerful cue strike", () => {
    const mix = mixer(); mix.mix(cue(0, 1)); mix.mix(surface("pocket", .1));
    expect(mix.mix({ ...surface("tunnel", 4, 1.1), entrySpeed: .1 })).toBeNull();
    expect(mix.mix(surface("end", 5, 1.2))).toBeNull();
    expect(mix.mix({ ...surface("tunnel", 2), ballIndex: 3 })?.volume).toBeGreaterThan(0);
  });

  it("rejects nonfinite events and resets per-shot pocket history", () => {
    const mix = mixer();
    expect(mix.mix({ ...cue(0), speed: NaN })).toBeNull();
    expect(mix.mix(cue(Infinity))).toBeNull();
    expect(mix.mix(surface("tunnel", NaN))).toBeNull();
    expect(mix.mix(surface("tunnel", 1))?.sound).toBe("pocket-clean");
    mix.mix(cue(0));
    expect(mix.mix(surface("tunnel", 1))?.sound).toBe("pocket-clean");
  });

  it("subscribes only real impacts in sample mode and releases listeners", () => {
    const bus = new EventBus(), played: SoundDecision[] = [];
    const hooks = new AudioHooks({ play: event => played.push(event) }, mixer());
    hooks.attach(bus); hooks.attach(bus);
    bus.emit("sim/shooting-start", { playerIndex: 0 });
    bus.emit("game/foul", { foulCode: 1, score: -4, description: "miss" });
    bus.emit("sim/out-of-bounds", { ballIndex: 0, ballNumber: 0 });
    expect(played).toEqual([]);
    bus.emit("sim/impact", cue(0)); expect(played).toHaveLength(1);
    hooks.detach(); bus.emit("sim/impact", cue(0)); expect(played).toHaveLength(1);
  });

  it("validates manifest paths, duplicate identities and complete coverage", () => {
    expect(parseAudioManifest({ version: 1, samples })).toEqual(samples);
    for (const bad of [{ ...samples[0], url: "https://example.com/a.wav" }, { ...samples[0], gain: NaN },
      { ...samples[0], offset: 1 }, { ...samples[0], group: "unknown" }]) {
      expect(() => parseAudioManifest({ version: 1, samples: [bad, ...samples.slice(1)] })).toThrow();
    }
    expect(() => parseAudioManifest({ version: 1, samples: [...samples, samples[0]] })).toThrow();
    expect(() => parseAudioManifest({ version: 1, samples: samples.slice(6) })).toThrow();
  });
});
