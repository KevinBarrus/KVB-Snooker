// 按用户逐组指定的映射，生成"即将用于真实游戏"的最终音效集与试听页。
// 输出到 .cache/audio-final；不改 public/assets/audio、local-audio 与 src/**。
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import * as lib from "./audio-review-lib.mjs";
import * as fft from "./audio-review-fft.mjs";

const spec = JSON.parse(await readFile(new URL("./audio-final-spec.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(spec.sources, "utf8"));
const review = JSON.parse(await readFile(spec.reviewManifest, "utf8"));
const outIndex = process.argv.indexOf("--out");
const outputDir = resolve(outIndex > 0 ? process.argv[outIndex + 1] : spec.output);
if (!outputDir.startsWith(`${resolve(".cache")}${sep}`)) throw new Error(`Refusing to write outside .cache: ${outputDir}`);

const sampleDir = join(outputDir, "samples");
const scratchDir = join(outputDir, ".scratch");
const sourceById = new Map(sources.samples.map(sample => [sample.id, sample]));
const config = spec.process;
const rate = config.ir.sampleRate;
const round = (value, digits = 2) => Number(value.toFixed(digits));

await rm(outputDir, { recursive: true, force: true });
await mkdir(sampleDir, { recursive: true });
await mkdir(scratchDir, { recursive: true });

const ir = lib.buildIr(config.ir);
const wetLevels = new Map();

function irFor(wet) {
  if (!wetLevels.has(wet)) wetLevels.set(wet, lib.scaleChannels(ir, wet));
  return wetLevels.get(wet);
}

// 前摇裁剪：起点取"能量跃升最陡处"前 25ms，避免从底噪开始播。
function trimToOnset(wav) {
  const onset = lib.findOnset(wav);
  const start = Math.max(0, Math.round((onset - config.preRollMs / 1000) * wav.sampleRate));
  return { wav: lib.sliceWav(wav, start, wav.frames), onset, start };
}

// 高通去隆隆声：实测撞击窗几乎不变（≤0.1dB），但把 <150Hz 的房间轰鸣压低 3–4dB。
async function highpass(input, startSeconds, out) {
  execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-nostdin", "-y", "-i", input,
    "-af", `atrim=start=${startSeconds.toFixed(4)},asetpts=PTS-STARTPTS,highpass=f=${config.highpassHz}:poles=2`,
    "-ac", "2", "-ar", String(rate), "-c:a", "pcm_f32le", "-map_metadata", "-1", out],
    { stdio: ["ignore", "ignore", "pipe"] });
  return lib.readWav(await readFile(out));
}

function fadeMsFor(tailRelDb) {
  if (tailRelDb > config.fade.loudAboveDb) return config.fade.loudMs;
  if (tailRelDb > config.fade.mediumAboveDb) return config.fade.mediumMs;
  return config.fade.quietMs;
}

// 尾部处理：干路淡出 + 共享 send 混响，尾巴延长到原长 + tailExtraSeconds。
// wet 与 tailExtra 随力度上升，高档位因此更厚、拖得更长（不是只把音量拧大）。
function withTail(source, options) {
  const fadeMs = fadeMsFor(lib.measureWav(source).tailRelDb);
  const total = Math.round((source.frames / rate + options.tailExtraSeconds) * rate);
  const dry = lib.padWav(lib.fadeOutWav(source, fadeMs), total);
  const wet = lib.convolveStereo(source, irFor(options.wet), total, fft);
  return { wav: lib.addWav(dry, wet), fadeMs, wet: options.wet, tailExtraSeconds: options.tailExtraSeconds };
}

// 只记录目标增益，不做峰值保护：先按组统一缩放到"最响档刚好顶到上限"，
// 否则任何上行增益都会被削平，力度阶梯会消失。
// 先把每条按峰值归一到 0dBFS，再套用组内力度阶梯（gainDb），
// 这样不同来源、不同原始电平的素材也能排出单调的力度顺序。
function applyGain(wav, gainDb, extra) {
  const rawPeakDb = lib.gainToDb(lib.peakOf(wav));
  return { wav, gainDb: round(gainDb, 2), rawPeakDb: round(rawPeakDb, 2), ...extra };
}

async function buildProcess(item) {
  const source = sourceById.get(item.process);
  if (!source) throw new Error(`Unknown sample: ${item.process}`);
  const input = join(spec.mediaRoot, source.source);
  const original = lib.readWav(await readFile(input));
  const onset = lib.findOnset(original);
  const start = Math.max(0, onset - config.preRollMs / 1000);
  const tmp = join(scratchDir, `hp-${item.process}.wav`);
  const cleaned = await highpass(input, start, tmp);
  return { ...withTail(cleaned, item),
    source: source.source, sourceId: item.process,
    onsetSeconds: round(onset, 3), trimSeconds: round(start, 3), highpassHz: config.highpassHz };
}

async function buildReuse(item) {
  const entry = review.outputs.find(row => row.caseId === item.reuse.caseId && row.version === item.reuse.version);
  if (!entry) throw new Error(`Missing review render: ${item.reuse.caseId}/${item.reuse.version}`);
  let wav = lib.readWav(await readFile(join(resolve(spec.reviewManifest, ".."), entry.file)));
  const extra = { reviewFile: entry.file, reviewKey: entry.key, wet: entry.wet ?? null };
  if (item.trimFront) {
    const trimmed = trimToOnset(wav);
    wav = trimmed.wav;
    extra.onsetSeconds = round(trimmed.onset, 3);
    extra.trimSeconds = round(trimmed.start / rate, 3);
  }
  return { wav, ...extra };
}

const slots = [];
let counter = 0;
for (const slot of spec.slots) {
  const items = [];
  for (const [index, item] of slot.items.entries()) {
    const built = item.process ? await buildProcess(item) : await buildReuse(item);
    const name = `${slot.group}-${String(Math.round(slot.band * 100)).padStart(3, "0")}-${index + 1}` +
      `-${(item.process ?? basename(item.reuse.caseId)).replace(/[^a-z0-9-]/gi, "")}.wav`;
    items.push({
      file: `samples/${name}`, note: item.note, unspecified: item.unspecified === true,
      wav: built.wav,
      fadeMs: built.fadeMs ?? null, wet: built.wet ?? null, tailExtraSeconds: built.tailExtraSeconds ?? null,
      sourceId: built.sourceId ?? null,
      source: built.source ?? null, reviewKey: built.reviewKey ?? null, reviewFile: built.reviewFile ?? null,
      trimSeconds: built.trimSeconds ?? null, highpassHz: built.highpassHz ?? null
    });
    counter++;
  }
  slots.push({ group: slot.group, band: slot.band, peakDb: slot.peakDb, items });
}

// 峰值落位的两条依据：
// 1) slot.peakDb 给出该档的目标峰值；
// 2) 峰均比补偿（crestCompensation）：本地"大力"素材底噪很高、峰均比低约 5dB，
//    同样峰值下能量高出一大截，直接换素材会在 0.5→0.75 处听出 12dB 的跳变。
//    按峰均比相对本组最干净素材的差值补偿，让换素材那一步只多出体量、不多出响度。
const crestOf = wav => {
  const onset = Math.round(lib.findOnset(wav) * rate);
  const to = Math.min(wav.frames, onset + Math.round(0.08 * rate));
  return lib.gainToDb(lib.peakOf(wav)) - lib.gainToDb(lib.rmsOfWindow(wav, onset, to));
};
const referenceCrest = new Map();
for (const group of [...new Set(slots.map(slot => slot.group))]) {
  const crests = slots.filter(slot => slot.group === group)
    .flatMap(slot => slot.items.map(item => crestOf(item.wav)));
  referenceCrest.set(group, Math.max(...crests));
}
const alpha = spec.crestCompensation ?? 0;
for (const slot of slots) {
  for (const item of slot.items) {
    const crestTrim = -alpha * (referenceCrest.get(slot.group) - crestOf(item.wav));
    item.crestTrimDb = round(crestTrim, 2);
    item.targetPeakDb = round(slot.peakDb + crestTrim, 2);
    item.normDb = item.targetPeakDb - lib.gainToDb(lib.peakOf(item.wav));
  }
}
// 组内统一抬起：让每组最响的一条落在峰值上限，保留阶梯形状，跨组响度一致。
const groupOffset = new Map();
for (const group of [...new Set(slots.map(slot => slot.group))]) {
  const items = slots.filter(slot => slot.group === group).flatMap(slot => slot.items);
  const loudest = Math.max(...items.map(item => lib.gainToDb(lib.peakOf(item.wav)) + item.normDb));
  groupOffset.set(group, round(config.peakTargetDb - loudest, 2));
}
for (const slot of slots) {
  const offset = groupOffset.get(slot.group);
  for (const item of slot.items) {
    const normDb = item.normDb + offset;
    const final = lib.scaleWav(item.wav, lib.dbToGain(normDb));
    await writeFile(join(sampleDir, basename(item.file)), lib.encodeWavAudio(final));
    const measured = lib.measureWav(final);
    item.durationSeconds = round(final.frames / rate, 3);
    item.peakDb = round(measured.peakDb);
    item.tailRelDb = round(measured.tailRelDb, 1);
    item.onsetSeconds = round(lib.findOnset(final), 3);
    item.appliedGainDb = round(normDb, 2);
    item.groupOffsetDb = offset;
    item.rmsDb = round(lib.gainToDb(lib.rmsOfWindow(final, 0, Math.min(final.frames, Math.round(0.3 * rate)))), 1);
    delete item.wav;
    delete item.normDb;
  }
}

const flat = slots.flatMap(slot => slot.items.map(item => ({ ...item, group: slot.group, band: slot.band })));
const checks = [
  { name: "文件数", ok: flat.length === counter, detail: `${flat.length} 条，覆盖 ${slots.length} 个槽位` },
  { name: "峰值上限", ok: flat.every(item => item.peakDb <= config.peakTargetDb + 0.05), detail: `${config.peakTargetDb} dBFS` },
  { name: "峰值按目标落位", ok: flat.every(item => Math.abs(item.peakDb - (item.targetPeakDb + item.groupOffsetDb)) <= 0.1), detail: "每档误差 ≤0.1dB（含组内统一抬起）" },
  { name: "力度阶梯单调", ok: [...new Set(slots.map(slot => slot.group))].every(group => {
    const bands = [...new Set(slots.filter(slot => slot.group === group).map(slot => slot.band))].sort((a, b) => a - b);
    const at = band => Math.max(...slots.filter(slot => slot.group === group && slot.band === band)
      .flatMap(slot => slot.items.map(item => item.rmsDb)));
    return bands.every((band, index) => index === 0 || at(band) > at(bands[index - 1]));
  }), detail: "同组内高档位的前 300ms 能量严格大于低档位" },
  { name: "无前摇", ok: flat.every(item => item.onsetSeconds <= 0.06), detail: "起音 ≤60ms（裁掉前置底噪）" },
  { name: "每组每档至少 1 条", ok: slots.every(slot => slot.items.length > 0), detail: `${slots.length} 个槽位` },
  { name: "同组同档无重复文件", ok: slots.every(slot => new Set(slot.items.map(item => item.file)).size === slot.items.length), detail: "洗牌基础" }
];

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  note: "按用户逐组指定生成的最终候选集；不含未指定的槽位判断（页面已标记）",
  config,
  groups: [...new Set(slots.map(slot => slot.group))].map(group => ({
    group, slots: slots.filter(slot => slot.group === group)
  })),
  totals: { files: flat.length, slots: slots.length, unspecified: flat.filter(item => item.unspecified).length },
  checks
};
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(outputDir, "index.html"), page(manifest));
await rm(scratchDir, { recursive: true, force: true });

