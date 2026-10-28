// 声音第二轮对照试听的纯逻辑：WAV 读写、测量、淡出判定、合成 IR、盲标签。
// 不接触 ffmpeg，不读写仓库资源；由 scripts/audio-review.mjs 与单测共用。

const RIFF = "RIFF";
const WAVE = "WAVE";

export function readWav(bytes) {
  if (bytes.toString("ascii", 0, 4) !== RIFF || bytes.toString("ascii", 8, 12) !== WAVE) throw new Error("Expected RIFF WAVE");
  let format;
  let data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > bytes.length) throw new Error("Truncated WAV chunk");
    const name = bytes.toString("ascii", offset, offset + 4);
    if (name === "fmt ") format = bytes.subarray(offset + 8, end);
    if (name === "data") data = bytes.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (!format || format.length < 16 || !data?.length) throw new Error("Incomplete WAV");
  let tag = format.readUInt16LE(0);
  if (tag === 0xfffe && format.length >= 26) tag = format.readUInt16LE(24);
  const bits = tag === 1 ? 16 : 32;
  const channels = format.readUInt16LE(2);
  const sampleRate = format.readUInt32LE(4);
  if (channels < 1 || channels > 2 || sampleRate <= 0) throw new Error("Unsupported WAV layout");
  if (tag !== 1 && tag !== 3) throw new Error("Expected PCM16 or float32 WAV");
  const bytesPerSample = bits / 8;
  if (data.length % (channels * bytesPerSample)) throw new Error("Unaligned WAV data");
  const samples = new Float32Array(data.length / bytesPerSample);
  for (let i = 0; i < samples.length; ++i) {
    samples[i] = bits === 16 ? data.readInt16LE(i * 2) / 32768 : data.readFloatLE(i * 4);
  }
  return { sampleRate, channels, frames: samples.length / channels, samples };
}

// 末尾能量口径：最后 windowMs 内所有声道采样合并的 RMS，相对该文件峰值。
export function measureWav(wav, options = {}) {
  const tailWindowMs = options.tailWindowMs ?? 10;
  const onsetDb = options.onsetDb ?? -24;
  const preRollMs = options.preRollMs ?? 3;
  const { samples, channels, sampleRate, frames } = wav;
  let peak = 0;
  for (let i = 0; i < samples.length; ++i) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  const tailFrames = Math.max(1, Math.round(sampleRate * tailWindowMs / 1000));
  const tailStart = Math.max(0, frames - tailFrames);
  let tailSum = 0;
  for (let i = tailStart * channels; i < samples.length; ++i) {
    tailSum += samples[i] * samples[i];
  }
  const tailRms = Math.sqrt(tailSum / (samples.length - tailStart * channels));
  const threshold = peak * dbToGain(onsetDb);
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < threshold) ++first;
  const onsetSeconds = Math.min(frames, Math.floor(first / channels)) / sampleRate;
  return {
    peak, peakDb: gainToDb(peak), tailDb: gainToDb(tailRms), tailRelDb: gainToDb(tailRms / peak),
    onsetSeconds, baselineOffsetSeconds: Math.max(0, onsetSeconds - preRollMs / 1000)
  };
}

// 明显截断（> obviousDb）给长淡出，轻微（> minorDb）给短淡出，更干净的不处理。
export function fadeLengthMs(tailRelDb, config = {}) {
  const obviousDb = config.obviousDb ?? -30;
  const minorDb = config.minorDb ?? -40;
  if (!Number.isFinite(tailRelDb)) return null;
  if (tailRelDb > obviousDb) return config.obviousMs ?? 30;
  if (tailRelDb > minorDb) return config.minorMs ?? 15;
  return null;
}

export function decideFadeCandidates(tailRelDb, override, config = {}) {
  if (Array.isArray(override)) return [...override].filter(ms => Number.isFinite(ms) && ms > 0);
  const ms = fadeLengthMs(tailRelDb, config);
  return ms === null ? [] : [ms];
}

// 保守判据：降噪残差在撞击窗口内不得超过该阈值，否则该段不提供 C 版本。
export function decideDenoise(residualRelDb, limitDb) {
  return Number.isFinite(residualRelDb) && residualRelDb <= limitDb;
}

export function dbToGain(db) { return 10 ** (db / 20); }
export function gainToDb(gain) { return 20 * Math.log10(Math.max(gain, 1e-12)); }

export function rmsOfWindow(wav, fromFrame, toFrame) {
  const { samples, channels, frames } = wav;
  const start = Math.max(0, Math.min(frames, fromFrame));
  const end = Math.max(start, Math.min(frames, toFrame));
  const from = start * channels, to = end * channels;
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; ++i) { const v = samples[i]; sum += v * v; }
  return Math.sqrt(sum / (to - from));
}

