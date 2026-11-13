import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const source = await fs.readFile(path.join(root, "src/core/physics/table-geometry.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } });
const { applyTableGeometry, TABLE_GEOMETRY, tableJawShift } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const table = applyTableGeometry(JSON.parse(await fs.readFile(path.join(root, "public/assets/physics/table.json"), "utf8")));
const outline = table.side.q.map(face => ({ x: table.side.p[face.i[0] * 3],
  z: table.side.p[face.i[0] * 3 + 2], pocket: face.f.includes("pocket") }));
const output = path.join(root, "public/assets/render/blender");
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "geometry.json"), JSON.stringify({ outline, tuning: TABLE_GEOMETRY,
  jawShift: tableJawShift(), bed: .88, radius: .02625 }, null, 2));
console.log(`Exported ${outline.length} physical outline points to ${output}`);
