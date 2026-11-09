import assert from "node:assert/strict";
import { chromium } from "playwright-core";

/** 菜单操作指南：主菜单入口与对局内入口都应打开真实说明弹层。 */
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Menu smoke timed out"); void browser.close(); }, 120000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });

  await page.getByRole("button", { name: "操作指南", exact: true }).click();
  assert.equal(await page.locator(".guide-dialog").isVisible(), true);
  const content = await page.locator(".guide-dialog-content").textContent();
  assert.match(content, /W \/ ↑/);
  assert.match(content, /摆球/);
  assert.match(content, /预设球形/);
  await page.locator(".guide-dialog-close").click();
  assert.equal(await page.locator(".guide-dialog").isVisible(), false);

  await page.getByRole("button", { name: "练习", exact: true }).click();
  await page.getByRole("button", { name: "自由练习", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await page.locator(".ingame-menu-trigger").click();
  await page.locator(".ingame-action-btn").filter({ hasText: "操作指南" }).click();
  assert.equal(await page.locator(".guide-dialog").isVisible(), true);
  await page.locator(".guide-dialog-close").click();
  assert.equal(await page.locator(".guide-dialog").isVisible(), false);

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Menu smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
