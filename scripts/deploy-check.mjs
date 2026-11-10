#!/usr/bin/env node
/**
 * 部署前资源与构建产物检查（只读，不复制、不修复、不生成文件）。
 *
 * 默认检查构建机必须准备的 public/assets 资源：
 *   - public/assets/render 与 src/render/assets.json 的清单/大小/SHA-256
 *   - public/assets/physics/table.json 的摘要与 JSON 结构
 *   - public/assets/audio/manifest.json 及其引用的每个音频文件
 *
 * --prod 追加检查镜像运行所需产物（构建完成后使用）：
 *   - dist/index.html 及其引用的 JS/CSS、public/ 复制到 dist/assets 的资源
 *   - .cache/identity/identity/main.js（身份服务编译入口）
 *   - db/migrations 中至少一个 .sql
 *
 * 任何缺项打印具体路径并非零退出；不修改 .gitignore，不伪造缺失资源。
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RENDER_MANIFEST_PATH = join(ROOT, "src/render/assets.json");
const RENDER_DIR = join(ROOT, "public/assets/render");
const PHYSICS_PATH = join(ROOT, "public/assets/physics/table.json");
const PHYSICS_SHA256 = "04acfb245368bc1762cdcdf94f0bb81ab82dd82f785af661a4f63d3de9ccbbc9";
const AUDIO_MANIFEST_PATH = join(ROOT, "public/assets/audio/manifest.json");
const AUDIO_DIR = join(ROOT, "public/assets/audio");
const DIST_DIR = join(ROOT, "dist");
const IDENTITY_ENTRY = join(ROOT, ".cache/identity/identity/main.js");
const MIGRATIONS_DIR = join(ROOT, "db/migrations");

const argv = new Set(process.argv.slice(2));

if (argv.has("--help") || argv.has("-h")) {
  console.log(`用法: node scripts/deploy-check.mjs [--prod]

  默认      检查 public/assets 必需资源（构建机准备后、npm run build 之前运行）
  --prod    追加检查 dist 构建产物、身份服务编译入口与 db/migrations
  --help    显示本说明

缺失项逐条打印路径并非零退出；脚本只读，不修改任何文件。`);
  process.exit(0);
}

const requireProdArtifacts = argv.has("--prod");
const failures = [];
let passedSections = 0;

function fail(message) {
  failures.push(message);
  console.log(`  [缺失] ${message}`);
}

async function existsNonEmpty(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function displayPath(path) {
  const rel = relative(ROOT, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/** 解析 /assets/audio/x.wav 这类站内路径，拒绝跳出 public/assets/audio。 */
function resolveAudioSamplePath(url) {
  if (typeof url !== "string" || !url.startsWith("/assets/audio/")) return null;
  const target = resolve(AUDIO_DIR, url.slice("/assets/audio/".length));
  return target.startsWith(AUDIO_DIR + sep) ? target : null;
}

async function checkRenderAssets() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(RENDER_MANIFEST_PATH, "utf8"));
  } catch (error) {
    fail(`${displayPath(RENDER_MANIFEST_PATH)} 不可读或不是合法 JSON（${error.message}）`);
    return;
  }
  const entries = Object.entries(manifest);
  if (entries.length === 0) {
    fail(`${displayPath(RENDER_MANIFEST_PATH)} 为空清单`);
    return;
  }
  const babylonFiles = entries.filter(([, entry]) => entry.file?.endsWith(".babylon"));
  if (babylonFiles.length === 0) {
    fail(`${displayPath(RENDER_MANIFEST_PATH)} 中没有 .babylon 场景文件`);
  }
  let missing = 0;
  for (const [key, entry] of entries) {
    const file = join(RENDER_DIR, entry.file ?? "");
    if (!(await existsNonEmpty(file))) {
      fail(`${displayPath(file)}（render:${key}，运行 npm run assets:prepare）`);
      missing += 1;
      continue;
    }
    const expect = entry.sha256;
    if (typeof expect === "string") {
      const actual = await sha256File(file);
      if (actual !== expect) {
        fail(`${displayPath(file)}（render:${key} SHA-256 不符，重新运行 npm run assets:prepare）`);
        missing += 1;
      }
    }
  }
  if (missing === 0) {
    passedSections += 1;
    console.log(`  [通过] render: ${entries.length} 项资源，含 ${babylonFiles.length} 个 .babylon 场景`);
  }
}

