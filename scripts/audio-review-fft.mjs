// 迭代基-2 FFT 与快速卷积：本机 ffmpeg 6.1.1 的 afir 对本项目 IR 恒输出静音
// （已用 delta IR 与 ffmpeg 自身生成的 IR 复现），故卷积在 Node 内完成。
// 纯数值实现，无外部依赖；同一输入必得同一输出。

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function transforms(size) {
  const reverse = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; ++i) {
    let value = 0;
    for (let bit = 0; bit < bits; ++bit) value |= ((i >> bit) & 1) << (bits - 1 - bit);
    reverse[i] = value;
  }
  const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; ++i) {
    cos[i] = Math.cos(2 * Math.PI * i / size);
    sin[i] = Math.sin(2 * Math.PI * i / size);
  }
  return { reverse, cos, sin };
}

const cache = new Map();
function tablesFor(size) {
  if (!cache.has(size)) cache.set(size, transforms(size));
  return cache.get(size);
}

function fft(re, im, inverse) {
  const size = re.length;
  const { reverse, cos, sin } = tablesFor(size);
  for (let i = 0; i < size; ++i) {
    const j = reverse[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2, step = size / span;
    for (let start = 0; start < size; start += span) {
      for (let k = 0; k < half; ++k) {
        const wr = cos[k * step], wi = inverse ? sin[k * step] : -sin[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

export function spectrum(samples, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  re.set(samples.subarray(0, Math.min(samples.length, size)));
  fft(re, im, false);
  return { re, im };
}

// 频域相乘后逆变换；size 必须与两段频谱一致。
export function inverseInto(spectra, size, length) {
  const re = Float64Array.from(spectra[0].re), im = Float64Array.from(spectra[0].im);
  for (const s of spectra.slice(1)) {
    for (let i = 0; i < size; ++i) {
      const r = re[i] * s.re[i] - im[i] * s.im[i];
      im[i] = re[i] * s.im[i] + im[i] * s.re[i];
      re[i] = r;
    }
  }
  fft(re, im, true);
  const out = new Float32Array(length);
  for (let i = 0; i < length; ++i) out[i] = re[i] / size;
  return out;
}

export function convolutionSize(aLength, bLength) {
  return nextPowerOfTwo(aLength + bLength - 1);
}
