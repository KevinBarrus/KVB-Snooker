export interface WavAudio { sampleRate: number; channels: number; frames: number; samples: Float32Array }
export interface WavMeasure {
  peak: number; peakDb: number; tailDb: number; tailRelDb: number;
  onsetSeconds: number; baselineOffsetSeconds: number;
}
export interface MeasureOptions { tailWindowMs?: number; onsetDb?: number; preRollMs?: number }
export interface FadeConfig { obviousDb?: number; minorDb?: number; obviousMs?: number; minorMs?: number }
export interface IrOptions {
  sampleRate: number; durationSeconds: number; preDelayMs: number; rt60Seconds: number;
  seed: number; highRt60Scale?: number; crossHz?: number; earlyTaps?: number;
}

export declare function readWav(bytes: Buffer): WavAudio;
export declare function measureWav(wav: WavAudio, options?: MeasureOptions): WavMeasure;
export declare function fadeLengthMs(tailRelDb: number, config?: FadeConfig): number | null;
export declare function decideFadeCandidates(tailRelDb: number, override: number[] | undefined, config?: FadeConfig): number[];
export declare function decideDenoise(residualRelDb: number, limitDb: number): boolean;
export declare function dbToGain(db: number): number;
export declare function gainToDb(gain: number): number;
export declare function rmsOfWindow(wav: WavAudio, fromFrame: number, toFrame: number): number;
export declare function windowEnergyRelDb(a: WavAudio, b: WavAudio, fromFrame: number, toFrame: number): number;
export declare function makeRandom(seed: number): () => number;
export declare function buildIr(options: IrOptions): Float32Array[];
export declare function scaleChannels(channels: Float32Array[], gain: number): Float32Array[];
export declare function encodeWav(channels: Float32Array[], sampleRate: number): Buffer;
export declare function blindCodes(names: string[], seed: number, alphabet?: string): Record<string, string>;

export declare function sliceWav(wav: WavAudio, startFrame: number, endFrame: number): WavAudio;
export declare function padWav(wav: WavAudio, frames: number): WavAudio;
export declare function fadeOutWav(wav: WavAudio, ms: number): WavAudio;
export declare function scaleWav(wav: WavAudio, gain: number): WavAudio;
export declare function addWav(a: WavAudio, b: WavAudio): WavAudio;
export declare function peakOf(wav: WavAudio): number;
export declare function encodeWavAudio(wav: WavAudio): Buffer;
export interface FftApi {
  spectrum(samples: Float32Array, size: number): { re: Float64Array; im: Float64Array };
  inverseInto(spectra: { re: Float64Array; im: Float64Array }[], size: number, length: number): Float32Array;
  convolutionSize(aLength: number, bLength: number): number;
}
export declare function lagBetween(reference: WavAudio, candidate: WavAudio, maxLag?: number): number;
export declare function convolveStereo(wav: WavAudio, irChannels: Float32Array[], totalFrames: number, fft: FftApi): WavAudio;