async function checkPhysicsTable() {
  if (!(await existsNonEmpty(PHYSICS_PATH))) {
    fail(`${displayPath(PHYSICS_PATH)}（运行 npm run assets:prepare）`);
    return;
  }
  let bytes;
  try {
    bytes = await readFile(PHYSICS_PATH);
  } catch (error) {
    fail(`${displayPath(PHYSICS_PATH)} 不可读（${error.message}）`);
    return;
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== PHYSICS_SHA256) {
    fail(`${displayPath(PHYSICS_PATH)} SHA-256 不符（期望 ${PHYSICS_SHA256}，实际 ${digest}），重新运行 npm run assets:prepare`);
    return;
  }
  try {
    JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${displayPath(PHYSICS_PATH)} 不是合法 JSON（${error.message}）`);
    return;
  }
  passedSections += 1;
  console.log("  [通过] physics: table.json 摘要与 JSON 结构");
}

async function checkAudioAssets() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(AUDIO_MANIFEST_PATH, "utf8"));
  } catch (error) {
    fail(`${displayPath(AUDIO_MANIFEST_PATH)} 不可读或不是合法 JSON（${error.message}），运行 npm run audio:install`);
    return;
  }
  const samples = Array.isArray(manifest?.samples) ? manifest.samples : [];
  if (samples.length === 0) {
    fail(`${displayPath(AUDIO_MANIFEST_PATH)} 中没有 samples，运行 npm run audio:install`);
    return;
  }
  let missing = 0;
  for (const sample of samples) {
    const target = resolveAudioSamplePath(sample?.url);
    if (target === null) {
      fail(`${displayPath(AUDIO_MANIFEST_PATH)} 中样本 ${JSON.stringify(sample?.id ?? null)} 的 url 非法（${JSON.stringify(sample?.url ?? null)}）`);
      missing += 1;
      continue;
    }
    if (!(await existsNonEmpty(target))) {
      fail(`${displayPath(target)}（音频样本 ${sample.id}，运行 npm run audio:install）`);
      missing += 1;
    }
  }
  if (missing === 0) {
    passedSections += 1;
    console.log(`  [通过] audio: manifest 引用 ${samples.length} 个音频文件`);
  }
}

async function checkDistArtifacts() {
  const indexHtml = join(DIST_DIR, "index.html");
  if (!(await existsNonEmpty(indexHtml))) {
    fail(`${displayPath(indexHtml)}（运行 npm run build）`);
    return;
  }
  let html;
  try {
    html = await readFile(indexHtml, "utf8");
  } catch (error) {
    fail(`${displayPath(indexHtml)} 不可读（${error.message}）`);
    return;
  }
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith("/assets/"));
  const scriptRefs = referenced.filter((url) => url.endsWith(".js"));
  if (scriptRefs.length === 0) {
    fail(`${displayPath(indexHtml)} 中没有引用构建后的 /assets/*.js`);
  }
  const missingRefs = [];
  for (const url of referenced) {
    const target = join(DIST_DIR, url.slice(1));
    if (!(await existsNonEmpty(target))) missingRefs.push(displayPath(target));
  }
  for (const path of missingRefs) fail(`${path}（dist/index.html 引用但文件缺失，重新运行 npm run build）`);
  const copiedAssets = [
    join(DIST_DIR, "assets/render"),
    join(DIST_DIR, "assets/physics/table.json"),
    join(DIST_DIR, "assets/audio/manifest.json"),
  ];
  const missingCopies = [];
  for (const path of copiedAssets) {
    try {
      const info = await stat(path);
      if (info.isFile() ? info.size <= 0 : !info.isDirectory()) missingCopies.push(displayPath(path));
    } catch {
      missingCopies.push(displayPath(path));
    }
  }
  for (const path of missingCopies) fail(`${path}（public/ 未复制到 dist，重新运行 npm run build）`);
  if (scriptRefs.length > 0 && missingRefs.length === 0 && missingCopies.length === 0) {
    passedSections += 1;
    console.log(`  [通过] dist: index.html 引用 ${referenced.length} 个构建资源，public/ 已复制`);
  }
}

async function checkIdentityRuntime() {
  if (!(await existsNonEmpty(IDENTITY_ENTRY))) {
    fail(`${displayPath(IDENTITY_ENTRY)}（运行 npm run identity:build）`);
  } else {
    passedSections += 1;
    console.log("  [通过] identity: 身份服务编译入口");
  }
  let entries;
  try {
    entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  } catch {
    fail(`${displayPath(MIGRATIONS_DIR)}/ 不存在（身份服务迁移目录）`);
    return;
  }
  const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));
  if (sqlFiles.length === 0) {
    fail(`${displayPath(MIGRATIONS_DIR)}/ 中没有 .sql 迁移文件`);
    return;
  }
  passedSections += 1;
  console.log(`  [通过] migrations: ${sqlFiles.length} 个迁移文件`);
}

console.log(`KVB-Snooker 部署检查（${requireProdArtifacts ? "资源 + 构建产物" : "资源"}）`);
await checkRenderAssets();
await checkPhysicsTable();
await checkAudioAssets();
if (requireProdArtifacts) {
  await checkDistArtifacts();
  await checkIdentityRuntime();
}

if (failures.length > 0) {
  console.log(`\n[失败] ${failures.length} 项。缺失资源必须由构建机准备，不能用占位文件顶替。`);
  process.exit(1);
}
console.log(`\n[通过] ${passedSections} 组检查全部满足。${requireProdArtifacts ? "" : "（镜像构建前还需 npm run build 与 npm run identity:build）"}`);
