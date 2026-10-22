import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.state), undefined, { timeout: 30000 })
    .catch(error => { throw new Error(`${error.message}\n${errors.join("\n")}`); });
  const state = await page.locator("body").getAttribute("data-state");
  assert.equal(state, "ready", await page.locator("output").textContent());
  assert.deepEqual(errors, [], errors.join("\n"));
  const colors = await page.locator("canvas").evaluate(canvas => {
    const sample = document.createElement("canvas");
    sample.width = 64; sample.height = 64;
    const context = sample.getContext("2d");
    context.drawImage(canvas, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  });
  assert.ok(colors > 30, `Canvas has only ${colors} colors`);
  await mkdir(".cache/render", { recursive: true });
  await page.screenshot({ path: ".cache/render/smoke.png" });
  console.log(`Render smoke passed: ${colors} sampled colors, no shader/page/resource errors`);
} finally {
  await browser.close();
}
