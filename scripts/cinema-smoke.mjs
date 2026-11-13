import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const software = process.env.CINEMA_GPU !== "1";
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? "/usr/bin/google-chrome",
  headless: true, args: software ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [] });
const timeout = setTimeout(() => void browser.close(), 180000);
const reports = [];
const physical = [];
try {
  for (const mode of (process.env.VISUAL_MODES ?? "default,cinema").split(",")) {
    const cinema = mode !== "default";
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    const url = new URL(process.env.RENDER_URL ?? "http://127.0.0.1:5174");
    if (cinema) url.searchParams.set("visual", mode);
    await page.goto(url.href);
    await page.waitForFunction(() => ["ready", "error"].includes(document.body.dataset.state), undefined, { timeout: 60000 });
    assert.equal(await page.locator("body").getAttribute("data-state"), "ready", errors.join("\n"));
    await page.evaluate(async () => {
      const entry = document.querySelector('script[src*="/src/app.ts"]').src;
      window.cinemaTest = await (await import(entry)).runtime;
      window.cinemaTest.engine.stopRenderLoop();
      window.cinemaInitial = window.cinemaTest.simulator.serialize();
    });
    physical.push(await page.evaluate(() => {
      const { simulator } = window.cinemaTest;
      simulator.reset(true, true);
      simulator.restore(window.cinemaInitial);
      const p = simulator.getCueBallPosition();
      simulator.stroke(new Float32Array([p.x - .02625, p.y, p.z, 1, 0, 0, 7, .005]));
      for (let i = 0; i < 180; ++i) simulator.step(1 / 120);
      const outcome = { state: simulator.serialize(), result: simulator.getResult() };
      simulator.reset(true, true);
      simulator.restore(window.cinemaInitial);
      return outcome;
    }));
    const advance = count => page.evaluate(count => {
      const { game, balls, scene } = window.cinemaTest;
      for (let i = 0; i < count; ++i) game.update(1 / 60);
      balls.sync(); scene.render();
      return { busy: game.shots.busy, replay: game.replay.clip.available, active: game.replay.active };
    }, count);
    await page.getByRole("button", { name: "练习", exact: true }).click();
    await page.getByRole("button", { name: "自由练习", exact: true }).click();
    await advance(2);
    await page.locator("canvas").focus(); await page.keyboard.press("w"); await advance(120);
    assert.equal(await page.locator(".visual-controls").count(), cinema ? 1 : 0);
    if (cinema) {
      const before = await page.evaluate(() => JSON.stringify(window.cinemaTest.simulator.serialize()));
      await page.getByRole("button", { name: "俯视", exact: true }).click();
      await advance(1);
      assert.equal(await page.evaluate(() => window.cinemaTest.scene.activeCamera.mode), 1);
      assert.equal(await page.evaluate(() => window.cinemaTest.game.controls.input.enabled), false);
      await page.keyboard.press("Space"); await advance(2);
      assert.equal(await page.evaluate(() => JSON.stringify(window.cinemaTest.simulator.serialize())), before);
      await page.getByRole("button", { name: "展示", exact: true }).click(); await advance(1);
      const eye = await page.evaluate(() => window.cinemaTest.scene.activeCamera.position.asArray());
      await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(710, 420, { steps: 5 }); await page.mouse.up();
      await page.mouse.wheel(0, 120); await advance(1);
      assert.notDeepEqual(await page.evaluate(() => window.cinemaTest.scene.activeCamera.position.asArray()), eye);
      await page.keyboard.press("Escape"); await advance(1);
      assert.equal(await page.evaluate(() => window.cinemaTest.scene.activeCamera.mode), 0);
      assert.equal(await page.evaluate(() => window.cinemaTest.game.controls.input.enabled), true);
      await page.evaluate(() => window.cinemaTest.game.setCueBallStyle("red-dot")); await advance(1);
      assert.equal(await page.evaluate(() => window.cinemaTest.scene.getMeshByName("ball-0").material.name), "cinema-ball-0-dots");
      await page.evaluate(() => window.cinemaTest.game.setCueBallStyle("classic"));
      await page.getByRole("button", { name: "展示", exact: true }).click(); await advance(1);
      await page.evaluate(() => window.cinemaTest.game.controls.inHand.enter()); await advance(1);
      assert.equal(await page.locator(".visual-controls").isVisible(), false);
      await page.evaluate(() => window.cinemaTest.game.controls.inHand.exit()); await advance(1);
    }
    await page.locator("canvas").focus(); await page.keyboard.press("w"); await advance(120);
    await page.evaluate(() => { window.cinemaTest.game.human.strokePower = 0.25; });
    await page.keyboard.press("Space");
    let state = await advance(120);
    for (let i = 0; i < 40 && state.busy; ++i) state = await advance(120);
    assert.equal(state.busy, false, "Shot must settle");
    assert.equal(state.replay, true, "A playable shot must produce a replay");
    const beforeReplay = await page.evaluate(() => JSON.stringify(window.cinemaTest.simulator.serialize()));
    if (cinema) { await page.getByRole("button", { name: "俯视", exact: true }).click(); await advance(1); }
    await page.getByRole("button", { name: "回看上一杆", exact: true }).click(); await advance(30);
    assert.equal(await page.evaluate(() => window.cinemaTest.game.replay.active), true);
    if (cinema) {
      assert.equal(await page.locator(".visual-controls").isVisible(), false);
      assert.equal(await page.evaluate(() => window.cinemaTest.scene.activeCamera.mode), 0);
    }
    await page.getByRole("button", { name: "播放或暂停回放", exact: true }).click(); await advance(2);
    await page.getByRole("button", { name: "重新播放上一杆", exact: true }).click(); await advance(2);
    await page.getByRole("button", { name: "退出回放", exact: true }).click(); await advance(1);
    assert.equal(await page.evaluate(() => JSON.stringify(window.cinemaTest.simulator.serialize())), beforeReplay);
    if (cinema) {
      await page.getByRole("button", { name: "瞄准", exact: true }).click(); await advance(120);
      assert.equal(await page.evaluate(() => window.cinemaTest.game.controls.input.enabled), true);
    }
    const performance = await page.evaluate(async () => {
      const { scene, balls, engine } = window.cinemaTest;
      const times = [];
      for (let i = 0; i < 36; ++i) {
        const start = await new Promise(resolve => requestAnimationFrame(resolve));
        balls.sync(); scene.render();
        const end = await new Promise(resolve => requestAnimationFrame(resolve));
        if (i >= 6) times.push(end - start);
      }
      times.sort((a, b) => a - b);
      return { fpsMedian: 1000 / times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * .95)],
        renderer: engine.getGlInfo().renderer, visibleMeshes: scene.meshes.filter(mesh => mesh.isEnabled() && mesh.isVisible).length };
    });
    const geometry = await page.evaluate(() => {
      const { scene } = window.cinemaTest;
      const positions = scene.getMeshByName("ball-0").getVerticesData("position");
      const extents = [0, 1, 2].map(axis => {
        const values = Array.from(positions).filter((_, index) => index % 3 === axis);
        return Math.max(...values) - Math.min(...values);
      });
      return { extents, cueCount: scene.meshes.filter(mesh => mesh.name === "StickAlpha").length };
    });
    geometry.extents.forEach(diameter => assert.ok(Math.abs(diameter / 0.0525 - 1) < .02));
    assert.equal(geometry.cueCount, 1);
    if (mode === "blender") {
      const imported = await page.evaluate(async () => {
        const { scene } = window.cinemaTest;
        const cue = scene.getMeshByName("StickAlpha");
        const vertices = cue.getVerticesData("position");
        const x = Array.from(vertices).filter((_, i) => i % 3 === 0);
        const bounds = [Math.min(...x), Math.max(...x)];
        const cushion = scene.meshes.find(mesh => mesh.material?.name === "MAT_CushionCloth");
        const p = cushion.getVerticesData("position"), matrix = cushion.getWorldMatrix().m;
        const nose = [];
        for (let i = 0; i < p.length; i += 3) {
          const world = [0,1,2].map(axis => matrix[axis] * p[i] + matrix[axis+4] * p[i+1] + matrix[axis+8] * p[i+2] + matrix[axis+12]);
          if (Math.abs(world[1] - .90625) < 1e-5) nose.push([world[0], world[2]]);
        }
        const manifest = await (await fetch('/assets/render/blender/asset.json')).json();
        const errors = manifest.outline.filter(point => !point.pocket).map(point =>
          Math.min(...nose.map(([x,z]) => Math.hypot(x-point.x,z-point.z))));
        return { bounds, materialCount: cue.material.subMaterials.length,
          maxNoseError: Math.max(...errors), oldCloth: !!scene.getMeshByName("TableInner"),
          missingTextures: scene.materials.flatMap(material => material.getActiveTextures()).filter(texture => !texture.isReady()).length };
      });
      assert.ok(Math.abs(imported.bounds[0] + 1.45) < 1e-5 && Math.abs(imported.bounds[1]) < 1e-5, JSON.stringify(imported));
      assert.equal(imported.materialCount, 4);
      assert.ok(imported.maxNoseError < 1e-5, JSON.stringify(imported));
      assert.equal(imported.oldCloth, false); assert.equal(imported.missingTextures, 0);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.deepEqual(errors, [], errors.join("\n"));
    reports.push({ mode, ...performance });
    await page.close();
  }
  assert.deepEqual(physical[0], physical[1], "Appearance must not change deterministic physics");
  console.log(JSON.stringify({ software, viewport: "1280x800 @ DPR 1", reports,
    checks: "menu, camera/input ownership, aim, shoot, replay, dots, geometry, determinism, disposal; no screenshots" }, null, 2));
} finally { clearTimeout(timeout); await browser.close(); }
