import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright-core";

const ROOT = join(import.meta.dirname, "..");
const DATABASE_URL = process.env.IDENTITY_TEST_DATABASE_URL
  ?? "postgres://postgres@127.0.0.1:55432/snk_identity_browser";
const PORT = Number(process.env.IDENTITY_TEST_PORT ?? 18788);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ALPHA = { email: "alpha@kvb.test", password: "Alpha-Beta-Test-2026" };
const BETA = { email: "beta@kvb.test", password: "Beta-Beta-Test-2026" };
const MIGRATIONS = join(ROOT, "db/migrations");
const SERVER_ENTRY = join(ROOT, ".cache/identity/identity/main.js");

function waitForExit(child) {
  return new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
}

async function waitForHealth(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await delay(200);
  }
  throw new Error("identity service did not become healthy");
}

async function resetDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
    const { runMigrations } = await import(join(ROOT, ".cache/identity/identity/migrations.js"));
    await runMigrations(pool, MIGRATIONS);
    const { createUserAccount } = await import(join(ROOT, ".cache/identity/identity/identity-service.js"));
    const alpha = await createUserAccount(pool, { email: ALPHA.email, password: ALPHA.password, role: "player" });
    const beta = await createUserAccount(pool, { email: BETA.email, password: BETA.password, role: "player" });
    assert.equal(alpha.ok && beta.ok, true);
    return { alphaId: alpha.user.id, betaId: beta.user.id };
  } finally {
    await pool.end();
  }
}

