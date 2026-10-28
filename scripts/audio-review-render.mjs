// 声音第二轮对照试听的 ffmpeg 渲染：单段裁剪/淡出/降噪/卷积、残差与事件序列。
// 只写调用方给定的输出路径，不接触仓库资源目录。
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dbToGain, encodeWav } from "./audio-review-lib.mjs";

const COMMON = ["-hide_banner", "-v", "error", "-nostdin", "-y"];
const OUTPUT = ["-ac", "2", "-ar", "48000", "-map_metadata", "-1", "-fflags", "+bitexact"];

// 中间探针用 float32，避免多路求和时在 16bit 写出阶段被硬削顶。
function outputArgs(format) {
  return [...OUTPUT, "-c:a", format === "f32" ? "pcm_f32le" : "pcm_s16le"];
}

function run(args) {
  try {
    execFileSync("ffmpeg", [...COMMON, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    throw new Error(`ffmpeg failed: ${message}`);
  }
}

function trim(offset) { return `atrim=start=${offset.toFixed(6)},asetpts=PTS-STARTPTS`; }

function fade(trimmedSeconds, ms) {
  const seconds = ms / 1000;
  const start = Math.max(0, trimmedSeconds - seconds);
  return `afade=t=out:st=${start.toFixed(6)}:d=${seconds.toFixed(6)}`;
}

function denoiseFilter(settings) {
  return `afftdn=nr=${settings.noiseReduction}:nf=${settings.noiseFloor}:tn=${settings.trackNoise ? 1 : 0}`;
}

// afftdn 输出恒定延后 latencyMs 且不向滤镜图报告延迟，必须显式裁齐；
// 前置 primeMs 静音用于引导噪声跟踪，避免取样点在撞击上时被当作噪声压掉起音。
function denoiseChain(settings, trimmedSeconds) {
  const prime = (settings.primeMs ?? 0) / 1000;
  const latency = (settings.latencyMs ?? 0) / 1000;
  const parts = [];
  if (prime > 0) parts.push(`adelay=${Math.round(prime * 1000)}|${Math.round(prime * 1000)}`);
  parts.push(denoiseFilter(settings));
  const skip = prime + latency;
  if (skip > 0) {
    parts.push(`atrim=start=${skip.toFixed(4)}`, "asetpts=PTS-STARTPTS",
      `apad=whole_dur=${trimmedSeconds.toFixed(6)}`);
  }
  return parts;
}

function levelFilter(db) { return Math.abs(db) < 1e-9 ? null : `volume=${db.toFixed(3)}dB`; }

function trimmedSecondsOf(options) {
  return options.offset > 0 ? options.durationSeconds - options.offset : options.durationSeconds;
}

export function ffmpegVersion() {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().split("\n")[0].trim();
  } catch { return "unavailable"; }
}

export async function writeIr(path, channels, sampleRate) {
  await writeFile(path, encodeWav(channels, sampleRate));
}

export function renderSingle(options) {
  const trimmed = trimmedSecondsOf(options);
  const filters = [trim(options.offset)];
  if (options.denoise) filters.push(...denoiseChain(options.denoise, trimmed));
  if (options.fadeMs) filters.push(fade(trimmed, options.fadeMs));
  const level = levelFilter(options.volumeDb ?? 0);
  if (level) filters.push(level);
  run(["-i", options.input, "-af", filters.join(","), ...outputArgs(options.format), options.out]);
  return trimmedSecondsOf(options);
}

// 残差 = 原信号 − 降噪后信号，用于检查降噪是否吃掉了撞击或有效尾音。
export function renderResidual(options) {
  const trimmed = trimmedSecondsOf(options);
  const chain = [
    `${trim(options.offset)},asplit=2[keep][work]`,
    `[work]${denoiseChain(options.denoise, trimmed).join(",")}[clean]`,
    "[keep]volume=-1[neg]",
    "[neg][clean]amix=inputs=2:normalize=0:duration=shortest[out]"
  ];
  run(["-i", options.input, "-filter_complex", chain.join(";"), "-map", "[out]", ...outputArgs(options.format), options.out]);
}

export function renderSequence(options) {
  const inputs = [];
  for (const event of options.events) inputs.push("-i", event.path);
  const parts = options.events.map((event, index) =>
    `[${index}:a]adelay=${Math.round(event.atMs)}|${Math.round(event.atMs)}[e${index}]`);
  const labels = options.events.map((_, index) => `[e${index}]`).join("");
  let graph = `${parts.join(";")};${labels}amix=inputs=${options.events.length}:normalize=0:duration=longest`;
  if (options.compressor) {
    const settings = options.compressor;
    graph += `,acompressor=threshold=${dbToGain(settings.thresholdDb).toFixed(6)}:knee=${settings.kneeDb}` +
      `:ratio=${settings.ratio}:attack=${settings.attackMs}:release=${settings.releaseMs}:makeup=${settings.makeup}`;
  }
  const level = levelFilter(options.volumeDb ?? 0);
  if (level) graph += `,${level}`;
  run([...inputs, "-filter_complex", `${graph}[out]`, "-map", "[out]", ...outputArgs(options.format), options.out]);
}