// b 相对 a 在同一窗口内的能量差（dB），用于检查降噪残差是否吃掉了撞击。
export function windowEnergyRelDb(a, b, fromFrame, toFrame) {
  return gainToDb(rmsOfWindow(b, fromFrame, toFrame) / Math.max(rmsOfWindow(a, fromFrame, toFrame), 1e-12));
}

export function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// 合成场馆 IR：两声道去相关噪声 + 稀疏早期反射 + 高频更快衰减。
// 输出按总能量归一化（sum(x^2)=1），因此卷积不改变输入总能量，wet 增益可直接比较。
export function buildIr(options) {
  const sampleRate = options.sampleRate;
  const length = Math.round(sampleRate * options.durationSeconds);
  const preDelay = Math.round(sampleRate * options.preDelayMs / 1000);
  const rt60 = options.rt60Seconds;
  const highScale = options.highRt60Scale ?? 0.7;
  const crossHz = options.crossHz ?? 1500;
  const seed = options.seed;
  const random = makeRandom(seed);
  const channels = [new Float32Array(length), new Float32Array(length)];

  for (let ch = 0; ch < 2; ++ch) {
    const tapRandom = makeRandom(seed + 977 * (ch + 1));
    const taps = options.earlyTaps ?? 8;
    for (let tap = 0; tap < taps; ++tap) {
      const at = preDelay + Math.round((0.005 + tapRandom() * 0.055) * sampleRate);
      const amp = (1 - tap / (taps + 1)) * (0.4 + tapRandom() * 0.6) * (ch === tap % 2 ? 1 : 0.35);
      const burst = Math.round(sampleRate * 0.002);
      for (let i = 0; i < burst && at + i < length; ++i) {
        const window = Math.sin(Math.PI * i / burst) ** 2;
        channels[ch][at + i] += (tapRandom() * 2 - 1) * window * amp;
      }
    }
  }

  for (let ch = 0; ch < 2; ++ch) {
    const random2 = makeRandom(seed + 104729 * (ch + 3));
    const coefficient = 1 - Math.exp(-2 * Math.PI * crossHz / sampleRate);
    let low = 0;
    const fadeIn = Math.round(sampleRate * 0.004);
    for (let t = 0; t < length - preDelay; ++t) {
      const seconds = t / sampleRate;
      const noise = random2() * 2 - 1;
      low += (noise - low) * coefficient;
      // RT60 定义：幅度每 T60 秒衰减 60dB（不是每 T60 秒 -3dB）。
      const highDecay = dbToGain(-60 * seconds / (rt60 * highScale));
      const lowDecay = dbToGain(-60 * seconds / rt60);
      const rise = Math.min(1, t / fadeIn);
      const tailFade = Math.min(1, (length - preDelay - t) / (sampleRate * 0.05));
      channels[ch][preDelay + t] += (noise * highDecay + low * lowDecay) * rise * tailFade;
    }
  }

  let energy = 0;
  for (const channel of channels) for (const value of channel) energy += value * value;
  const scale = 1 / Math.sqrt(energy);
  for (const channel of channels) for (let i = 0; i < channel.length; ++i) channel[i] *= scale;
  return channels;
}

export function scaleChannels(channels, gain) {
  return channels.map(channel => channel.map(value => value * gain));
}

export function encodeWav(channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0].length;
  const data = Buffer.alloc(frames * count * 2);
  for (let frame = 0; frame < frames; ++frame) {
    for (let ch = 0; ch < count; ++ch) {
      const value = Math.max(-1, Math.min(1, channels[ch][frame]));
      data.writeInt16LE(Math.round(value * 32767), (frame * count + ch) * 2);
    }
  }
  const fmt = Buffer.alloc(24);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(count, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * count * 2, 8);
  fmt.writeUInt16LE(count * 2, 12);
  fmt.writeUInt16LE(16, 14);
  const header = Buffer.alloc(12);
  header.write(RIFF, 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write(WAVE, 8, "ascii");
  const fmtChunk = Buffer.alloc(8);
  fmtChunk.write("fmt ", 0, "ascii");
  fmtChunk.writeUInt32LE(24, 4);
  const dataChunk = Buffer.alloc(8);
  dataChunk.write("data", 0, "ascii");
  dataChunk.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, fmtChunk, fmt, dataChunk, data]);
}

const CODE_ALPHABET = "bcdfghjkmnpqrstvwxz23456789";

// 盲标签：按给定顺序稳定生成唯一三位码；映射只写入清单，页面仅存混淆后的名字。
export function blindCodes(names, seed, alphabet = CODE_ALPHABET) {
  const random = makeRandom(seed);
  const used = new Set(names.map(name => name.toLowerCase()));
  const codes = {};
  for (const name of names) {
    let code;
    do {
      code = "";
      for (let i = 0; i < 3; ++i) code += alphabet[Math.floor(random() * alphabet.length)];
    } while (used.has(code));
    used.add(code);
    codes[name] = code;
  }
  return codes;
}

