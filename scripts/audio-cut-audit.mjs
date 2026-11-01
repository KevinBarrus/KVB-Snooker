import { gainToDb, measureWav, rmsOfWindow } from './audio-review-lib.mjs';

export const GROUPS = ['cue-low', 'cue-mid-low', 'cue-center', 'cue-high', 'ball', 'pocket-clean', 'pocket-jaw'];
export const INTENSITIES = [0.1, 0.3, 0.5, 0.75, 1];

export function reviewClip(clip, profile = 'strict-v1') {
  if (profile === 'strict-v1') {
    if (clip.group === 'cue-unclassified') throw new Error('Unclassified cue requires pilot profile');
    return 'legacy';
  }
  if (profile !== 'three-level-pilot') throw new Error('Unknown capture profile');
  validateClip(clip);
  if (clip.group === 'cue-mid-low' || ![0.3, 0.5, 1].includes(clip.intensity)) throw new Error('Pilot requires three-level classification');
  const review = clip.eventReview;
  if (!review || !['isolated-candidate', 'multiple-events', 'unresolved'].includes(review.status)
    || typeof review.evidence !== 'string' || !review.evidence.trim()) throw new Error('Missing event review evidence');
  if (clip.impactSeconds - clip.startSeconds < 0.1 && !clip.boundaryReason?.trim()) throw new Error('Short pre-roll needs a boundary reason');
  return review.status === 'isolated-candidate' ? 'candidate' : 'rejected';
}

export function validateClip(clip) {
  if (!clip || ![...GROUPS, 'cue-unclassified'].includes(clip.group) || !INTENSITIES.includes(clip.intensity)) throw new Error('Invalid group/intensity');
  for (const field of ['startSeconds', 'impactSeconds', 'endSeconds']) {
    if (!Number.isFinite(clip[field]) || clip[field] < 0) throw new Error(`Invalid ${field}`);
  }
  if (!(clip.startSeconds < clip.impactSeconds && clip.impactSeconds < clip.endSeconds)) throw new Error('Invalid clip time order');
  if (clip.endSeconds - clip.startSeconds > 10) throw new Error('Clip exceeds 10 seconds');
  if (typeof clip.sourceId !== 'string' || !clip.sourceId || typeof clip.note !== 'string' || !clip.note.trim()) throw new Error('Missing sourceId/note');
  if (clip.nextEventSeconds != null && (!Number.isFinite(clip.nextEventSeconds) || clip.nextEventSeconds <= clip.impactSeconds)) {
    throw new Error('Invalid nextEventSeconds');
  }
}

export function auditClip(wav, clip) {
  validateClip(clip);
  const rate = wav.sampleRate;
  const onset = Math.round((clip.impactSeconds - clip.startSeconds) * rate);
  const duration = wav.frames / rate;
  const preSeconds = onset / rate;
  const postSeconds = duration - preSeconds;
  const measured = measureWav(wav, { tailWindowMs: 50 });
  const preRmsDbFS = gainToDb(rmsOfWindow(wav, Math.max(0, onset - Math.round(rate * 0.1)), onset));
  let impactPeak = 0;
  for (let frame = onset; frame < Math.min(wav.frames, onset + Math.round(rate * 0.05)); frame++) {
    for (let ch = 0; ch < wav.channels; ch++) impactPeak = Math.max(impactPeak, Math.abs(wav.samples[frame * wav.channels + ch]));
  }
  const riseDb = gainToDb(impactPeak) - preRmsDbFS;
  const tailBinsDbFS = Array.from({ length: 5 }, (_, i) => gainToDb(rmsOfWindow(wav,
    Math.max(0, wav.frames - Math.round(rate * (0.05 - i * 0.01))),
    Math.max(0, wav.frames - Math.round(rate * (0.04 - i * 0.01))))));
  const tailDescending = tailBinsDbFS.every((db, i) => i === 0 || db <= -70 || db <= tailBinsDbFS[i - 1] + 3);
  let clippedRun = 0;
  for (let ch = 0; ch < wav.channels; ch++) {
    let run = 0, previous = 0;
    for (let frame = 0; frame < wav.frames; frame++) {
      const value = wav.samples[frame * wav.channels + ch];
      run = Math.abs(value) >= 1 - 1 / 32768 ? (value * previous > 0 ? run + 1 : 1) : 0;
      clippedRun = Math.max(clippedRun, run); previous = value;
    }
  }
  const minimumPost = clip.intensity <= 0.3 ? 0.25 : clip.intensity === 0.5 ? 0.35
    : clip.intensity === 0.75 ? 0.45 : clip.shortTailReason?.trim() ? 0.35 : 0.5;
  const reasons = [];
  if (preSeconds < 0.1 - 1 / rate || preSeconds > 0.15 + 1 / rate) reasons.push('pre_duration');
  if (postSeconds < minimumPost - 2 / rate) reasons.push('post_duration');
  if (Math.abs(duration - (clip.endSeconds - clip.startSeconds)) > 2 / rate) reasons.push('decoded_duration');
  if (preRmsDbFS > -50) reasons.push('pre_noise');
  if (riseDb < 15 || impactPeak === 0) reasons.push('weak_onset');
  if (measured.tailRelDb > -45) reasons.push('tail_energy');
  if (!tailDescending) reasons.push('tail_rising');
  if (measured.peakDb > -1) reasons.push('peak_headroom');
  if (clippedRun >= 3) reasons.push('clipping');
  if (clip.nextEventSeconds != null && clip.nextEventSeconds - clip.endSeconds < 0.02 - 1 / rate) reasons.push('next_event_margin');
  return { passed: reasons.length === 0, reasons, durationSeconds: duration, preSeconds, postSeconds, minimumPost,
    preWindowSeconds: Math.min(0.1, preSeconds), preRmsDbFS, impactPeakDbFS: gainToDb(impactPeak), riseDb, peakDbFS: measured.peakDb,
    tailRmsDbFS: measured.tailDb, tailRelativeDb: measured.tailRelDb, tailBinsDbFS, tailDescending, clippedRun,
    manualStatus: 'pending', warnings: [
      '数值通过不等于无解说/咳嗽/第二次撞击；必须人工试听确认分类、力度和完整性',
      ...(clip.nextEventSeconds == null ? ['下一事件时间未确定，需检查裁剪边界'] : []),
      ...(clip.shortTailReason ? [`大力短尾例外：${clip.shortTailReason}`] : [])
    ] };
}
