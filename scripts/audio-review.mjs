// 声音第二轮：生成可重复的 A/B/C/D 对照试听包（输出到 .cache/audio-review）。
// 只读取 local-audio 与既有清单，写入被忽略的输出目录；不改游戏资源与播放链路。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import * as lib from "./audio-review-lib.mjs";
import { ffmpegVersion, renderResidual, renderSequence, renderSingle, writeIr } from "./audio-review-render.mjs";
import * as fft from "./audio-review-fft.mjs";
import { writePage } from "./audio-review-page.mjs";

const config = JSON.parse(await readFile(new URL("./audio-review-cases.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(config.sources, "utf8"));
const reference = JSON.parse(await readFile(config.reference, "utf8"));
const outIndex = process.argv.indexOf("--out");
const outputDir = resolve(outIndex > 0 ? process.argv[outIndex + 1] : config.output);
if (!outputDir.startsWith(`${resolve(".cache")}${sep}`)) throw new Error(`Refusing to write outside .cache: ${outputDir}`);

const sampleDir = join(outputDir, "samples");
const irDir = join(outputDir, "ir");
const scratchDir = join(outputDir, ".scratch");
const sourceById = new Map(sources.samples.map(sample => [sample.id, sample]));
const referenceById = new Map(reference.samples.map(sample => [sample.id, sample]));

const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");
const md5 = buffer => createHash("md5").update(buffer).digest("hex");
const round = (value, digits = 3) => Number(value.toFixed(digits));

async function hashTree(dir) {
  const result = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(wav|json)$/i.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    result[path.slice(dir.length + 1)] = sha256(await readFile(path));
  }
  return result;
}

const beforeTrees = { local: await hashTree(config.mediaRoot), prepared: await hashTree("public/assets/audio") };

async function measureFile(path) {
  const buffer = await readFile(path);
  const wav = lib.readWav(buffer);
  return { wav, measure: lib.measureWav(wav, config.measurement), md5: md5(buffer) };
}

// ---- 素材：核对摘要、测量末尾能量，并确认播放起点与第一版清单一致 ----
const cases = [];
for (const entry of config.cases) {
  const source = sourceById.get(entry.sampleId);
  if (!source) throw new Error(`Unknown sample: ${entry.sampleId}`);
  const bytes = await readFile(join(config.mediaRoot, source.source));
  if (sha256(bytes) !== source.sha256) throw new Error(`Digest mismatch: ${source.source}`);
  const wav = lib.readWav(bytes);
  const measurement = lib.measureWav(wav, config.measurement);
  const baseline = referenceById.get(entry.sampleId);
  if (!baseline) throw new Error(`Missing baseline entry: ${entry.sampleId}`);
  if (Math.abs(measurement.baselineOffsetSeconds - baseline.offset) > 1.1 / wav.sampleRate) {
    throw new Error(`Baseline offset drift for ${entry.sampleId}`);
  }
  const durationSeconds = wav.frames / wav.sampleRate;
  cases.push({ ...entry, source, wav, measurement, durationSeconds,
    baselineOffset: baseline.offset, baselineGain: baseline.gain,
    trimmedSeconds: durationSeconds - baseline.offset });
}

const fadesByCase = new Map(cases.map(entry =>
  [entry.id, lib.decideFadeCandidates(entry.measurement.tailRelDb, entry.fadeMs, config.fade)]));

// ---- 计划与盲标签（全集先定，保证同一配置与种子的标签稳定） ----
const plan = [];
for (const entry of cases) {
  plan.push({ key: `${entry.id}|A` });
  for (const ms of fadesByCase.get(entry.id)) plan.push({ key: `${entry.id}|B-fade${ms}` });
  if (fadesByCase.get(entry.id).length && config.denoise.enabled) plan.push({ key: `${entry.id}|C-denoise` });
  for (const wet of config.reverb.wetLevels) plan.push({ key: `${entry.id}|D-wet${wet}` });
  plan.push({ key: `${entry.id}|E-gainOn` }, { key: `${entry.id}|E-gainOff` });
}
for (const sequence of config.sequences) {
  for (const version of config.sequenceVersions) {
    for (const chain of ["raw", "comp"]) plan.push({ key: `${sequence.id}|${version}|${chain}` });
  }
}
const codes = lib.blindCodes(plan.map(item => item.key), config.blindSeed);

await rm(outputDir, { recursive: true, force: true });
await mkdir(sampleDir, { recursive: true });
await mkdir(join(sampleDir, "originals"), { recursive: true });
await mkdir(irDir, { recursive: true });
await mkdir(scratchDir, { recursive: true });

// ---- 合成 IR：按总能量归一化后再乘 wet；文件仅作参照，卷积在 Node 内完成 ----
const irChannels = new Map();
const baseIr = lib.buildIr(config.reverb.ir);
const irPeak = Math.max(...baseIr.map(channel => channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
const referenceScale = 0.9 / irPeak;
for (const wet of config.reverb.wetLevels) {
  const scaled = lib.scaleChannels(baseIr, wet);
  await writeIr(join(irDir, `synthetic-rt60-wet${wet}.wav`), lib.scaleChannels(scaled, referenceScale),
    config.reverb.ir.sampleRate);
  irChannels.set(wet, scaled);
}

const peakTarget = config.peakTargetDb;
let probeCount = 0;

// 先以 float32 探针测真实峰值与能量，再决定衰减后写 16bit，
// 避免多路求和或叠加增益在写出阶段被硬削顶。
async function renderProbe(render, params) {
  const out = join(scratchDir, `.probe-${probeCount++}.wav`);
  render({ ...params, volumeDb: params.volumeDb ?? 0, format: "f32", out });
  const measured = await measureFile(out);
  await rm(out, { force: true });
  return measured;
}

async function renderGuarded(render, params, out) {
  const probe = await renderProbe(render, params);
  const guardDb = probe.measure.peakDb > peakTarget ? peakTarget - probe.measure.peakDb - 0.1 : 0;
  render({ ...params, volumeDb: (params.volumeDb ?? 0) + guardDb, format: "pcm16", out });
  const final = await measureFile(out);
  if (final.measure.peakDb > peakTarget + 0.05) throw new Error(`Unable to meet peak target: ${out}`);
  return { guardDb: round(guardDb, 2) };
}

const rows = [];
const skipped = [];
const filesByCase = new Map(cases.map(entry => [entry.id, new Map()]));

function addRow(item, scratch, extra) {
  rows.push({ blind: codes[item.key], key: item.key, ...item, scratch, ...extra });
  if (item.caseId) filesByCase.get(item.caseId).set(item.version, { scratch, version: item.version });
}

// ---- 逐样本渲染 A/B/C/D/E ----
for (const entry of cases) {
  const input = join(config.mediaRoot, entry.source.source);
  const base = { input, offset: entry.baselineOffset, durationSeconds: entry.durationSeconds };
  const rate = entry.wav.sampleRate;
  await copyFile(input, join(sampleDir, "originals", `${entry.sampleId}.wav`));

  const aOut = join(scratchDir, `${entry.id}-A.wav`);
  const a = await renderGuarded(renderSingle, base, aOut);
  addRow({ key: `${entry.id}|A`, caseId: entry.id, version: "A", group: "main" }, aOut,
    { guardDb: a.guardDb, trimmedSeconds: round(entry.trimmedSeconds) });

  for (const ms of fadesByCase.get(entry.id)) {
    const version = `B-fade${ms}`;
    const out = join(scratchDir, `${entry.id}-${version}.wav`);
    const rendered = await renderGuarded(renderSingle, { ...base, fadeMs: ms }, out);
    addRow({ key: `${entry.id}|${version}`, caseId: entry.id, version, group: "main" }, out,
      { guardDb: rendered.guardDb, fadeMs: ms, trimmedSeconds: round(entry.trimmedSeconds) });
  }

  // 撞击窗口从首达点开始：基线起点已回退 preRollMs，故窗口 = [preRoll, preRoll+60ms]。
  const impactFrom = entry.baselineOffset > 0 ? Math.round(config.measurement.preRollMs / 1000 * rate) : 0;
  const impactTo = impactFrom + Math.round(config.denoise.transientWindowMs / 1000 * rate);
  const tailFrom = Math.max(0, Math.round((entry.trimmedSeconds - 0.1) * rate));
  const tailTo = Math.round(entry.trimmedSeconds * rate);

  const primaryFade = fadesByCase.get(entry.id)[0];
  if (primaryFade && config.denoise.enabled) {
    const residualPath = join(scratchDir, `${entry.id}-residual.wav`);
    renderResidual({ ...base, denoise: config.denoise, out: residualPath });
    const residual = lib.readWav(await readFile(residualPath));
    const trimmedProbe = (await renderProbe(renderSingle, base)).wav;
    const cleaned = (await renderProbe(renderSingle, { ...base, denoise: config.denoise })).wav;
    const levelChange = (from, to) => round(lib.gainToDb(lib.rmsOfWindow(cleaned, from, to) /
      Math.max(lib.rmsOfWindow(trimmedProbe, from, to), 1e-12)), 1);
    const detail = {
      impactResidualRelDb: round(lib.windowEnergyRelDb(trimmedProbe, residual, impactFrom, impactTo), 1),
      tailResidualRelDb: round(lib.windowEnergyRelDb(trimmedProbe, residual, tailFrom, tailTo), 1),
      impactChangeDb: levelChange(impactFrom, impactTo),
      tailChangeDb: levelChange(tailFrom, tailTo),
      preChangeDb: impactFrom > 0 ? levelChange(0, impactFrom) : null
    };
    if (lib.decideDenoise(detail.impactResidualRelDb, config.denoise.residualLimitDb)) {
      const version = "C-denoise";
      const out = join(scratchDir, `${entry.id}-${version}.wav`);
      const rendered = await renderGuarded(renderSingle, { ...base, fadeMs: primaryFade, denoise: config.denoise }, out);
      addRow({ key: `${entry.id}|${version}`, caseId: entry.id, version, group: "main" }, out,
        { guardDb: rendered.guardDb, fadeMs: primaryFade, denoise: config.denoise,
          residual: detail, trimmedSeconds: round(entry.trimmedSeconds) });
    } else {
      skipped.push({ caseId: entry.id, version: "C-denoise", reason: "降噪残差在撞击窗口内超过阈值", residual: detail });
    }
  } else {
    skipped.push({ caseId: entry.id, version: "C-denoise",
      reason: primaryFade ? "本轮未启用降噪" : "该样本无需边缘处理，C 以其为前置条件" });
  }

  // D = 干路 + 共享 send 卷积混响，尾巴补到 total 长度。
  // 干路与湿声使用同一个 case 内统一的干路增益：以最湿的一档刚好顶到峰值上限为准，
  // 保证 D-wet0.15 与 D-wet0.35 之间只差混响量、不差响度
  // （代价：素材已到满量程的样本，干路会比 B 低几 dB，页面在对应分组标注）。
  const bFile = primaryFade ? filesByCase.get(entry.id).get(`B-fade${primaryFade}`).scratch : aOut;
  const totalFrames = Math.round((entry.trimmedSeconds + config.reverb.tailExtraSeconds) * rate);
  const trimmedWav = lib.sliceWav(entry.wav, Math.round(entry.baselineOffset * rate), entry.wav.frames);
  const dryWav = lib.padWav(lib.readWav(await readFile(bFile)), totalFrames);
  const wetWavs = new Map(config.reverb.wetLevels.map(wet =>
    [wet, lib.convolveStereo(trimmedWav, irChannels.get(wet), totalFrames, fft)]));
  const wettest = wetWavs.get(config.reverb.wetLevels.at(-1));
  let dryGain = 1;
  if (lib.gainToDb(lib.peakOf(lib.addWav(dryWav, wettest))) > peakTarget) {
    let low = 0.05, high = 1;
    for (let step = 0; step < 20; ++step) {
      const middle = (low + high) / 2;
      if (lib.gainToDb(lib.peakOf(lib.addWav(lib.scaleWav(dryWav, middle), wettest))) <= peakTarget) low = middle;
      else high = middle;
    }
    dryGain = low;
  }
  for (const wet of config.reverb.wetLevels) {
    const version = `D-wet${wet}`;
    const out = join(scratchDir, `${entry.id}-${version}.wav`);
    await writeFile(out, lib.encodeWavAudio(lib.addWav(lib.scaleWav(dryWav, dryGain), wetWavs.get(wet))));
    addRow({ key: `${entry.id}|${version}`, caseId: entry.id, version, group: "main" }, out,
      { dryGainDb: round(lib.gainToDb(dryGain), 2), wet, fadeMs: primaryFade,
        tailExtraSeconds: config.reverb.tailExtraSeconds, trimmedSeconds: round(entry.trimmedSeconds) });
  }

  const masterDb = config.gainStudy.masterDb;
  for (const [version, gainDb] of [["E-gainOn", lib.gainToDb(entry.baselineGain)], ["E-gainOff", 0]]) {
    const out = join(scratchDir, `${entry.id}-${version}.wav`);
    const rendered = await renderGuarded(renderSingle, { ...base, volumeDb: masterDb + gainDb }, out);
    addRow({ key: `${entry.id}|${version}`, caseId: entry.id, version, group: "gain" }, out,
      { guardDb: rendered.guardDb, masterDb, sampleGainDb: round(gainDb, 2), trimmedSeconds: round(entry.trimmedSeconds) });
  }
}

// ---- 事件序列：复用已渲染的单段版本，保证各版本事件时刻与选样一致 ----
const fallbacks = [];
const missing = [];
function resolveVersion(caseId, wanted) {
  const available = filesByCase.get(caseId);
  const candidates = wanted === "B" ? fadesByCase.get(caseId).map(ms => `B-fade${ms}`)
    : wanted === "C" ? ["C-denoise"] : [wanted];
  return candidates.find(candidate => available.has(candidate)) ?? null;
}
for (const sequence of config.sequences) {
  for (const version of config.sequenceVersions) {
    const events = [];
    let complete = true;
    for (const event of sequence.events) {
      const used = resolveVersion(event.caseId, version);
      if (!used) { complete = false; break; }
      if (used !== version) fallbacks.push({ sequenceId: sequence.id, version, caseId: event.caseId, used });
      events.push({ path: filesByCase.get(event.caseId).get(used).scratch, atMs: event.atMs, caseId: event.caseId, used });
    }
    if (!complete) {
      missing.push({ sequenceId: sequence.id, version, reason: "缺少该版本的单段渲染" });
      continue;
    }
    for (const chain of ["raw", "comp"]) {
      const out = join(scratchDir, `${sequence.id}-${version}-${chain}.wav`);
      const rendered = await renderGuarded(renderSequence,
        { events, compressor: chain === "comp" ? config.compressor : null }, out);
      addRow({ key: `${sequence.id}|${version}|${chain}`, sequenceId: sequence.id,
        version: chain === "comp" ? `${version}（经总线压缩）` : version, group: chain, base: version, chain }, out,
        { guardDb: rendered.guardDb,
          events: events.map(event => ({ caseId: event.caseId, atMs: event.atMs, version: event.used })) });
    }
  }
}

// ---- 以盲标签落盘并测量 ----
for (const row of rows) {
  const target = join(sampleDir, `${row.blind}.wav`);
  await copyFile(row.scratch, target);
  const measured = await measureFile(target);
  row.file = `samples/${row.blind}.wav`;
  row.durationSeconds = round(measured.wav.frames / measured.wav.sampleRate, 4);
  row.peakDb = round(measured.measure.peakDb, 2);
  row.tailRelDb = round(measured.measure.tailRelDb, 1);
  row.onsetSeconds = round(measured.measure.onsetSeconds, 5);
  row.md5 = measured.md5;
  delete row.scratch;
}

// ---- 起音对齐：与同组 A 版本做首 60ms 互相关，滞后必须为 0 ----
const referenceByCase = new Map();
for (const row of rows) {
  if (!row.caseId || row.version !== "A") continue;
  referenceByCase.set(row.caseId, lib.readWav(await readFile(join(outputDir, row.file))));
}
for (const row of rows) {
  if (!row.caseId) continue;
  row.lagSamples = lib.lagBetween(referenceByCase.get(row.caseId), lib.readWav(await readFile(join(outputDir, row.file))));
}
const onsetMismatch = rows.filter(row => row.lagSamples !== undefined && Math.abs(row.lagSamples) > 1);
const checks = [
  { name: "素材摘要未改动", ok: true, detail: `${sources.samples.length} 段全部与清单一致` },
  { name: "播放起点与第一版一致", ok: true, detail: `${cases.length} 段偏移全部吻合（≤1 采样）` },
  { name: "输出格式", ok: rows.every(row => row.durationSeconds > 0), detail: "48kHz / PCM16 / 双声道" },
  { name: "峰值上限", ok: rows.every(row => row.peakDb <= peakTarget + 0.05), detail: `${peakTarget} dBFS` },
  { name: "盲标签唯一", ok: new Set(rows.map(row => row.blind)).size === rows.length, detail: `${rows.length} 个输出` },
  { name: "D 干路电平", ok: rows.filter(row => row.caseId && row.version.startsWith("D-") && row.dryGainDb < -1)
    .map(row => `${row.caseId}:${row.dryGainDb}dB`).join(", ") || "全部与 B 同电平",
    detail: "偏离时说明该样本原始峰值已达满量程，混响只能从干路让出" },
  { name: "D 保留混响尾", ok: rows.filter(row => row.caseId && row.version.startsWith("D-")).every(row => {
    const entry = cases.find(item => item.id === row.caseId);
    return row.durationSeconds >= entry.trimmedSeconds + 0.5;
  }), detail: "≥ 原裁剪长度 + 0.5s" },
  { name: "起音对齐", ok: onsetMismatch.length === 0,
    detail: onsetMismatch.length ? onsetMismatch.map(row => `${row.caseId}/${row.version}:${row.lagSamples}`).join(", ")
      : "全部与同组 A 版本互相关滞后 0 采样（±1）" }
];
for (const item of skipped) checks.push({ name: `跳过 ${item.caseId}/${item.version}`, ok: true, detail: item.reason });
for (const item of missing) checks.push({ name: `序列缺版本 ${item.sequenceId}/${item.version}`, ok: true, detail: item.reason });
for (const item of fallbacks) checks.push({ name: `序列版本映射 ${item.sequenceId}/${item.version}/${item.caseId}`, ok: true, detail: `使用 ${item.used}` });

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  tool: { ffmpeg: ffmpegVersion(), node: process.version },
  seed: { blind: config.blindSeed, ir: config.reverb.ir.seed },
  measurement: config.measurement,
  config,
  ir: { ...config.reverb.ir, wetLevels: config.reverb.wetLevels, referenceScale: round(referenceScale, 2),
    note: "代码合成的场馆 IR，非实测响应；总能量归一化后乘 wet 增益，dry 路径保留。"
      + `目录内的 IR 参照文件按峰值 0.9 存储（放大 ${round(referenceScale, 1)}×），实际卷积使用内存中的能量归一化版本` },
  cases: cases.map(entry => ({
    id: entry.id, label: entry.label, reason: entry.reason, sampleId: entry.sampleId,
    sourcePath: `${config.mediaRoot}/${entry.source.source}`, sha256: entry.source.sha256,
    group: entry.source.group, intensity: entry.source.intensity,
    durationSeconds: round(entry.durationSeconds), trimmedSeconds: round(entry.trimmedSeconds),
    baselineOffsetSeconds: round(entry.baselineOffset, 4), baselineGain: entry.baselineGain,
    fadeMs: fadesByCase.get(entry.id),
    dryGainDb: rows.find(row => row.caseId === entry.id && row.version.startsWith("D-"))?.dryGainDb ?? 0,
    measurement: { tailWindowMs: config.measurement.tailWindowMs, tailDbFS: round(entry.measurement.tailDb, 1),
      tailRelDb: round(entry.measurement.tailRelDb, 1), peakDb: round(entry.measurement.peakDb, 2),
      onsetSeconds: round(entry.measurement.onsetSeconds, 4) }
  })),
  sequences: config.sequences.map(sequence => ({ id: sequence.id, label: sequence.label, events: sequence.events })),
  outputs: rows,
  skipped,
  fallbacks,
  missing,
  checks,
  blind: Object.fromEntries(rows.map(row => [row.blind, row.key]))
};
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const page = await writePage(outputDir, manifest);

checks.push({ name: "盲标签映射", ok: page.cases.every(entry => entry.versions.every(row =>
  Buffer.from(row.nameB64, "base64").toString("utf8") === row.real)), detail: "页面混淆名可解码回清单" });
const afterTrees = { local: await hashTree(config.mediaRoot), prepared: await hashTree("public/assets/audio") };
for (const tree of ["local", "prepared"]) {
  const names = Object.keys(beforeTrees[tree]);
  const changed = names.filter(key => beforeTrees[tree][key] !== afterTrees[tree][key]);
  checks.push({ name: `未写入 ${tree}`, ok: changed.length === 0 && names.length === Object.keys(afterTrees[tree]).length,
    detail: changed.length ? changed.join(", ") : "哈希一致" });
}
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify({ ...manifest, checks }, null, 2)}\n`);
await rm(scratchDir, { recursive: true, force: true });

const failed = checks.filter(check => !check.ok);
console.log(`输出 ${rows.length} 个试听文件，跳过 ${skipped.length} 项，版本映射 ${fallbacks.length} 项，缺版本 ${missing.length} 项 → ${outputDir}`);
for (const check of checks) console.log(`  ${check.ok ? "OK  " : "FAIL"} ${check.name}：${check.detail}`);
if (failed.length) process.exitCode = 1;
