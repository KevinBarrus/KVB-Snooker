import { describe, expect, it } from "vitest";
import {
  addWav, blindCodes, buildIr, convolveStereo, dbToGain, decideDenoise, decideFadeCandidates,
  encodeWav, encodeWavAudio, fadeLengthMs, fadeOutWav, gainToDb, lagBetween, measureWav, padWav,
  peakOf, readWav, rmsOfWindow, scaleChannels, scaleWav, sliceWav, windowEnergyRelDb,
  type WavAudio
} from "../../scripts/audio-review-lib.mjs";
import * as fft from "../../scripts/audio-review-fft.mjs";

const RATE = 48000;

function makeWav(frames: number, fill: (frame: number) => number, channels = 2): WavAudio {
  const samples = new Float32Array(frames * channels);
  for (let frame = 0; frame < frames; ++frame) {
    for (let channel = 0; channel < channels; ++channel) samples[frame * channels + channel] = fill(frame);
  }
  return { sampleRate: RATE, channels, frames, samples };
}

// 30ms 静音后是一次衰减撞击，可选末端淡出。
function impact({ bodyFrames = 4800, fadeMs = 0, silentFrames = 1440 } = {}): WavAudio {
  const total = silentFrames + bodyFrames;
  const wav = makeWav(total, frame => {
    const local = frame - silentFrames;
    if (local < 0) return 0;
    return 0.8 * Math.exp(-local / 6000) * Math.sin(local * 0.3);
  });
  return fadeMs ? fadeOutWav(wav, fadeMs) : wav;
}

describe("WAV 读写与测量", () => {
  it("编码后可原样读回", () => {
    const wav = impact();
    const decoded = readWav(encodeWavAudio(wav));
    expect(decoded.sampleRate).toBe(RATE);
    expect(decoded.channels).toBe(2);
    expect(decoded.frames).toBe(wav.frames);
    for (const frame of [0, 100, 2000, wav.frames - 1]) {
      expect(decoded.samples[frame * 2]).toBeCloseTo(wav.samples[frame * 2], 3);
    }
  });

  it("拒绝非 PCM16/float32 的布局", () => {
    expect(() => readWav(Buffer.from("RIFF0000WAVEjunk"))).toThrow();
  });

  it("末尾能量按相对峰值计算，淡出后明显下降", () => {
    const hard = measureWav(impact());
    const faded = measureWav(impact({ fadeMs: 30 }));
    expect(hard.tailRelDb).toBeGreaterThan(-30);
    expect(faded.tailRelDb).toBeLessThan(hard.tailRelDb - 6);
  });

  it("播放起点回退 preRoll，静音前导时钳到 0", () => {
    const measured = measureWav(impact());
    expect(measured.onsetSeconds).toBeCloseTo(0.03, 3);
    expect(measured.baselineOffsetSeconds).toBeCloseTo(0.027, 3);
    const immediate = measureWav(impact({ silentFrames: 0 }));
    expect(immediate.onsetSeconds).toBeLessThan(0.001);
    expect(immediate.baselineOffsetSeconds).toBe(0);
  });

  it("窗口能量比较与满量程输入不抛错", () => {
    const a = makeWav(1000, () => 1);
    const b = makeWav(1000, () => 0.5);
    expect(gainToDb(rmsOfWindow(a, 0, 1000))).toBeCloseTo(0, 1);
    expect(windowEnergyRelDb(a, b, 0, 1000)).toBeCloseTo(-6.02, 1);
  });
});

describe("处理判定", () => {
  it("按末尾能量选淡出长度，干净样本不处理", () => {
    expect(fadeLengthMs(-15)).toBe(30);
    expect(fadeLengthMs(-35)).toBe(15);
    expect(fadeLengthMs(-45)).toBeNull();
    expect(fadeLengthMs(Number.NaN)).toBeNull();
  });

  it("配置覆盖优先于测量结果，空覆盖表示跳过", () => {
    expect(decideFadeCandidates(-15, [15, 30])).toEqual([15, 30]);
    expect(decideFadeCandidates(-15, [])).toEqual([]);
    expect(decideFadeCandidates(-15, undefined)).toEqual([30]);
  });

  it("降噪残差超过阈值时不可用", () => {
    expect(decideDenoise(-30, -20)).toBe(true);
    expect(decideDenoise(-19.9, -20)).toBe(false);
    expect(decideDenoise(Number.NaN, -20)).toBe(false);
  });
});

describe("合成 IR", () => {
  const options = { sampleRate: RATE, durationSeconds: 1, preDelayMs: 25, rt60Seconds: 0.6, seed: 4242 };

  it("同种子生成完全相同的 IR", () => {
    const a = buildIr(options);
    const b = buildIr(options);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
  });

  it("总能量归一化，前后半段能量递减", () => {
    const [left, right] = buildIr(options);
    let energy = 0;
    for (const value of left) energy += value * value;
    for (const value of right) energy += value * value;
    expect(energy).toBeCloseTo(1, 3);
    const half = Math.floor(left.length / 2);
    const early = (wav: Float32Array) => wav.subarray(0, half).reduce((sum, v) => sum + v * v, 0);
    expect(early(left.subarray(half))).toBeLessThan(early(left) * 0.5);
  });

  it("左右声道去相关", () => {
    const [left, right] = buildIr(options);
    let dot = 0, l = 0, r = 0;
    for (let i = 0; i < left.length; ++i) { dot += left[i] * right[i]; l += left[i] ** 2; r += right[i] ** 2; }
    expect(Math.abs(dot / Math.sqrt(l * r))).toBeLessThan(0.5);
  });
});

