#!/usr/bin/env node
/**
 * 生成可直接上传到内测服务器的运行包（不包含数据库、密码或环境文件）。
 *
 * 输入：已执行的 `npm run build`、`npm run identity:build` 和已准备的 public/assets。
 * 输出：.cache/deploy/kvb-snooker-<时间戳>.tar.gz 与 .sha256。
 *
 * 包内容：dist（含模型/球台/音频）、.cache/identity（身份服务编译产物）、
 * db/migrations、package.json、package-lock.json、生产 node_modules、deploy 的原生
 * Caddyfile/systemd/env 示例。数据库由目标服务器单独提供。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const STAGE = join(ROOT, ".cache/deploy-stage");
const OUT_DIR = join(ROOT, ".cache/deploy");
const REQUIRED = [
  join(ROOT, "dist/index.html"),
  join(ROOT, ".cache/identity/identity/main.js"),
  join(ROOT, "db/migrations"),
  join(ROOT, "package.json"),
  join(ROOT, "package-lock.json")
];

function fail(message) {
  console.error(`[deploy:bundle] ${message}`);
  process.exit(1);
}

for (const path of REQUIRED) {
  if (!existsSync(path)) fail(`缺少 ${path}；先执行 npm run build 和 npm run identity:build`);
}

console.log("[deploy:bundle] 1/4 校验资源与构建产物");
execFileSync(process.execPath, [join(ROOT, "scripts/deploy-check.mjs"), "--prod"], { cwd: ROOT, stdio: "inherit" });

console.log("[deploy:bundle] 2/4 准备运行目录");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(join(ROOT, "dist"), join(STAGE, "dist"), { recursive: true });
cpSync(join(ROOT, ".cache/identity"), join(STAGE, ".cache/identity"), { recursive: true });
cpSync(join(ROOT, "db/migrations"), join(STAGE, "db/migrations"), { recursive: true });
copyFileSync(join(ROOT, "package.json"), join(STAGE, "package.json"));
copyFileSync(join(ROOT, "package-lock.json"), join(STAGE, "package-lock.json"));
mkdirSync(join(STAGE, "deploy"), { recursive: true });
for (const file of ["Caddyfile.native", "kvb-identity.service", "identity.env.example"]) {
  const source = join(ROOT, "deploy", file);
  if (!existsSync(source)) fail(`缺少 ${source}`);
  copyFileSync(source, join(STAGE, "deploy", file));
}

console.log("[deploy:bundle] 3/4 安装生产依赖");
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: STAGE, stdio: "inherit" });
if (!existsSync(join(STAGE, "node_modules/pg/package.json"))) fail("生产依赖缺少 pg");

console.log("[deploy:bundle] 4/4 打包并计算摘要");
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const archive = join(OUT_DIR, `kvb-snooker-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-C", STAGE, "."], { stdio: "inherit" });
const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
const checksum = `${archive}.sha256`;
execFileSync("sh", ["-c", `printf '%s  %s\\n' '${hash}' '${archive.split("/").pop()}' > '${checksum}'`]);
rmSync(STAGE, { recursive: true, force: true });
const size = statSync(archive).size;
console.log(`[deploy:bundle] 完成：${archive}`);
console.log(`[deploy:bundle] 大小：${(size / 1024 / 1024).toFixed(1)} MiB  SHA-256：${hash}`);
console.log("[deploy:bundle] 上传后解压，配置 deploy/identity.env，迁移并启动；参考 deploy/REMOTE-DAY1.md");
