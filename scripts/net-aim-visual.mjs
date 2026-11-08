import assert from "node:assert/strict";
import { aimClient, waitFor, sleep } from "./net-smoke-lib.mjs";
import { watchRemoteCue } from "./net-shot-visual.mjs";

async function waitForPoseMatch(shooter, viewer) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const [a, b] = await Promise.all([
      shooter.evaluate(() => window.__snkNet.localCueVisual),
      viewer.evaluate(() => window.__snkNet.remoteCueVisual)
    ]);
    if (b.visible && Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y,
      a.position.z - b.position.z) < .0001 && Math.abs(a.pitch - b.pitch) < .0001 &&
      Math.abs(Math.sin(a.yaw - b.yaw)) < .0001) return b;
    await sleep(50);
  }
  throw new Error("远端瞄准姿态未追上原StickController输出");
}

export async function assertAimEntry(shooter, viewer) {
  await watchRemoteCue(viewer);
  await shooter.evaluate(() => {
    const record = window.__snkLocalAim = { samples: [], stop: false };
    const observe = () => {
      if (record.stop) return;
      record.samples.push(window.__snkNet.localCueVisual);
      if (record.samples.length < 2000) requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  const version = await shooter.evaluate(() => window.__snkNet.snapshot().version);
  await aimClient(shooter);
  await waitForPoseMatch(shooter, viewer);
  const record = await viewer.evaluate(() => {
    window.__snkRemoteCue.stop = true;
    return window.__snkRemoteCue;
  });
  const visible = record.samples.filter(sample => sample.visible);
  const source = await shooter.evaluate(() => {
    window.__snkLocalAim.stop = true;
    return window.__snkLocalAim.samples.filter(sample => sample.visible);
  });
  const sourcePeak = Math.max(...source.map(sample => sample.pitch));
  const remotePeak = Math.max(...visible.map(sample => sample.pitch));
  assert.ok(remotePeak <= sourcePeak + .05 && remotePeak >= sourcePeak - .5,
    `观看方应保留击球方实际显示的入位过程：本地${sourcePeak}，远端${remotePeak}`);
  assert.ok(visible.some(sample => sample.pitch > .3 && sample.pitch < 1), "应有逐渐俯平的中间姿态");
  assert.ok(visible.some(sample => sample.pitch < .15), "最终应进入瞄准姿态");
  assert.ok(visible.every(sample => !sample.struck), "未按Space不能提前触球");
  assert.equal(await shooter.evaluate(() => window.__snkNet.timing().shotId), null);
  assert.equal(await shooter.evaluate(() => window.__snkNet.snapshot().version), version);
  const camera = record.samples[0].camera;
  assert.ok(visible.every(sample => Math.hypot(sample.camera.x - camera.x, sample.camera.y - camera.y,
    sample.camera.z - camera.z) < .01), "入位同步不得移动观看者相机");

  await shooter.keyboard.press("s");
  await waitFor(viewer, () => !window.__snkNet.remoteCueVisual.visible, 10000, "起身后远端球杆隐藏");
  await aimClient(shooter);
  const before = await waitForPoseMatch(shooter, viewer);
  const canvas = await shooter.locator("canvas").boundingBox();
  assert.ok(canvas);
  await shooter.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .5);
  await shooter.keyboard.down("Alt");
  await shooter.mouse.down();
  await shooter.mouse.move(canvas.x + canvas.width * .5 + 60, canvas.y + canvas.height * .5 - 20, { steps: 8 });
  await shooter.mouse.up();
  await shooter.keyboard.up("Alt");
  await sleep(300);
  const adjusted = await waitForPoseMatch(shooter, viewer);
  const shift = Math.hypot(adjusted.position.x - before.position.x, adjusted.position.y - before.position.y,
    adjusted.position.z - before.position.z);
  assert.ok(shift > .0001, "加塞应在观看方显示触点改变");
  await shooter.keyboard.press("c");
  await waitFor(shooter, () => window.__snkNet.readyToStroke, 10000, "清除加塞后准备出杆");
  await waitForPoseMatch(shooter, viewer);
  return { visibleFrames: visible.length, sourcePeak, remotePeak, firstPitch: visible[0].pitch,
    lastPitch: visible.at(-1).pitch, spinShift: shift };
}
