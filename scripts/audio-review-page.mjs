// 生成可双击打开（file://）的本地试听页与说明；只读 data，不访问网络。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function encodeNames(rows) {
  return rows.map(row => ({ ...row, nameB64: Buffer.from(row.real, "utf8").toString("base64") }));
}

const FEEDBACK = [
  "哪个版本更自然？允许选择“原版最好”或“无明显差别”。",
  "是否出现水声/金属声、瞬态变钝、声音变远或拖尾过长？",
  "是否仍能分清轻碰和重碰、空心入袋和磕袋角？",
  "连续事件（杆头→球球→入袋、连续碰撞）是否像同一空间内发生，而不是几段录音拼接？"
];

export function buildPageData(manifest) {
  const byCase = new Map();
  for (const row of manifest.outputs) {
    if (!row.caseId) continue;
    if (!byCase.has(row.caseId)) byCase.set(row.caseId, []);
    byCase.get(row.caseId).push({ file: row.file, real: row.version, code: row.blind,
      group: row.group, duration: row.durationSeconds });
  }
  const cases = manifest.cases.map(entry => ({
    id: entry.id, label: entry.label, reason: entry.reason, sampleId: entry.sampleId,
    tailRelDb: entry.measurement.tailRelDb, dryGainDb: entry.dryGainDb,
    versions: encodeNames(byCase.get(entry.id) ?? [])
  }));
  const sequences = manifest.sequences.map(entry => ({
    id: entry.id, label: entry.label,
    versions: encodeNames(manifest.outputs.filter(row => row.sequenceId === entry.id)
      .map(row => ({ file: row.file, real: row.version, code: row.blind, group: row.group,
        duration: row.durationSeconds })))
  }));
  return { cases, sequences, feedback: FEEDBACK, gapMs: 1500 };
}

export async function writePage(directory, manifest) {
  const data = buildPageData(manifest);
  const html = (await readFile(new URL("./audio-review-page.html", import.meta.url), "utf8"))
    .replace("/*__DATA__*/null", JSON.stringify(data));
  await writeFile(join(directory, "index.html"), html);
  await writeFile(join(directory, "README.md"), readme(manifest));
  return data;
}

function readme(manifest) {
  const lines = [
    "# 声音第二轮 · 对照试听包",
    "",
    `生成时间：${manifest.generatedAt}；种子：IR ${manifest.config.reverb.ir.seed} / 盲标签 ${manifest.config.blindSeed}。`,
    "",
    "## 打开方式",
    "",
    "直接双击 `index.html`（Chrome / Edge）。若浏览器拒绝播放本地文件，在本目录执行：",
    "",
    "```",
    "python3 -m http.server 8000",
    "```",
    "",
    "然后打开 http://127.0.0.1:8000/ 。",
    "",
    "## 怎么听",
    "",
    "- 每个样本是一组，组内所有版本**只差一项处理**；版本名默认隐藏，播完再勾选“显示版本名”揭晓。",
    "- “顺播本组”按固定间隔依次播放全部版本，播下一版前会停止上一版，不残留尾音。",
    "- 混响组内两档湿声使用同一条干路，只差混响量；个别样本的干路会比 B 低几 dB（该组标题已标注，原因见 manifest 的 `dryGainDb`）。**不同组之间不要比音量**。",
    "- 连续事件组用来判断“单声好听、叠加后是否浑浊”。",
    "",
    "## 版本含义（试听后再看）",
    "",
    "| 版本 | 处理 |",
    "|---|---|",
    "| A | 第一版实际播放基线：按原清单的播放起点裁剪，无任何新增处理 |",
    "| B | A + 仅末端淡出（只对判定为截断的样本；部分样本给 15/30ms 两档） |",
    "| C | B + 保守降噪（FFT 降噪，自适应噪声跟踪）；残差吃掉撞击的样本不提供 |",
    "| D | B + 共享 send 合成卷积混响（湿声 0.15 / 0.35 两档），尾巴不在样本长度处截断 |",
    "| E | A 的逐样本增益补偿开/关（同一固定主音量），单独一组，不混入 B/C/D |",
    "",
    "## 反馈",
    "",
    ...FEEDBACK.map((question, index) => `${index + 1}. ${question}`),
    "",
    "## 已知局限",
    "",
    "- 素材来自比赛转播的短片段，没有可用的干净噪声段，C 版的降噪是保守试探，不代表最优参数。",
    "- 卷积混响使用代码合成的 IR，不是实测场馆响应，也不恢复被剪掉的原始尾音；卷积在 Node 内实现，因为本机 ffmpeg 的 afir 对本项目 IR 恒输出静音。",
    "- 淡出只能柔化结尾，不能补回丢失的尾音；D 的尾巴是房间对已有声音的响应。",
    "- 本包不改游戏播放链路、不改原始素材；原始录音字节未动。",
    ""
  ];
  return lines.join("\n");
}
