import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function assertDiagnosticDownload(page) {
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本杆诊断", exact: true }).click();
  const download = await downloadReady;
  const report = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(report.format, 1);
  assert.ok(report.shotId);
  assert.ok(report.summary.motionFrames > 0);
  assert.ok(report.summary.motionPackets > 1);
  assert.ok(report.pongs.length > 0);
  assert.ok(report.frames.every(frame => frame.balls.length === 22 * 4 && frame.camera.length === 6));
  assert.ok(!("token" in report));
  assert.ok(!report.truncated);
  assert.ok((await page.locator(".net-hud").textContent()).includes("插值余量不适用"));
  return report.summary;
}

export async function watchShot(page) {
  await page.evaluate(() => {
    const origin = { ...window.__snkNet.shotVisual.cuePosition };
    const samples = [];
    window.__snkVisualShot = { origin, samples, stop: false };
    const observe = () => {
      const net = window.__snkNet;
      const record = window.__snkVisualShot;
      if (!net || record.stop) return;
      samples.push({ at: performance.now(), busy: net.shotsBusy,
        ...net.shotVisual, cuePosition: { ...net.shotVisual.cuePosition } });
      if (samples.length < 2000) requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
}

export async function assertShotVisual(page) {
  const record = await page.evaluate(() => {
    window.__snkVisualShot.stop = true;
    return window.__snkVisualShot;
  });
  const moved = sample => Math.hypot(sample.cuePosition.x - record.origin.x,
    sample.cuePosition.y - record.origin.y, sample.cuePosition.z - record.origin.z) > 1e-5;
  const firstMotion = record.samples.find(moved);
  assert.ok(firstMotion, "必须观察到真实显示中的母球移动，不能只读取网络快照");
  assert.equal(firstMotion.struck, true, "母球首次显示运动的那一帧，球杆必须已到触球阶段");
  assert.ok(firstMotion.leadingSpace >= -1e-6,
    `母球不能先跑、杆头仍在后拉（leadingSpace=${firstMotion.leadingSpace}）`);
  assert.ok(!record.samples.some(sample => sample.busy && moved(sample) && !sample.struck),
    "出杆动画期间不允许出现母球已移动但尚未触球的帧");
  return { samples: record.samples.length, firstMotionAtMs: firstMotion.at,
    leadingSpaceAtFirstMotion: firstMotion.leadingSpace, displayServerMs: firstMotion.displayServerMs };
}

export async function shootAcrossStall(page, stallMs) {
  await page.locator("canvas").focus();
  await page.evaluate(duration => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, bubbles: true }));
    const until = performance.now() + duration;
    while (performance.now() < until) {}
    canvas.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, bubbles: true }));
  }, stallMs);
}

export async function watchRemoteCue(page) {
  await page.evaluate(() => {
    const origin = { ...window.__snkNet.shotVisual.cuePosition };
    const record = window.__snkRemoteCue = { origin, samples: [], stop: false };
    const observe = () => {
      const net = window.__snkNet;
      if (!net || record.stop) return;
      record.samples.push({ at: performance.now(), ...net.remoteCueVisual,
        cue: { ...net.shotVisual.cuePosition }, camera: { ...net.cameraPosition } });
      if (record.samples.length < 2000) requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
}

export async function assertRemoteCue(page) {
  const record = await page.evaluate(() => {
    window.__snkRemoteCue.stop = true;
    return window.__snkRemoteCue;
  });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const visible = record.samples.filter(sample => sample.visible);
  assert.ok(visible.length >= 3, "观看方实际模型必须显示多帧球杆动作");
  assert.ok(visible.some(sample => !sample.struck && sample.leadingSpace < -.02 &&
    distance(sample.cue, record.origin) < 1e-5), "球仍静止时观看方须看到后拉");
  const moving = record.samples.find(sample => distance(sample.cue, record.origin) > 1e-5);
  assert.ok(moving?.visible && moving.struck, "母球首次移动时远端球杆必须显示且已经触球");
  assert.ok(moving.leadingSpace >= -1e-6, "远端球杆不能在母球移动后仍处于后拉");
  assert.ok(visible.every(sample => Number.isFinite(sample.position.x + sample.position.y + sample.position.z)));
  assert.ok(visible.every(sample => distance(sample.camera, record.samples[0].camera) < .01),
    "远端球杆不能接管观看者相机");
  assert.equal(record.samples.at(-1).visible, false, "出杆收尾后隐藏远端球杆");
  return { visibleFrames: visible.length, firstMotionAtMs: moving.at,
    leadingSpaceAtFirstMotion: moving.leadingSpace };
}
