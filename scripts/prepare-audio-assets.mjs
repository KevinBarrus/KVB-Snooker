import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";

const sources = JSON.parse(await readFile(new URL("./audio-sources.json", import.meta.url), "utf8"));
const root = resolve(process.argv[2] ?? "local-audio");
const output = resolve("public/assets/audio");
const config = sources.preparation;

function measure(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Expected RIFF WAVE");
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > bytes.length) throw new Error("Truncated WAV chunk");
    const name = bytes.toString("ascii", offset, offset + 4);
    if (name === "fmt ") format = bytes.subarray(offset + 8, end);
    if (name === "data") data = bytes.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (!format || format.length < 16 || !data?.length || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) {
    throw new Error("Expected nonempty PCM16 WAV");
  }
  const channels = format.readUInt16LE(2), rate = format.readUInt32LE(4);
  if (![1, 2].includes(channels) || rate <= 0 || data.length % (channels * 2)) throw new Error("Invalid WAV layout");
  const frames = data.length / (channels * 2), window = Math.max(1, Math.round(rate * config.windowMs / 1000));
  let peak = 0, maxRms = 0;
  for (let start = 0; start < frames; start += window) {
    const end = Math.min(frames, start + window);
    let sum = 0;
    for (let i = start * channels; i < end * channels; ++i) {
      const value = data.readInt16LE(i * 2) / 32768;
      sum += value * value; peak = Math.max(peak, Math.abs(value));
    }
    maxRms = Math.max(maxRms, Math.sqrt(sum / ((end - start) * channels)));
  }
  if (peak === 0) throw new Error("Silent WAV");
  let first = 0;
  while (first < frames * channels && Math.abs(data.readInt16LE(first * 2) / 32768) < peak * 10 ** (config.onsetDb / 20)) ++first;
  const correctionDb = Math.max(-config.maxCorrectionDb, Math.min(config.maxCorrectionDb,
    config.targetRmsDb - 20 * Math.log10(maxRms)));
  return { gain: Number((10 ** (correctionDb / 20)).toFixed(6)),
    offset: Math.max(0, Math.floor(first / channels) / rate - config.preRollMs / 1000),
    duration: frames / rate, peak, rms: maxRms };
}

const prepared = [];
const ids = new Set();
for (const entry of sources.samples) {
  if (ids.has(entry.id)) throw new Error(`Duplicate sample: ${entry.id}`);
  ids.add(entry.id);
  const path = resolve(root, entry.source), rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Source escapes local audio directory");
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`Audio digest mismatch: ${entry.source}`);
  const measured = measure(bytes);
  const filename = `${entry.id}-${entry.sha256.slice(0, 12)}.wav`;
  prepared.push({ source: path, filename, sample: {
    id: entry.id, url: `/assets/audio/${filename}`, group: entry.group, intensity: entry.intensity, ...measured
  } });
}
await mkdir(output, { recursive: true });
for (const entry of prepared) await copyFile(entry.source, resolve(output, entry.filename));
await writeFile(resolve(output, "manifest.json"), JSON.stringify({ version: 1, samples: prepared.map(e => e.sample) }, null, 2) + "\n");
console.log(`Prepared ${prepared.length} checksum-verified WAV files; originals unchanged.`);
console.log(`Playback gains ${Math.min(...prepared.map(e => e.sample.gain)).toFixed(3)}–${Math.max(...prepared.map(e => e.sample.gain)).toFixed(3)}; offsets ${Math.min(...prepared.map(e => e.sample.offset)).toFixed(3)}–${Math.max(...prepared.map(e => e.sample.offset)).toFixed(3)}s.`);