// ---- WAV 片段运算与卷积（供混响组在 Node 内完成） ----

export function sliceWav(wav, startFrame, endFrame) {
  const start = Math.max(0, Math.min(wav.frames, startFrame));
  const end = Math.max(start, Math.min(wav.frames, endFrame));
  const frames = end - start;
  const samples = new Float32Array(frames * wav.channels);
  samples.set(wav.samples.subarray(start * wav.channels, end * wav.channels));
  return { sampleRate: wav.sampleRate, channels: wav.channels, frames, samples };
}

export function padWav(wav, frames) {
  if (wav.frames >= frames) return sliceWav(wav, 0, frames);
  const samples = new Float32Array(frames * wav.channels);
  samples.set(wav.samples);
  return { sampleRate: wav.sampleRate, channels: wav.channels, frames, samples };
}

// 余弦淡出：只作用于末端，不改变起音。
export function fadeOutWav(wav, ms) {
  const samples = Float32Array.from(wav.samples);
  const frames = Math.min(wav.frames, Math.round(wav.sampleRate * ms / 1000));
  const start = wav.frames - frames;
  for (let i = 0; i < frames; ++i) {
    const gain = 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / frames);
    for (let ch = 0; ch < wav.channels; ++ch) samples[(start + i) * wav.channels + ch] *= gain;
  }
  return { ...wav, samples };
}

export function scaleWav(wav, gain) {
  const samples = new Float32Array(wav.samples.length);
  for (let i = 0; i < samples.length; ++i) samples[i] = wav.samples[i] * gain;
  return { ...wav, samples };
}

export function addWav(a, b) {
  const frames = Math.max(a.frames, b.frames);
  const samples = new Float32Array(frames * a.channels);
  for (let i = 0; i < samples.length; ++i) samples[i] = (a.samples[i] ?? 0) + (b.samples[i] ?? 0);
  return { sampleRate: a.sampleRate, channels: a.channels, frames, samples };
}

export function peakOf(wav) {
  let peak = 0;
  for (let i = 0; i < wav.samples.length; ++i) {
    const value = Math.abs(wav.samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

function channelOf(wav, channel) {
  const out = new Float32Array(wav.frames);
  for (let i = 0; i < wav.frames; ++i) out[i] = wav.samples[i * wav.channels + channel];
  return out;
}

// 每声道与对应 IR 声道卷积；结果右补零到 totalFrames（保留混响尾）。
export function convolveStereo(wav, irChannels, totalFrames, fft) {
  const out = new Float32Array(totalFrames * 2);
  for (let channel = 0; channel < 2; ++channel) {
    const ir = irChannels[Math.min(channel, irChannels.length - 1)];
    const size = fft.convolutionSize(wav.frames, ir.length);
    let bySize = cachedIrSpectrum.get(ir);
    if (!bySize) { bySize = new Map(); cachedIrSpectrum.set(ir, bySize); }
    let irSpectrum = bySize.get(size);
    if (!irSpectrum) { irSpectrum = fft.spectrum(ir, size); bySize.set(size, irSpectrum); }
    const signal = fft.spectrum(channelOf(wav, channel), size);
    const length = Math.min(totalFrames, wav.frames + ir.length - 1);
    const result = fft.inverseInto([signal, irSpectrum], size, length);
    for (let i = 0; i < length; ++i) out[i * 2 + channel] = result[i];
  }
  return { sampleRate: wav.sampleRate, channels: 2, frames: totalFrames, samples: out };
}

const cachedIrSpectrum = new WeakMap();

export function encodeWavAudio(wav) {
  const channels = [];
  for (let channel = 0; channel < wav.channels; ++channel) {
    const data = new Float32Array(wav.frames);
    for (let i = 0; i < wav.frames; ++i) data[i] = wav.samples[i * wav.channels + channel];
    channels.push(data);
  }
  return encodeWav(channels, wav.sampleRate);
}

// 首个 60ms 的互相关滞后：用于验证处理没有移动起音（对电平与峰值变化免疫）。
export function lagBetween(reference, candidate, maxLag = 64) {
  const frames = Math.min(reference.frames, candidate.frames, Math.round(0.06 * reference.sampleRate));
  let best = { lag: 0, score: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; ++lag) {
    let sum = 0;
    for (let i = 0; i < frames; ++i) {
      const j = i + lag;
      if (j < 0 || j >= candidate.frames) continue;
      for (let ch = 0; ch < reference.channels; ++ch) sum += reference.samples[i * reference.channels + ch] * candidate.samples[j * candidate.channels + ch];
    }
    if (sum > best.score) best = { lag, score: sum };
  }
  return best.lag;
}
