import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const manifest = JSON.parse(await readFile(new URL("../src/render/assets.json", import.meta.url), "utf8"));
const source = resolve(process.argv[2] ?? "vendor-original/render");
const target = new URL("../public/assets/render/", import.meta.url);
for (const { file, sha256 } of Object.values(manifest)) {
  const data = await readFile(resolve(source, file));
  if (createHash("sha256").update(data).digest("hex") !== sha256) throw new Error(`Asset digest mismatch: ${file}`);
}
await mkdir(target, { recursive: true });
for (const { file } of Object.values(manifest)) await copyFile(resolve(source, file), new URL(file, target));
console.log(`Prepared ${Object.keys(manifest).length} verified render assets`);
