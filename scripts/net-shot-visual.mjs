import assert from "node:assert/strict";

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
