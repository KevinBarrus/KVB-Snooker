import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { auditClip, GROUPS, reviewClip, validateClip } from './audio-cut-audit.mjs';
import { readWav } from './audio-review-lib.mjs';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run audio:cut -- cuts.json [new-output-directory]');
const listPath = await realpath(input);
const config = JSON.parse(await readFile(listPath, 'utf8'));
if (config.version !== 1 || !Array.isArray(config.sources) || !Array.isArray(config.clips)) throw new Error('Expected version 1 sources/clips');
const profile = config.profile ?? 'strict-v1';
if (!['strict-v1', 'three-level-pilot'].includes(profile)) throw new Error('Unknown capture profile');
const pilot = profile === 'three-level-pilot';
const output = resolve(process.argv[3] ?? 'local-audio-new');
const parent = await realpath(dirname(output));
const canonicalOutput = join(parent, output.slice(dirname(output).length + 1));
const repo = await realpath('.');
if (canonicalOutput !== join(repo, 'local-audio-new') && !canonicalOutput.startsWith(join(repo, '.cache') + sep)) {
  throw new Error('Output must be a NEW local-audio-new or .cache child directory; copy reviewed delivery separately');
}

const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const sources = new Map();
for (const source of config.sources) {
  if (typeof source.id !== 'string' || !source.id || sources.has(source.id)) throw new Error('Missing/duplicate source ID');
  for (const field of ['file', 'url', 'title', 'uploader', 'acquisition']) {
    if (typeof source[field] !== 'string' || !source[field].trim()) throw new Error(`Missing source ${field}`);
  }
  if (!['https:', 'http:'].includes(new URL(source.url).protocol)) throw new Error('Invalid source URL');
  const file = await realpath(resolve(dirname(listPath), source.file));
  if (!(await stat(file)).isFile()) throw new Error('Source must be a file');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
  const stream = probe.streams?.[0];
  if (!stream || ![1, 2].includes(stream.channels) || !Number.isFinite(Number(probe.format?.duration))) throw new Error('Invalid source audio');
  sources.set(source.id, { ...source, file, sha256: digest(await readFile(file)), stream,
    durationSeconds: Number(probe.format.duration) });
}
const exclusions = config.excludedClips ?? [];
if (!Array.isArray(exclusions)) throw new Error('Invalid excludedClips');
for (const excluded of exclusions) {
  if (!sources.has(excluded.sourceId) || !Number.isFinite(excluded.startSeconds)
    || !Number.isFinite(excluded.endSeconds) || excluded.startSeconds < 0 || excluded.startSeconds >= excluded.endSeconds) {
    throw new Error('Invalid excluded source interval');
  }
}
for (const clip of config.clips) {
  validateClip(clip);
  reviewClip(clip, profile);
  const source = sources.get(clip.sourceId);
  if (!source || clip.endSeconds > source.durationSeconds) throw new Error('Clip outside source duration');
  if (exclusions.some(excluded => excluded.sourceId === clip.sourceId
    && clip.startSeconds < excluded.endSeconds && clip.endSeconds > excluded.startSeconds)) {
    throw new Error('Clip overlaps an excluded source interval');
  }
}
await mkdir(output);
await mkdir(join(output, 'rejected'));
if (pilot) await mkdir(join(output, 'candidates'));
const counts = new Map();
const records = [];
for (const clip of config.clips) {
  const source = sources.get(clip.sourceId);
  const prefix = `${clip.group}-${String(Math.round(clip.intensity * 100)).padStart(3, '0')}`;
  const sequence = (counts.get(prefix) ?? 0) + 1;
  counts.set(prefix, sequence);
  const name = `${prefix}-${String(sequence).padStart(2, '0')}.wav`;
  const path = join(output, name);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', String(clip.startSeconds),
    '-i', source.file, '-t', String(clip.endSeconds - clip.startSeconds), '-map', '0:a:0', '-vn',
    '-map_metadata', '-1', '-c:a', 'pcm_s24le', '-ar', '48000', path];
  execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const bytes = await readFile(path);
  const audit = auditClip(readWav(bytes), clip);
  const bitrate = Number(source.stream.bit_rate);
  if (!Number.isFinite(bitrate) || bitrate < 127999) {
    audit.reasons.push(Number.isFinite(bitrate) ? 'source_bitrate' : 'unknown_source_bitrate');
    audit.passed = false;
  }
  const selectionStatus = pilot ? reviewClip(clip, profile) : audit.passed ? 'candidate' : 'rejected';
  const relativeFile = selectionStatus === 'rejected' ? `rejected/${name}` : pilot ? `candidates/${name}` : name;
  if (relativeFile !== name) await rename(path, join(output, relativeFile));
  records.push({ ...clip, file: relativeFile, sha256: digest(bytes), selectionStatus, audit, ffmpegArgs: args });
  console.log(`${selectionStatus.toUpperCase()} ${name}: diagnostics=${audit.reasons.join(', ') || 'pass'}; 待人工试听`);
}
for (const source of sources.values()) {
  if (digest(await readFile(source.file)) !== source.sha256) throw new Error('Source changed during processing');
}
const passed = records.filter(record => record.audit.passed);
const reasons = {};
for (const record of records) for (const reason of record.audit.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
const candidates = records.filter(record => record.selectionStatus === 'candidate');
const manifest = { version: 1, profile, generatedAt: new Date().toISOString(),
  tools: { node: process.version, ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0] },
  policy: { format: '48000 Hz PCM24; original channel count', preWindowMs: 100, preRmsMaximumDbFS: -50,
    onsetWindowMs: 50, minimumRiseDb: 15, tailWindowMs: 50, maximumTailRelativeDb: -45,
    trendWindowMs: 10, trendRiseToleranceDb: 3, trendIgnoreBelowDbFS: -70, peakMaximumDbFS: -1,
    clippingRunSamples: 3, minimumNextEventMarginMs: 20, minimumSourceBitrate: 128000, bitrateRoundingTolerance: 1,
    provenance: 'URL/渠道与下载记录留证；码率不证明压缩代数；未自动验证说话/咳嗽/音乐/杆法' },
  sources: [...sources.values()], excludedClips: exclusions, clips: records,
  summary: { total: records.length, numericalPassed: passed.length, numericalRejected: records.length - passed.length,
    rejected: records.length - candidates.length,
    humanApproved: 0, pendingListening: pilot ? candidates.length : records.length, listeningCandidates: candidates.length,
    eventRejected: records.filter(record => record.selectionStatus === 'rejected').length,
    numericalPassedPendingListening: candidates.filter(record => record.audit.passed).length,
    rejectionReasons: reasons } };
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
const targets = GROUPS.flatMap(group => group === 'ball'
  ? [{ group, intensities: [0.75] }, { group, intensities: [1] }]
  : [{ group, intensities: group.startsWith('cue-') ? [0.75, 1] : [1] }]);