async function main() {
  const { alphaId, betaId } = await resetDatabase();
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      STATIC_DIR: "dist",
      PUBLIC_ORIGIN: ORIGIN,
      COOKIE_SECURE: "0",
      TRUST_PROXY: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  server.stdout.on("data", chunk => { serverLog += String(chunk); });
  server.stderr.on("data", chunk => { serverLog += String(chunk); });

  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
    headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await waitForHealth();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => {
      const text = event.text();
      // 未登录 / 错误密码的 401 是预期网络响应，不是页面脚本错误。
      if (event.type() === "error" && !text.includes("401 (Unauthorized)")) errors.push(text);
    });
    const status = () => page.locator('output[role="status"]').textContent();
    const login = async (email, password) => {
      await page.locator(".login-input").nth(0).fill(email);
      await page.locator(".login-input").nth(1).fill(password);
      await page.locator(".login-submit").click();
    };
    const waitReady = () => page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 60_000 });
    const waitMenu = () => page.waitForFunction(() => !document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10_000 });
    const waitGame = () => page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10_000 });
    const click = async name => { await page.getByRole("button", { name, exact: true }).click(); };
    const exitPractice = async () => {
      await page.locator(".ingame-menu-trigger").click();
      await page.getByRole("button", { name: "退出练习", exact: true }).click();
      await page.getByRole("button", { name: "确认退出", exact: true }).click();
      await waitMenu();
    };
    const waitStatus = async (pattern, timeout = 30_000) => {
      await page.waitForFunction(text => new RegExp(text).test(document.querySelector('output[role="status"]')?.textContent ?? ""),
        pattern, { timeout });
    };
    const shoot = async () => {
      await page.locator("canvas").focus();
      await page.keyboard.press("w");
      await waitStatus("你的回合", 10_000);
      await page.waitForTimeout(1_500);
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);
      await page.keyboard.press("Space");
      await waitStatus("击球进行中", 10_000);
      await page.waitForFunction(() => {
        const text = document.querySelector('output[role="status"]')?.textContent ?? "";
        return !text.includes("击球进行中");
      }, undefined, { timeout: 30_000 });
    };
    const openMyShapes = async () => {
      await click("练习");
      await click("球形练习");
      await click("我的球形");
    };

    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    await page.locator(".login-screen").waitFor({ state: "visible", timeout: 20_000 });
    assert.equal(await page.locator(".game-menu-main").isVisible(), false, "未登录不能进入主菜单");
    await login(ALPHA.email, "wrong-password");
    await page.locator(".login-message").filter({ hasText: "邮箱或密码不正确" }).waitFor({ timeout: 5_000 });
    assert.equal(await page.locator(".login-screen").isVisible(), true, "错误密码不能进入游戏");

    await login(ALPHA.email, ALPHA.password);
    await waitReady();
    assert.equal(await page.locator(".menu-identity-email").textContent(), ALPHA.email);
    assert.equal(await page.locator(".home-card-two-player").isDisabled(), true, "正式构建双人入口必须明确不可用");

    // 预设球形：真实出杆
    await click("练习");
    await click("球形练习");
    await click("经典蛇彩");
    await click("经典母球");
    await waitGame();
    await shoot();
    await exitPractice();

    // 自由练习：真实出杆
    await click("练习");
    await click("自由练习");
    await waitGame();
    await shoot();
    await exitPractice();

    // 人机：玩家出杆、AI 回合、回合交还、比分牌存在
    await click("AI 对战");
    await click("经典斯诺克");
    await click("normal");
    await click("开始比赛");
    await waitGame();
    await shoot();
    await waitStatus("AI 回合", 20_000);
    await waitStatus("你的回合|本局结束", 45_000);
    assert.equal(await page.locator(".score-container").isVisible(), true, "人机对局必须保留计分牌");

    // 900：起表并可在玩家回合出杆
    await page.locator(".ingame-menu-trigger").click();
    await page.getByRole("button", { name: "退出对局", exact: true }).click();
    await waitMenu();
    await click("AI 对战");
    await click("斯诺克 900");
    await click("normal");
    await click("开始比赛");
    await waitGame();
    await page.locator(".match-clock").waitFor({ state: "visible", timeout: 5_000 });
    assert.notEqual((await page.locator(".match-clock-frame").textContent())?.trim(), "00:00");
    if ((await status()).includes("AI 回合")) await waitStatus("你的回合", 45_000);
    await shoot();
    await page.locator(".ingame-menu-trigger").click();
    await page.getByRole("button", { name: "退出对局", exact: true }).click();
    await waitMenu();

    // 自建球形：保存、刷新后仍在、重新打开练习
    await openMyShapes();
    assert.equal(await page.locator(".my-shapes-item").count(), 0);
    await click("创建球形");
    await page.locator(".shape-editor-tools").waitFor({ state: "visible", timeout: 10_000 });
    await click("完成创建");
    await page.locator(".shape-editor-dialog input").fill("内测空台");
    await page.locator(".shape-editor-dialog").getByRole("button", { name: "创建", exact: true }).click();
    await page.locator(".shape-editor-dialog").getByRole("button", { name: "确认", exact: true }).click();
    await page.locator(".shape-editor-dialog").getByRole("button", { name: "返回", exact: true }).click();
    await page.locator(".my-shapes-item").filter({ hasText: "内测空台" }).waitFor({ timeout: 10_000 });
    await page.reload();
    await waitReady();
    assert.equal(await page.locator(".menu-identity-email").textContent(), ALPHA.email, "刷新后会话必须保持");
    await openMyShapes();
    await page.locator(".my-shapes-item").filter({ hasText: "内测空台" }).waitFor({ timeout: 10_000 });
    await page.locator(".my-shapes-item").filter({ hasText: "内测空台" }).click();
    await page.getByRole("button", { name: "经典母球", exact: true }).click();
    await waitGame();
    await page.waitForTimeout(400);
    assert.match(await status(), /放置母球|你的回合/);
    await exitPractice();

    const alphaKey = `snk.user.${alphaId}.practice.shapes.v1`;
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, alphaKey), true,
      "自建球形必须写入当前用户命名空间");
    assert.equal(await page.evaluate(id => localStorage.getItem(`snk.user.${id}.practice.shapes.v1`), betaId), null,
      "两个账号的本地球形命名空间必须隔离");

    // 退出登录后旧会话失效，第二个账号看不到第一个账号的本地球形
    await page.locator(".menu-logout-btn").click();
    await page.waitForFunction(() => document.querySelector(".login-screen") && !document.querySelector(".login-screen").hidden,
      undefined, { timeout: 30_000 });
    await login(BETA.email, BETA.password);
    await waitReady();
    assert.equal(await page.locator(".menu-identity-email").textContent(), BETA.email);
    await openMyShapes();
    assert.equal(await page.locator(".my-shapes-item").count(), 0, "第二个账号不能看到第一个账号的本地球形");
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, alphaKey), true,
      "第一个账号的数据不能因切换账号被删除");

    // 身份后端不可用：登录页显示真实错误，不能自动进入游戏。
    const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const offlinePage = await offlineContext.newPage();
    await offlinePage.route("**/api/**", route => route.abort("connectionrefused"));
    await offlinePage.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    await offlinePage.locator(".login-screen").waitFor({ state: "visible", timeout: 20_000 });
    await offlinePage.locator(".login-message").filter({ hasText: "身份服务暂时不可用" }).waitFor({ timeout: 10_000 });
    assert.equal(await offlinePage.locator(".game-menu-main").isVisible(), false,
      "身份后端不可用时不能绕过登录进入游戏");
    await offlineContext.close();

    assert.equal(errors.length, 0, errors.join("\n"));
    console.log("Identity browser smoke passed: login, preset/free practice, AI, 900, custom shapes, per-user storage, logout");
  } finally {
    await browser.close();
    server.kill("SIGTERM");
    const stopped = await Promise.race([waitForExit(server), delay(5_000).then(() => null)]);
    if (stopped === null) server.kill("SIGKILL");
    if (serverLog.includes("启动失败")) throw new Error(serverLog);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
