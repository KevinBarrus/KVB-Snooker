import assert from "node:assert/strict";
import { chromium } from "playwright-core";

/**
 * 「我的球形」真实浏览器验收：创建/编辑、摆放/回收、彩球点位、保存、
 * 自建练习、清完四选项、删除/回收站/恢复，以及 50 个上限告示。
 */
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const timeout = setTimeout(() => { console.error("My shapes smoke timed out"); void browser.close(); }, 150000);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
  const runtime = async () => page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return r;
  });
  const snapshot = async () => page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const active = Array.from({ length: r.simulator.getBallCount() }, (_, index) => r.simulator.getBallView(index))
      .filter(ball => ball.active).length;
    return {
      editor: r.editor?.active ?? false,
      mode: r.game.session.mode,
      ballOn: r.game.session.context.ballOn,
      inHand: r.game.session.context.inHand,
      active,
      completion: !document.querySelector(".practice-completion")?.hidden,
      scoreVisible: document.querySelector(".score-container .left")?.style.display !== "none",
      ballOnHidden: document.querySelector(".score-container")?.classList.contains("hide-ball-on") ?? false,
      menuVisible: !document.querySelector(".game-menu-main")?.hidden
    };
  });
  const advance = async count => page.evaluate(async count => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (let index = 0; index < count; index++) {
      if (r.editor?.active) r.editor.update(.0167);
      else r.game.update(.0167);
    }
    r.balls.sync(); r.scene.render();
  }, count);
  const openMyShapes = async () => {
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "球形练习", exact: true }).click();
    await page.getByRole("button", { name: "我的球形", exact: true }).click();
  };

  await page.goto(process.env.RENDER_URL ?? "http://127.0.0.1:5173");
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });

  // 1) 创建：空台、摆两颗红球、右键回收一颗、摆放彩球、命名完成
  await openMyShapes();
  assert.equal(await page.locator(".my-shapes-item").count(), 0);
  await page.getByRole("button", { name: "创建球形", exact: true }).click();
  await advance(2);
  let state = await snapshot();
  assert.equal(state.editor, true);
  assert.equal(state.active, 0);
  assert.equal(await page.locator(".shape-editor-ball .shape-editor-count").first().textContent(), "15");

  await page.locator(".shape-editor-ball").first().click();
  await page.mouse.move(640, 420); await advance(2);
  assert.equal(await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return r.editor.markers.preview.isVisible;
  }), true, "Selected ball must show a preview ring on the table");
  const placeRed = async (x, y) => {
    await page.mouse.move(x, y); await page.mouse.click(x, y);
    await advance(2);
  };
  await placeRed(640, 420);
  await placeRed(700, 440);
  assert.equal((await snapshot()).active, 2);
  await page.mouse.move(640, 420); await page.mouse.click(640, 420, { button: "right" });
  await advance(1);
  assert.equal(await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return r.editor.markers.preview.isVisible;
  }), false, "No placement preview while the recycle dialog is open");
  assert.equal(await page.locator(".shape-editor-dialog").count(), 1);
  await page.locator(".shape-editor-dialog").getByRole("button", { name: "取消", exact: true }).click();
  await advance(1);
  assert.equal(await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return r.editor.markers.origin.isVisible;
  }), false, "Cancelling recycle must hide the white halo");
  await page.mouse.click(640, 420, { button: "right" });
  await advance(1);
  await page.locator(".shape-editor-dialog").getByRole("button", { name: "回收", exact: true }).click();
  await advance(2);
  assert.equal((await snapshot()).active, 1);

  await page.getByRole("button", { name: "将彩球放在点位", exact: true }).click();
  await page.getByRole("button", { name: "黄球", exact: true }).click();
  await page.getByRole("button", { name: "绿球", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await advance(2);
  assert.equal((await snapshot()).active, 3);

  await page.getByRole("button", { name: "完成创建", exact: true }).click();
  const nameInput = page.locator(".shape-editor-dialog input");
  await nameInput.fill("  冒烟球形  ");
  await page.locator(".shape-editor-dialog").getByRole("button", { name: "创建", exact: true }).click();
  await page.locator(".shape-editor-dialog").getByRole("button", { name: "确认", exact: true }).click();
  await page.locator(".shape-editor-dialog").getByRole("button", { name: "返回", exact: true }).click();
  await advance(2);
  assert.equal(await page.locator(".my-shapes-item").count(), 1);
  assert.equal(await page.locator(".my-shapes-name").first().textContent(), "冒烟球形");

  // 2) 自建练习：经典母球、任意球规则、只显示分数和单杆
  await page.locator(".my-shapes-item").first().click();
  await page.getByRole("button", { name: "经典母球", exact: true }).click();
  await advance(3);
  state = await snapshot();
  assert.equal(state.editor, false);
  assert.equal(state.mode, "practice");
  assert.equal(state.ballOn, 65535);
  assert.equal(state.inHand, 2);
  assert.equal(state.active, 4);
  assert.equal(state.scoreVisible, true);
  assert.equal(state.ballOnHidden, true);
  assert.equal(await page.locator(".practice-restore").isVisible(), true);
  assert.equal(await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    const initial = r.game.controls.inHand.active;
    r.game.controls.inHand.exit();
    r.game.afterPracticeShot();
    return { initial, afterShot: r.game.controls.inHand.active };
  }).then(value => value.initial && !value.afterShot), true, "Only the initial custom practice should open the cue halo");
  await page.locator(".ingame-menu-trigger").click();
  const customActions = await page.locator(".ingame-action-btn").allTextContents();
  assert.equal(customActions.includes("暂停"), false);
  await page.locator(".ingame-menu-close").click();

  // 3) 清完四选项：继续与退出
  await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    r.game.startedWithObjectBalls = true;
    for (const ball of r.simulator.getBalls()) if (ball.index > 0) r.simulator.resetBallPosition(ball, null);
    r.game.afterPracticeShot();
  });
  await advance(1);
  assert.equal((await snapshot()).completion, true);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await advance(1);
  assert.equal((await snapshot()).completion, false);
  await page.evaluate(async () => { const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime; r.game.afterPracticeShot(); });
  await advance(1);
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await advance(2);
  assert.equal(await page.locator(".my-shapes-item").count(), 1);

  // 4) 编辑保存、删除、恢复、彻底删除
  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "编辑", exact: true }).click();
  await advance(2);
  assert.equal((await snapshot()).editor, true);
  await page.locator(".shape-editor-tools").getByRole("button", { name: "保存", exact: true }).click();
  await advance(1);
  const cameraBefore = await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { x: r.scene.activeCamera.position.x, z: r.scene.activeCamera.position.z };
  });
  await page.keyboard.down("a"); await advance(8); await page.keyboard.up("a");
  const cameraAfter = await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    return { x: r.scene.activeCamera.position.x, z: r.scene.activeCamera.position.z };
  });
  assert.ok(Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.z - cameraBefore.z) > 0.02,
    "A/D camera orbit must work while the save confirmation is open");
  await page.locator(".menu-choice-dialog").getByRole("button", { name: "保存", exact: true }).click();
  await advance(2);
  assert.equal(await page.locator(".my-shapes-item").count(), 1);

  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "重命名", exact: true }).click();
  const renameInput = page.locator(".menu-choice-dialog input");
  await renameInput.fill("改名球形");
  await page.locator(".menu-choice-dialog").getByRole("button", { name: "确认", exact: true }).click();
  await advance(1);
  assert.equal(await page.locator(".my-shapes-name").first().textContent(), "改名球形");

  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "删除", exact: true }).click();
  await page.locator(".menu-choice-dialog").getByRole("button", { name: "删除", exact: true }).click();
  await advance(1);
  await page.getByRole("button", { name: "球形回收站", exact: true }).click();
  await advance(1);
  assert.equal(await page.locator(".my-shapes-item").count(), 1);
  assert.match(await page.locator(".my-shapes-expiry").first().textContent(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "我的球形", exact: true }).click();
  await advance(1);
  assert.equal(await page.locator(".my-shapes-item").count(), 1);
  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "删除", exact: true }).click();
  await page.locator(".menu-choice-dialog").getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "球形回收站", exact: true }).click();
  await page.locator(".my-shapes-item").first().click({ button: "right" });
  await page.locator(".my-shapes-context").getByRole("button", { name: "彻底删除", exact: true }).click();
  await page.locator(".menu-choice-dialog").getByRole("button", { name: "彻底删除", exact: true }).click();
  await advance(1);
  assert.equal(await page.locator(".my-shapes-item").count(), 0);

  // 5) 预设清彩也使用清完四选项
  await openMyShapes();
  await page.getByRole("button", { name: "练习", exact: true }).click();
  await page.getByRole("button", { name: "球形练习", exact: true }).click();
  await page.getByRole("button", { name: "清彩练习", exact: true }).click();
  await page.getByRole("button", { name: "经典母球", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".game-menu-main")?.hidden, undefined, { timeout: 10000 });
  await advance(2);
  await page.evaluate(async () => {
    const r = await (await import(document.querySelector('script[src*="/src/app.ts"]').src)).runtime;
    for (const ball of r.simulator.getBalls()) if (ball.index > 0) r.simulator.resetBallPosition(ball, null);
    r.game.afterPracticeShot();
  });
  await advance(1);
  assert.equal((await snapshot()).completion, true);
  await page.getByRole("button", { name: "重摆", exact: true }).click();
  await advance(2);
  assert.equal((await snapshot()).active, 7);
  assert.equal((await snapshot()).completion, false);

  // 6) 50 个上限：只告示 + ×，不进入编辑器
  await page.evaluate(() => {
    const shapes = Array.from({ length: 50 }, (_, index) => ({
      id: `cap-${index}`, name: `上限球形 ${index}`, balls: [], createdAt: 1000 + index, deletedAt: null
    }));
    localStorage.setItem("snk.practice.shapes.v1", JSON.stringify({ version: 1, shapes }));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: 30000 });
  await openMyShapes();
  await page.getByRole("button", { name: "创建球形", exact: true }).click();
  await advance(1);
  const capDialog = page.locator(".menu-choice-dialog").filter({ hasText: "自建球形数量已达上限" });
  assert.match(await capDialog.textContent(), /自建球形数量已达上限（50个）/);
  assert.equal(await page.locator(".shape-editor-layer").isVisible(), false);
  await capDialog.locator(".my-shapes-dialog-close").click();

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("My shapes smoke passed");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
