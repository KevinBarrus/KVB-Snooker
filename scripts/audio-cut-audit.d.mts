import type { WavAudio } from './audio-review-lib.mjs';
export interface Clip {
  sourceId: string; startSeconds: number; impactSeconds: number; endSeconds: number;
  group: string; intensity: number; note: string; nextEventSeconds?: number | null; shortTailReason?: string;
}
export const GROUPS: string[];
export const INTENSITIES: number[];
export function validateClip(clip: Clip): void;
export function auditClip(wav: WavAudio, clip: Clip): {
  passed: boolean; reasons: string[]; durationSeconds: number; preSeconds: number; postSeconds: number;
  minimumPost: number; preRmsDbFS: number; impactPeakDbFS: number; riseDb: number; peakDbFS: number;
  tailRmsDbFS: number; tailRelativeDb: number; tailBinsDbFS: number[]; tailDescending: boolean;
  clippedRun: number; manualStatus: string; warnings: string[];
};