describe("FFT 卷积", () => {
  it("与直接卷积一致", () => {
    const size = fft.convolutionSize(4, 3);
    const result = fft.inverseInto([
      fft.spectrum(Float32Array.from([1, 2, 3, 0]), size),
      fft.spectrum(Float32Array.from([1, 1, 1]), size)
    ], size, 6);
    expect(Array.from(result).map(value => Number(value.toFixed(3))))
      .toEqual([1, 3, 6, 5, 3, 0]);
  });

  it("冲激信号卷积 IR 即为 IR 本身", () => {
    const ir = buildIr({ sampleRate: RATE, durationSeconds: 0.2, preDelayMs: 10, rt60Seconds: 0.3, seed: 9 });
    const impulse = makeWav(64, frame => (frame === 0 ? 1 : 0));
    const out = convolveStereo(impulse, ir, 64 + ir[0].length, fft);
    expect(out.frames).toBe(64 + ir[0].length);
    for (const frame of [0, 480, 4000]) {
      expect(out.samples[frame * 2]).toBeCloseTo(ir[0][frame], 5);
    }
    expect(out.samples[(out.frames - 1) * 2]).toBeCloseTo(0, 6);
  });

  it("卷积输出能量与输入同量级（能量归一化 IR）", () => {
    const ir = buildIr({ sampleRate: RATE, durationSeconds: 0.5, preDelayMs: 20, rt60Seconds: 0.4, seed: 7 });
    const source = makeWav(2400, frame => Math.sin(frame * 0.05) * 0.5);
    const out = convolveStereo(source, ir, 2400 + ir[0].length, fft);
    const energy = (wav: WavAudio) => wav.samples.reduce((sum, value) => sum + value * value, 0);
    const ratio = gainToDb(Math.sqrt(energy(out) / energy(source)));
    expect(ratio).toBeGreaterThan(-6);
    expect(ratio).toBeLessThan(8);
  });
});

describe("片段运算", () => {
  it("切片、补零与缩放不改变采样率", () => {
    const wav = impact();
    const sliced = sliceWav(wav, 100, 200);
    expect(sliced.frames).toBe(100);
    expect(sliced.sampleRate).toBe(RATE);
    expect(padWav(sliced, 300).frames).toBe(300);
    expect(padWav(sliced, 300).samples[250 * 2]).toBe(0);
    expect(peakOf(scaleWav(wav, 0.5))).toBeCloseTo(peakOf(wav) * 0.5, 5);
  });

  it("叠加保持最长长度", () => {
    const a = makeWav(100, () => 0.25);
    const b = makeWav(200, () => 0.25);
    const sum = addWav(a, b);
    expect(sum.frames).toBe(200);
    expect(sum.samples[10]).toBeCloseTo(0.5, 5);
    expect(sum.samples[150 * 2]).toBeCloseTo(0.25, 5);
  });

  it("淡出只影响末端", () => {
    const wav = makeWav(4800, () => 1);
    const faded = fadeOutWav(wav, 10);
    expect(faded.samples[0]).toBe(1);
    expect(faded.samples[(4800 - 1) * 2]).toBeLessThan(0.01);
  });
});

describe("互相关与盲标签", () => {
  it("识别整数位移", () => {
    const reference = impact();
    const shifted = makeWav(reference.frames, frame => (frame >= 5 ? reference.samples[(frame - 5) * 2] : 0));
    expect(lagBetween(reference, shifted)).toBe(5);
    expect(lagBetween(reference, reference)).toBe(0);
  });

  it("盲标签唯一、稳定且不与真实名冲突", () => {
    const names = ["a", "b", "c", "A"];
    const codes = blindCodes(names, 11);
    expect(blindCodes(names, 11)).toEqual(codes);
    expect(new Set(Object.values(codes)).size).toBe(names.length);
    for (const code of Object.values(codes)) {
      expect(code).toHaveLength(3);
      expect(code).not.toBe(code.toUpperCase());
    }
  });

  it("增益与分贝互换", () => {
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3);
    expect(gainToDb(1)).toBeCloseTo(0, 6);
  });

  it("IR 缩放按声道逐点乘增益", () => {
    const ir = buildIr({ sampleRate: RATE, durationSeconds: 0.1, preDelayMs: 5, rt60Seconds: 0.2, seed: 3 });
    const scaled = scaleChannels(ir, 0.5);
    for (const frame of [0, 120, 4000]) expect(scaled[0][frame]).toBeCloseTo(ir[0][frame] * 0.5, 6);
  });

  it("写出时把越界采样钳到满量程", () => {
    const wav = makeWav(64, () => 4);
    const decoded = readWav(encodeWav([wav.samples], RATE));
    expect(peakOf(decoded)).toBeLessThanOrEqual(1);
    expect(peakOf(decoded)).toBeGreaterThan(0.9);
  });
});
