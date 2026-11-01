import { describe, expect, it } from 'vitest';
import { auditClip, reviewClip, validateClip, type Clip } from '../../scripts/audio-cut-audit.mjs';
import { readWav, type WavAudio } from '../../scripts/audio-review-lib.mjs';

const rate = 48000;
const clip: Clip = { sourceId: 'test', startSeconds: 0, impactSeconds: 0.12, endSeconds: 0.72,
  group: 'ball', intensity: 1, note: 'synthetic isolated impact' };
function impact(): WavAudio {
  const frames = Math.round(0.72 * rate);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const time = i / rate - 0.12;
    samples[i] = time >= 0 ? 0.5 * Math.exp(-time * 35) * Math.cos(time * 16000) : 0;
  }
  return { sampleRate: rate, channels: 1, frames, samples };
}
function pcm24(values: number[]): Buffer {
  const bytes = Buffer.alloc(44 + values.length * 3);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 3, 28);
  bytes.writeUInt16LE(3, 32); bytes.writeUInt16LE(24, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(values.length * 3, 40);
  values.forEach((value, i) => bytes.writeIntLE(value, 44 + i * 3, 3));
  return bytes;
}

describe('PCM24 source analysis', () => {
  it('reads signed extrema and one-bit detail without interpreting as PCM16', () => {
    const wav = readWav(pcm24([-8388608, -1, 0, 1, 8388607]));
    expect([...wav.samples]).toEqual([-1, -1 / 8388608, 0, 1 / 8388608, 8388607 / 8388608]);
  });
  it('rejects unsupported depth and broken alignment', () => {
    const bytes = pcm24([1, 2]); bytes.writeUInt16LE(20, 34);
    expect(() => readWav(bytes)).toThrow();
    bytes.writeUInt16LE(24, 34); bytes.writeUInt16LE(2, 32);
    expect(() => readWav(bytes)).toThrow();
  });
  it('rejects truncated source data', () => {
    expect(() => readWav(pcm24([1, 2]).subarray(0, 48))).toThrow();
  });
  it('reads extensible PCM24 and rejects an unrelated subformat GUID', () => {
    const original = pcm24([-1, 1]);
    const bytes = Buffer.concat([original.subarray(0, 36), Buffer.alloc(24), original.subarray(36)]);
    bytes.writeUInt32LE(bytes.length - 8, 4); bytes.writeUInt32LE(40, 16);
    bytes.writeUInt16LE(0xfffe, 20); bytes.writeUInt16LE(22, 36); bytes.writeUInt16LE(24, 38);
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(bytes, 44);
    expect([...readWav(bytes).samples]).toEqual([-1 / 8388608, 1 / 8388608]);
    bytes[59] = 0;
    expect(() => readWav(bytes)).toThrow('Unsupported extensible WAV format');
  });
});

describe('raw collision acceptance', () => {
  it('keeps overlapping or unresolved events out even when numerical checks pass', () => {
    expect(auditClip(impact(), clip).passed).toBe(true);
    for (const status of ['multiple-events', 'unresolved']) {
      expect(reviewClip({ ...clip, eventReview: { status, evidence: 'two separate source contacts' } }, 'three-level-pilot')).toBe('rejected');
    }
  });
  it('separates listening candidates from numerical diagnostics', () => {
    const wav = impact(); wav.samples.fill(0.001, wav.frames - 1000);
    expect(auditClip(wav, clip).passed).toBe(false);
    expect(reviewClip({ ...clip, eventReview: { status: 'isolated-candidate', evidence: 'one visible contact, next outside cut' } }, 'three-level-pilot')).toBe('candidate');
  });
  it('requires three-level labels and source evidence for the pilot', () => {
    const candidate = { ...clip, eventReview: { status: 'isolated-candidate', evidence: 'source frames and waveform' } };
    expect(() => reviewClip(candidate, 'unknown')).toThrow();
    expect(() => reviewClip(clip, 'three-level-pilot')).toThrow();
    expect(() => reviewClip({ ...candidate, intensity: 0.75 }, 'three-level-pilot')).toThrow();
    expect(() => reviewClip({ ...candidate, group: 'cue-mid-low' }, 'three-level-pilot')).toThrow();
    expect(reviewClip({ ...candidate, group: 'cue-unclassified' }, 'three-level-pilot')).toBe('candidate');
    expect(() => reviewClip({ ...candidate, group: 'cue-unclassified' })).toThrow();
    expect(() => reviewClip({ ...candidate, startSeconds: 0.1 }, 'three-level-pilot')).toThrow();
    expect(reviewClip({ ...candidate, startSeconds: 0.1, boundaryReason: 'exclude preceding event' }, 'three-level-pilot')).toBe('candidate');
  });
  it('keeps a clean numerical pass pending human listening', () => {
    const audit = auditClip(impact(), clip);
    expect(audit.reasons).toEqual([]);
    expect(audit.manualStatus).toBe('pending');
  });
  it('rejects pre-impact noise', () => {
    const wav = impact(); wav.samples.fill(0.02, 0, Math.round(0.12 * rate));
    expect(auditClip(wav, clip).reasons).toContain('pre_noise');
  });
  it('rejects late contamination and clipping', () => {
    const wav = impact(); wav.samples.fill(1, wav.frames - 30);
    const audit = auditClip(wav, clip);
    expect(audit.reasons).toEqual(expect.arrayContaining(['tail_energy', 'tail_rising', 'peak_headroom', 'clipping']));
  });
  it('enforces duration and a margin before the next event', () => {
    const wav = impact(); wav.samples = wav.samples.slice(0, rate * 0.4); wav.frames = wav.samples.length;
    expect(auditClip(wav, { ...clip, endSeconds: 0.4, nextEventSeconds: 0.41 }).reasons)
      .toEqual(expect.arrayContaining(['post_duration', 'next_event_margin']));
  });
  it('allows the documented hard-shot short-tail exception only with a reason', () => {
    const wav = impact(); wav.samples = wav.samples.slice(0, rate * 0.5); wav.frames = wav.samples.length;
    expect(auditClip(wav, { ...clip, endSeconds: 0.5 }).reasons).toContain('post_duration');
    expect(auditClip(wav, { ...clip, endSeconds: 0.5, shortTailReason: 'next impact at 0.53' }).reasons).not.toContain('post_duration');
  });
  it('rejects silent audio and invalid timestamps', () => {
    const wav = impact(); wav.samples.fill(0);
    expect(auditClip(wav, clip).reasons).toContain('weak_onset');
    expect(() => validateClip({ ...clip, impactSeconds: -1 })).toThrow();
    expect(() => validateClip({ ...clip, group: '../bad' })).toThrow();
  });
});
