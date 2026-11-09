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

  // 主菜单/比赛解耦：退出 900 后倒计时必须冻结，回到首页
  await page.getByRole("button", { name: "AI 对战", exact: true }).click();
  assert.equal(await page.locator(".menu-back-bar").isVisible(), true);
  await page.getByRole("button", { name: "斯诺克 900", exact: true }).click();
  await page.getByRole("button", { name: "hard", exact: true }).click();
  await page.getByRole("button", { name: "开始比赛", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.locator(".ingame-menu-trigger").click();
  await page.locator(".ingame-action-btn").filter({ hasText: "退出对局" }).click();
  await page.waitForFunction(() => !document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await page.waitForTimeout(300);
  const frozenBefore = await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { expiry: r.game.session.timeUntilExpiry, suspended: r.game.isSuspended,
      input: r.game.controls.input.enabled, hud: r.game.hudDom.element.hidden, balls: r.balls.isHidden };
  });
  await page.waitForTimeout(1200);
  const frozenAfter = await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return r.game.session.timeUntilExpiry;
  });
  assert.ok(Math.abs(frozenAfter - frozenBefore.expiry) < 1e-6, "900 倒计时在菜单中必须冻结");
  assert.equal(frozenBefore.suspended, true);
  assert.equal(frozenBefore.input, false);
  assert.equal(frozenBefore.hud, true);
  assert.equal(frozenBefore.balls, true);
  assert.equal(await page.locator(".menu-home").isVisible(), true);

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