const failed = checks.filter(check => !check.ok);
console.log(`生成 ${flat.length} 条音效，覆盖 ${slots.length} 个槽位 → ${outputDir}`);
for (const check of checks) console.log(`  ${check.ok ? "OK  " : "FAIL"} ${check.name}：${check.detail}`);
const gaps = slots.filter(slot => slot.items.some(item => item.unspecified));
console.log(`  未指定槽位 ${gaps.length} 个：` + gaps.map(slot => `${slot.group}@${slot.band}`).join(", "));
if (failed.length) process.exitCode = 1;

function page(text) {
  const data = JSON.stringify(text.groups);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>即将用于游戏的音效（${text.totals.files} 条）</title>
<style>
 :root{color-scheme:dark} *{box-sizing:border-box}
 body{margin:0;padding:22px 18px 84px;background:#14161a;color:#e6e8ec;font:15px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif}
 main{max-width:900px;margin:0 auto} h1{font-size:18px;margin:0 0 4px} p.lead{color:#9aa3af;font-size:13px;margin:0 0 16px}
 section{border:1px solid #262b33;border-radius:10px;padding:12px 14px;margin-bottom:14px;background:#191c21}
 h2{font-size:14px;margin:0 0 8px;font-weight:600}
 .band{display:flex;gap:10px;align-items:flex-start;padding:5px 0;border-top:1px solid #21262e}
 .band:first-of-type{border-top:none}
 .bandlabel{min-width:96px;color:#8fb8ff;font:12px/1.5 ui-monospace,monospace;padding-top:3px}
 .items{flex:1;display:flex;flex-direction:column;gap:3px}
 .item{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
 button{background:#2a303a;color:#e6e8ec;border:1px solid #39414d;border-radius:7px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
 button.playing{background:#2f6f4f;border-color:#3d8f66}
 .note{color:#b7c0cc;font-size:12px} .meta{color:#6b7480;font-size:11px;font-variant-numeric:tabular-nums}
 .badge{font-size:11px;border-radius:5px;padding:0 5px;border:1px solid #6b5327;color:#e0b062}
 footer{position:fixed;left:0;right:0;bottom:0;padding:10px 18px;background:#0f1114ee;border-top:1px solid #262b33;display:flex;gap:12px;align-items:center}
 .status{color:#9aa3af;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70vw}
</style></head><body><main>
<h1>即将用于游戏的音效（共 ${text.totals.files} 条 / ${text.totals.slots} 个槽位）</h1>
<p class="lead">按你逐组指定的映射生成。每组一行一个力度档；同档多条表示轮询时会随机选。带“未指定”标记的是你没指定、我暂用同一素材放大补上的槽位。一次只播一个。</p>
</main>
<footer><button id="stop">■ 停止</button><span class="status" id="status">未播放</span></footer>
<script>
const groups = ${data};
const audio = new Audio(); audio.preload = "none"; let cur = null;
function stop(){ if(cur){cur.classList.remove("playing");cur=null;} audio.pause(); audio.currentTime=0; status.textContent="已停止"; }
const status = document.getElementById("status");
function play(file, btn, label){ stop(); cur=btn; btn.classList.add("playing"); audio.src=file;
  status.textContent="播放中 "+label; audio.play().catch(e=>status.textContent=e.message);
  audio.onended=()=>{btn.classList.remove("playing");cur=null;status.textContent="已结束";}; }
const root = document.querySelector("main");
for (const group of groups) {
  const box = document.createElement("section");
  const h = document.createElement("h2"); h.textContent = group.group; box.append(h);
  const seq = [];
  for (const slot of [...group.slots].sort((a,b)=>a.band-b.band)) {
    const row = document.createElement("div"); row.className = "band";
    const lab = document.createElement("div"); lab.className = "bandlabel";
    lab.textContent = "力度 " + slot.band.toFixed(2); row.append(lab);
    const items = document.createElement("div"); items.className = "items";
    for (const item of slot.items) {
      const wrap = document.createElement("div"); wrap.className = "item";
      const btn = document.createElement("button"); btn.textContent = "▶";
      btn.onclick = () => play(item.file, btn, group.group + " 力度 " + slot.band.toFixed(2));
      const note = document.createElement("span"); note.className = "note"; note.textContent = item.note;
      const meta = document.createElement("span"); meta.className = "meta";
      meta.textContent = item.durationSeconds.toFixed(2) + "s · 峰值 " + item.peakDb + "dB" +
        (item.wet != null ? " · 混响 " + item.wet : " · 混响已烘焙") +
        (item.gainDb ? " · 增益 " + item.gainDb + "dB" : "") +
        (item.trimSeconds ? " · 裁掉前摇 " + Math.round(item.trimSeconds * 1000) + "ms" : "");
      wrap.append(btn, note, meta);
      if (item.unspecified) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "未指定"; wrap.append(b); }
      items.append(wrap);
      seq.push({ file: item.file, btn, label: group.group + " " + slot.band });
    }
    row.append(items); box.append(row);
  }
  const all = document.createElement("button"); all.textContent = "顺播本组（小力→大力）"; all.style.marginTop = "8px";
  all.onclick = () => runSequence(seq, 0);
  box.append(all); root.append(box);
}
function runSequence(list, index) {
  if (index >= list.length) { status.textContent = "顺播结束"; return; }
  play(list[index].file, list[index].btn, list[index].label);
  const next = () => { if (index + 1 < list.length) { stop(); runSequence(list, index + 1); } else status.textContent = "顺播结束"; };
  audio.onended = () => { next(); };
}
document.getElementById("stop").onclick = stop;
</script></body></html>`;
}
