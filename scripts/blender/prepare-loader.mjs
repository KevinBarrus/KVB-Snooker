import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const url = "https://registry.npmjs.org/babylonjs-loaders/-/babylonjs-loaders-3.2.0.tgz";
const integrity = "7r6k1Nb699aSrtD7eEqBF5eoHhdno9XF89tzk/vw7fm1ATkvQ7+g/+qQe9OFh0SZTfLsU0ib3Vl0j4dECOEVog==";
const loaderHash = "29395864e40005c554e27722c7566cc0a4af4ee44fc7d68a77269185bb08b6a6";
const output = path.join(root, "public/assets/render/blender");
const destination = path.join(output, "babylonjs.loaders.min.js");
try {
  if (createHash("sha256").update(await fs.readFile(destination)).digest("hex") === loaderHash) {
    console.log("Verified Babylon glTF loader 3.2.0 already installed");
    process.exit(0);
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }
const response = await fetch(url);
if (!response.ok) throw new Error(`Loader download: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
if (createHash("sha512").update(archive).digest("base64") !== integrity) throw new Error("Loader archive digest mismatch");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kvb-loader-"));
try {
  await fs.writeFile(path.join(temporary, "loader.tgz"), archive);
  execFileSync("tar", ["-xzf", path.join(temporary, "loader.tgz"), "-C", temporary]);
  const bytes = await fs.readFile(path.join(temporary, "package/babylonjs.loaders.min.js"));
  if (createHash("sha256").update(bytes).digest("hex") !== loaderHash) throw new Error("Loader script digest mismatch");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(destination, bytes);
  await fs.writeFile(path.join(output, "THIRD-PARTY.txt"),
    "babylonjs-loaders 3.2.0 — Microsoft Corporation, Apache-2.0.\nhttps://github.com/BabylonJS/Babylon.js\n" + url + "\n");
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
console.log("Installed verified Babylon glTF loader 3.2.0");
