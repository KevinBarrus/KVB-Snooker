export interface Spectrum { re: Float64Array; im: Float64Array }
export declare function spectrum(samples: Float32Array, size: number): Spectrum;
export declare function inverseInto(spectra: Spectrum[], size: number, length: number): Float32Array;
export declare function convolutionSize(aLength: number, bLength: number): number;
