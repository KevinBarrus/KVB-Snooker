export const SAMPLE_GROUPS = ["cue-low", "cue-mid-low", "cue-center", "cue-high", "ball", "pocket-clean", "pocket-jaw"] as const;
export type SampleGroup = typeof SAMPLE_GROUPS[number];

export interface AudioSample {
  readonly id: string;
  readonly url: string;
  readonly group: SampleGroup;
  readonly intensity: number;
  readonly gain: number;
  readonly offset: number;
  readonly duration: number;
}

export function parseAudioManifest(value: unknown): readonly AudioSample[] {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("samples" in value) || !Array.isArray(value.samples) || !value.samples.length) throw new Error("Invalid audio manifest");
  const samples: AudioSample[] = [];
  const ids = new Set<string>();
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  for (const entry of value.samples) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid audio sample");
    const row: Record<string, unknown> = entry;
    const { id, url, group, intensity, gain, offset, duration } = row;
    if (typeof id !== "string" || !id || ids.has(id) || typeof url !== "string" ||
        !/^\/assets\/audio\/[a-zA-Z0-9-]+\.wav$/.test(url) || typeof group !== "string" ||
        !SAMPLE_GROUPS.some(candidate => candidate === group) || !finite(intensity) || intensity < 0 || intensity > 1 ||
        !finite(gain) || gain <= 0 || gain > 4 || !finite(offset) || offset < 0 ||
        !finite(duration) || duration <= offset || duration > 10) throw new Error(`Invalid audio sample: ${String(id)}`);
    ids.add(id);
    samples.push({ id, url, group: group as SampleGroup, intensity, gain, offset, duration });
  }
  for (const group of SAMPLE_GROUPS) if (!samples.some(sample => sample.group === group)) throw new Error(`Missing audio group: ${group}`);
  return samples;
}
