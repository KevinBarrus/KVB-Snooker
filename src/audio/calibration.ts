export interface SoundCurve { readonly silentBelow: number; readonly fullAt: number; readonly exponent: number; readonly gain: number }
export interface AudioCalibration {
  readonly cueSpeedPolynomial: readonly [number, number, number];
  readonly tipBands: readonly [number, number, number];
  readonly cue: SoundCurve;
  readonly ball: SoundCurve;
  readonly pocket: SoundCurve;
  readonly pocketHistory: { readonly seconds: number; readonly distance: number; readonly jawMinimumSpeed: number };
  readonly playback: { readonly master: number; readonly voices: number; readonly threshold: number;
    readonly knee: number; readonly ratio: number; readonly attack: number; readonly release: number };
}

export const AUDIO_CALIBRATION: AudioCalibration = {
  // PCOL L5448-5455
  cueSpeedPolynomial: [66, 38.2, 1.6],
  tipBands: [-.38, -.1, .1],
  cue: { silentBelow: 0, fullAt: 1, exponent: .65, gain: .45 },
  ball: { silentBelow: .03, fullAt: 4, exponent: .65, gain: .48 },
  pocket: { silentBelow: .25, fullAt: 2.8, exponent: .85, gain: .5 },
  pocketHistory: { seconds: .8, distance: .3, jawMinimumSpeed: .08 },
  playback: { master: .7, voices: 24, threshold: -8, knee: 12, ratio: 8, attack: .003, release: .12 }
};

export function intensityAt(value: number, curve: SoundCurve): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, (value - curve.silentBelow) / (curve.fullAt - curve.silentBelow))) : 0;
}

export function volumeAt(value: number, curve: SoundCurve): number {
  return intensityAt(value, curve) ** curve.exponent * curve.gain;
}