const groupRows = targets.map(({ group, intensities }) => {
  const matching = records.filter(r => r.group === group && intensities.includes(r.intensity));
  const count = matching.filter(r => r.audit.passed).length;
  return `| ${group} | ${intensities.join('/')} | ${matching.length} | ${count} | 3 | ${Math.max(0, 3 - count)} |`;
});
const report = [
  '# 新碰撞素材：原声切割体检', '',
  `共 ${records.length} 条，数值通过 ${passed.length} 条，未通过 ${records.length - passed.length} 条，人工确认 0 条。`,
  '根目录 WAV 仅代表数值通过候选；rejected/ 内文件仅供诊断，不可作为合格素材接入。',
  '未降噪、未归一化、未压缩、未 EQ、未淡入淡出；来源保持原字节。', '',
  '## 分组缺口（后续24条目标）', '', '| 组 | 档位 | 试切数量 | 数值通过 | 目标 | 缺口 |', '|---|---|---:|---:|---:|---:|', ...groupRows,
  '', '皮头每组0.75/1.0合计3条；球球0.75和1.0各3条；入袋1.0各3条。数值通过仍需试听。',
  '', '## 数值通过后的待人工试听', '', ...passed.map(r => `- ${r.file}：${r.note}；源撞击时刻 ${r.impactSeconds}s；请确认分类、力度、杂声与尾音。`),
  ...(passed.length ? [] : ['无数值通过样本。请勿将 rejected/ 中素材当成达标交付。']),
  '', `另有 ${records.length - passed.length} 条未达标诊断试样尚未试听；可以评估源音质，但不会因试听认可而自动改成数值通过。`,
  '', '## 未通过原因', '', ...Object.entries(reasons).map(([reason, count]) => `- ${reason}: ${count}`),
  '', '## 逐条记录', '', ...records.map(r => `- ${r.file}：${r.audit.passed ? '数值通过，待试听' : r.audit.reasons.join(', ')}。${r.note}`),
  '', '## 测量边界', '',
  '起音由时间戳指定，比较此前100ms RMS与此后50ms峰值；尾部为末50ms RMS相对整段峰值。',
  '尾部趋势按5个10ms窗口，允许相邻窗口3dB波动，低于−70dBFS不比较趋势；不是每个采样单调下降。',
  '数值无法判定素材是否含解说、咳嗽或音乐；不能由码率推断压缩代数。详情及命令见 manifest.json。',
  'intensity与杆法是画面判断的标签，不是物理测量值。自动检查不会将它们认证为准确。', ''
];
const pilotReport = [
  '# 第二轮三档原声试听', '',
  `试切 ${records.length} 条，事件筛选候选 ${candidates.length} 条，事件否决 ${records.length - candidates.length} 条。`,
  `首轮数值门槛通过 ${passed.length} 条；数值与事件筛选分开记录，人工验收通过 0 条。`,
  'candidates/ 为待人工试听，非已合格；rejected/ 不进入试听候选。双响一律否决，不用降噪或分离修复。',
  '未降噪、未归一化、未压缩、未EQ、未淡入淡出；上下文与候选应分开存放。', '',
  '## 分类覆盖', '',
  '| 组 | 小力0.3 | 中力0.5 | 大力1.0 |', '|---|---:|---:|---:|',
  ...[...GROUPS.filter(group => group !== 'cue-mid-low'), 'cue-unclassified'].map(group =>
    `| ${group} | ${[0.3, 0.5, 1].map(level => candidates.filter(r => r.group === group && r.intensity === level).length).join(' | ')} |`),
  '', '分类均待用户确认，数值不是实测力度；没有为填满表格补用多事件素材。', '',
  '## 待试听', '', ...candidates.map(r => `- ${r.file}：${r.note} 事件证据：${r.eventReview.evidence} 数值提示：${r.audit.reasons.join(', ') || '通过'}。`),
  '', '## 事件否决', '', ...records.filter(r => r.selectionStatus === 'rejected').map(r => `- ${r.file}：${r.eventReview.evidence}`),
  '', '## 保留的数值诊断', '', ...Object.entries(reasons).map(([reason, count]) => `- ${reason}: ${count}`),
  '', 'pre_duration/post_duration表示偏离首轮固定长度，不等于自动确认切掉撞击；边界原因见manifest。',
  '前导不足100ms时，背景仅测实际保留长度，preWindowSeconds记录实际窗口，不能当作完整100ms测量。',
  'tail_energy表示尾部RMS超过首轮阈值，不证明声音被硬切；仍需试听。',
  '画面与波形不能保证无可听第二声，eventReview只记录筛选证据，不等于人工听辨。', ''
];
await writeFile(join(output, 'audit.md'), (pilot ? pilotReport : report).join('\n'), { flag: 'wx' });
console.log(`Report: ${join(output, 'audit.md')}`);
