#!/usr/bin/env node
/**
 * 远程内测页面的最小人工验收（部署后使用）。
 *
 * 环境变量：
 *   REMOTE_URL=https://<域名或临时 tunnel>  必填
 *   REMOTE_EMAIL=<内测账号邮箱>              必填
 *   REMOTE_PASSWORD=<内测账号密码>           必填，不打印
 *
 * 不包含数据库、服务端端口或测试账号初始化；只验证浏览器到已部署站点的真实链路。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const rawUrl = process.env.REMOTE_URL;
const email = process.env.REMOTE_EMAIL;
const password = process.env.REMOTE_PASSWORD;
if (!rawUrl || !email || !password) {
  console.error("需要 REMOTE_URL、REMOTE_EMAIL、REMOTE_PASSWORD");
  process.exit(2);
}
const origin = rawUrl.replace(/\/+$/, "");
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("Remote identity smoke timed out"); void browser.close(); }, 180000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => {
    const text = event.text();
    if (event.type() === "error" && !text.includes("401 (Unauthorized)")) errors.push(text);
  });
  const status = () => page.locator('output[role="status"]').textContent();
  const waitMenuHidden = () => page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden,
    undefined, { timeout: 15_000 });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator(".login-screen").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(".login-input").nth(0).fill(email);
  await page.locator(".login-input").nth(1).fill(password);
  await page.locator(".login-submit").click();
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 90_000 });
  assert.equal(await page.locator(".menu-identity-email").textContent(), email, "登录身份显示不正确");
  assert.equal(await page.locator(".home-card-two-player").isDisabled(), true, "内测双人入口必须禁用");

  await page.getByRole("button", { name: "练习", exact: true }).click();
  await page.getByRole("button", { name: "自由练习", exact: true }).click();
  await waitMenuHidden();
  await page.waitForTimeout(1_000);
  await page.locator("canvas").focus();
  await page.keyboard.press("w");
  await page.waitForFunction(() => /你的回合/.test(document.querySelector('output[role="status"]')?.textContent ?? ""),
    undefined, { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => /击球进行中/.test(document.querySelector('output[role="status"]')?.textContent ?? ""),
    undefined, { timeout: 15_000 });
  await page.waitForFunction(() => !/击球进行中/.test(document.querySelector('output[role="status"]')?.textContent ?? ""),
    undefined, { timeout: 45_000 });

  await page.locator(".ingame-menu-trigger").click();
  await page.getByRole("button", { name: "退出练习", exact: true }).click();
  await page.getByRole("button", { name: "确认退出", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 15_000 });
  await page.locator(".menu-logout-btn").click();
  await page.waitForFunction(() => document.querySelector(".login-screen") && !document.querySelector(".login-screen").hidden,
    undefined, { timeout: 30_000 });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`Remote identity smoke passed: ${origin}`);
} finally {
  clearTimeout(timeout);
  await browser.close();
}
