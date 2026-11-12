import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const label = process.argv[2] ?? "after";
assert.match(label, /^[a-z0-9-]+$/);
const directory = ".cache/pocket-review";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome", headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const views = [
  { name: "top", eye: [0, 1.55, 1.03], target: [0, 0.9, 1.02], fov: 0.66 },
  { name: "oblique", eye: [0.28, 1.23, 1.47], target: [0, 0.86, 1], fov: 0.66 },
  { name: "aim", eye: [0, 0.99, 0.12], target: [0, 0.904, 0.97], fov: 0.88 }
];
try {
  const deadline = setTimeout(() => { void browser.close(); }, 90000);
  deadline.unref();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/__pocket-review", route => route.fulfill({ contentType: "text/html",
    body: '<html><body style="margin:0"><canvas style="width:100vw;height:100vh;display:block"></canvas></body></html>' }));
  await page.goto(`${process.env.RENDER_URL ?? "http://127.0.0.1:18475"}/__pocket-review`);
  await page.evaluate(async () => {
    const source = await (await fetch("/src/render/scene.ts")).text();
    const dependency = source.match(/import \* as B from "([^"]+)"/)[1];
    const B = await import(dependency);
    const { loadTableScene } = await import("/src/render/scene.ts");
    const { tableJawShift } = await import("/src/core/physics/table-geometry.ts");
    const engine = new B.Engine(document.querySelector("canvas"), true, { preserveDrawingBuffer: true });
    const scene = await loadTableScene(engine, tableJawShift());
    for (let i = 0; i < 30; i++) {
      scene.render();
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    window.pocketReview = { engine, scene, B };
  });
  for (const view of views) {
    await page.evaluate(({ eye, target, fov }) => {
      const { scene, B } = window.pocketReview;
      const camera = scene.activeCamera;
      camera.position.copyFromFloats(...eye);
      camera.lockedTarget = new B.Vector3(...target);
      camera.fov = fov;
      for (let i = 0; i < 3; i++) scene.render();
    }, view);
    await page.screenshot({ path: `${directory}/${label}-${view.name}.png` });
  }
  const geometry = await page.evaluate(() => {
    const { scene } = window.pocketReview;
    return Object.fromEntries(["Pocket", "Frame", "PocketNet", "PocketLiner", "TableInner"].map(name => {
      const mesh = scene.getMeshByName(name);
      return [name, { positions: Array.from(mesh.getVerticesData("position")), indices: Array.from(mesh.getIndices()) }];
    }));
  });
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/${label}-geometry.json`, JSON.stringify(geometry));
  await writeFile(`${directory}/views.json`, JSON.stringify(views, null, 2));
  if (label === "after") {
    const before = JSON.parse(await readFile(`${directory}/before-geometry.json`, "utf8"));
    for (const name of ["PocketNet", "PocketLiner", "TableInner"]) {
      assert.deepEqual(geometry[name], before[name], `${name} must remain unchanged`);
    }
    const corners = positions => positions.reduce((points, x, i) => {
      if (i % 3 === 0 && Math.abs(x) > 1) points.push(...positions.slice(i, i + 3));
      return points;
    }, []);
    assert.deepEqual(corners(geometry.Pocket.positions), corners(before.Pocket.positions), "Corner leather unchanged");
    const middle = geometry.Pocket.positions.reduce((points, x, i) => {
      if (i % 3 === 0 && Math.abs(x) < 0.2) points.push(geometry.Pocket.positions.slice(i, i + 3));
      return points;
    }, []);
    const contains = (x, y, z) => middle.some(([a, b, c]) =>
      Math.abs(a - x) < 1e-6 && Math.abs(b - y) < 1e-6 && Math.abs(c - z) < 1e-6);
    for (const [x, y, z] of middle) {
      assert.ok([x, y, z].every(Number.isFinite));
      assert.ok(contains(-x, y, z), "Side leather must be symmetric across x");
      assert.ok(contains(x, y, -z), "Both side pockets must match");
    }
    const rows = views.map(view => `<tr><th>${view.name}</th><td><img src="before-${view.name}.png"></td><td><img src="after-${view.name}.png"></td></tr>`).join("");
    await writeFile(`${directory}/comparison.html`, `<!doctype html><meta charset="UTF-8"><title>中袋皮口前后对比</title>
      <style>body{margin:20px;background:#181818;color:#eee;font:16px sans-serif}table{width:100%;table-layout:fixed}th:first-child{width:70px}img{width:100%}td{vertical-align:top}</style>
      <h1>中袋皮口：固定机位对比</h1><p>相同光照、材质和视场角；未修改底袋、网袋、内衬、台呢和物理开口。</p>
      <table><tr><th>机位</th><th>修改前</th><th>修改后</th></tr>${rows}</table>`);
    console.log("Unchanged: corner leather, net, liner, cloth. Side leather finite and symmetric.");
  }
  console.log(`Pocket review: ${label}, three fixed views, no browser errors`);
} finally {
  await browser.close();
}
