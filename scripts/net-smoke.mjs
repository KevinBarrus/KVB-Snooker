import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { watchShot, assertShotVisual, shootAcrossStall } from "./net-shot-visual.mjs";
import {
  CHROME_BIN, LEAD_MS, aimClient, assertSnapshotsEqual, buildServer, closePages, openClient, readNet, recordShot,
  resolveDecision, shoot, sleep, startServer, stopServer
} from "./net-smoke-lib.mjs";

/**
 * 联机开发原型验收：两个真实浏览器客户端 + 真实 Node 房间服务器。
 * 场景与实测数字见 docs/multiplayer-prototype-design.md §10。仅用于开发原型验收。
 */

const results = [];

async function runBaseline(browser) {
  const server = await startServer();
  const pages = [];
  try {
    const room = "s-baseline";
    const [seat0, seat1] = await Promise.all([
      openClient(browser, server.info, room, 0, "baseline-seat0"),
      openClient(browser, server.info, room, 1, "baseline-seat1")
    ]);
    pages.push(seat0, seat1);
    const initial0 = await readNet(seat0);
    const initial1 = await readNet(seat1);
    assert.equal(initial0.seat, 0);
    assert.equal(initial1.seat, 1);
    assert.equal(initial0.latency.enabled, false);
    assert.equal(initial0.latency.appliesTo, "one-way-per-direction");
    const cameraBefore = (await readNet(seat1)).cameraPosition;
    const versionBefore = initial0.snapshot.version;

    await aimClient(seat0);
    const aimed = await readNet(seat0);
    assert.equal(aimed.turn, true, "席位 0 应轮到本机");
    await watchShot(seat0);
    await shoot(seat0);
    const motion = await recordShot([seat0, seat1], 0);
    await resolveDecision([seat0, seat1]);
    const final0 = await readNet(seat0);
    const final1 = await readNet(seat1);
    assertSnapshotsEqual(final0.snapshot, final1.snapshot, "baseline 两端结算快照");

    const visual = await assertShotVisual(seat0);
    const t = final0.timing;
    for (const key of ["spaceAtMs", "commandSentAtMs", "ackAtMs", "projectedTouchAtMs",
      "animationTouchAtMs", "firstMotionSnapshotAtMs", "firedEventAtMs"]) {
      assert.notEqual(t[key], null, `baseline timing.${key} 应有值`);
    }
    assert.equal(t.retries, 0, "无延迟注入时不应重试");
    assert.ok(t.ackAtMs > t.spaceAtMs, "Ack 必须晚于 Space");
    assert.ok(t.projectedTouchAtMs > t.ackAtMs, "投影触球必须晚于 Ack（prepareLead 生效）");
    assert.ok(t.firstMotionSnapshotAtMs >= t.projectedTouchAtMs - 30,
      "首个运动快照不能在权威触球前出现");
    assert.ok(t.firstMotionSnapshotAtMs - t.projectedTouchAtMs <= 400,
      "首个运动快照不应远晚于权威触球");
    assert.ok(t.firedEventAtMs - t.projectedTouchAtMs <= 400, "shot-fired 事件不应远晚于触球");
    assert.ok(t.animationTouchAtMs >= t.ackAtMs, "动画触球不能早于服务器确认");
    const animationDelta = t.animationTouchAtMs - t.projectedTouchAtMs;

    // 同一杆运动：两端在共同版本上必须逐位一致，且都看到了运动阶段。
    const commonVersions = [...motion.samples[0].keys()].filter(version => motion.samples[1].has(version));
    assert.ok(commonVersions.length >= 2, `两端共同快照版本应足够比较：${commonVersions.length}`);
    for (const version of commonVersions) {
      assertSnapshotsEqual(
        { version, phase: motion.samples[0].get(version).phase, context: motion.samples[0].get(version).context, balls: motion.samples[0].get(version).balls },
        { version, phase: motion.samples[1].get(version).phase, context: motion.samples[1].get(version).context, balls: motion.samples[1].get(version).balls },
        `双端共同快照 v${version}`);
    }
    const sawSimulating = [...motion.samples[0].values()].some(sample => sample.phase === "simulating") &&
      [...motion.samples[1].values()].some(sample => sample.phase === "simulating");
    assert.ok(sawSimulating, "两端都应观察到球运动阶段");

    // 对手相机独立且没有替对手出杆。
    const cameraAfter = final1.cameraPosition;
    const cameraDelta = Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.y - cameraBefore.y, cameraAfter.z - cameraBefore.z);
    assert.ok(cameraDelta < 0.2, `对手相机不应被本杆接管（位移 ${cameraDelta.toFixed(3)}）`);
    assert.equal(final1.timing.shotId, null, "非击球端不应持有本杆动画/出杆状态");

    // 球权：只有当前持权者可以出杆；无权端按 Space 不产生任何命令/版本变化。
    const current = final0.snapshot.context.playerIndex;
    assert.equal(final0.turn, current === 0, "席位 0 操作权应与权威球权一致");
    assert.equal(final1.turn, current === 1, "席位 1 操作权应与权威球权一致");
    const idle = current === 0 ? seat1 : seat0;
    const idleBefore = await readNet(idle);
    await shoot(idle);
    await sleep(500);
    const idleAfter = await readNet(idle);
    assert.equal(idleAfter.snapshot.version, idleBefore.snapshot.version, "无权席位按 Space 不能改变权威版本");
    assert.equal(idleAfter.timing.shotId, idleBefore.timing.shotId, "无权席位按 Space 不能产生新的出杆时序");
    assert.equal(idleAfter.timing.retries, idleBefore.timing.retries, "无权席位按 Space 不能产生命令重试");
    assert.equal(final0.snapshot.version >= versionBefore + 3, true, "一次真实击球至少推进 prepare/fire/settle 三个版本");

    results.push({
      name: "baseline", room, leadMs: LEAD_MS,
      timing: t, visual, animationMinusProjectedMs: Math.round(animationDelta),
      versionBefore, versionAfter: final0.snapshot.version,
      commonVersions: commonVersions.length, cameraDelta,
      players: final0.snapshot.context.playerIndex,
      note: "actual rendered frames checked; animation timestamp is observed frame time"
    });
    await mkdir(".cache/net", { recursive: true });
    await seat0.screenshot({ path: ".cache/net/baseline-seat0.png" });
    await seat1.screenshot({ path: ".cache/net/baseline-seat1.png" });
    return { t, final: final0.snapshot, motionVersions: commonVersions.length };
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function runAlignment(browser) {
  const leadMs = 1600;
  const server = await startServer([], leadMs);
  const pages = [];
  try {
    const [seat0, seat1] = await Promise.all([
      openClient(browser, server.info, "s-align", 0, "align-seat0"),
      openClient(browser, server.info, "s-align", 1, "align-seat1")
    ]);
    pages.push(seat0, seat1);
    await aimClient(seat0);
    await watchShot(seat0);
    await shoot(seat0);
    const motion = await recordShot([seat0, seat1], 0);
    const final0 = await readNet(seat0);
    const final1 = await readNet(seat1);
    assertSnapshotsEqual(final0.snapshot, final1.snapshot, "alignment 两端结算快照");
    const visual = await assertShotVisual(seat0);
    const t = final0.timing;
    const delta = t.animationTouchAtMs - t.projectedTouchAtMs;
    assert.ok(t.animationTouchAtMs <= visual.firstMotionAtMs,
      "实际显示触球帧不能晚于母球首次运动帧");
    assert.ok(t.firstMotionSnapshotAtMs - t.projectedTouchAtMs <= 400);
    results.push({ name: "alignment", leadMs, visual, animationMinusProjectedMs: Math.round(delta),
      spaceToProjectedMs: Math.round(t.projectedTouchAtMs - t.spaceAtMs),
      commonVersions: [...motion.samples[0].keys()].filter(version => motion.samples[1].has(version)).length });
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function runDropAck(browser) {
  const server = await startServer(["--drop-next-ack"]);
  const pages = [];
  try {
    const room = "s-drop-ack";
    const [seat0, seat1] = await Promise.all([
      openClient(browser, server.info, room, 0, "drop-ack-seat0"),
      openClient(browser, server.info, room, 1, "drop-ack-seat1")
    ]);
    pages.push(seat0, seat1);
    const initial = await readNet(seat0);
    const versionBefore = initial.snapshot.version;
    await aimClient(seat0);
    await watchShot(seat0);
    await shoot(seat0);
    const motion = await recordShot([seat0], 0);
    const final = await readNet(seat0);
    assert.ok(final.timing.retries >= 1, `确认丢失后客户端应使用同一 commandId 重试（retries=${final.timing.retries}）`);
    assert.equal(final.snapshot.version - versionBefore, 3,
      `重复命令只能产生一次实际击球（版本增量应恰为 3：${final.snapshot.version} - ${versionBefore}）`);
    assert.notEqual(final.timing.shotId, null);
    const visual = await assertShotVisual(seat0);
    results.push({ name: "drop-ack", visual, versionBefore, versionAfter: final.snapshot.version,
      retries: final.timing.retries, commonVersions: motion.samples[0].size });
    return final;
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function runLatency(browser) {
  const leadMs = 1600;
  const server = await startServer(["--latency-in-ms", "80", "--latency-out-ms", "80"], leadMs);
  const pages = [];
  try {
    const room = "s-latency";
    const [seat0, seat1] = await Promise.all([
      openClient(browser, server.info, room, 0, "latency-seat0"),
      openClient(browser, server.info, room, 1, "latency-seat1")
    ]);
    pages.push(seat0, seat1);
    const initial = await readNet(seat0);
    assert.equal(initial.latency.enabled, true, "延迟注入应报告为开启");
    assert.equal(initial.latency.inboundMs, 80);
    assert.equal(initial.latency.outboundMs, 80);
    assert.equal(initial.latency.appliesTo, "one-way-per-direction", "配置必须声明是单程延迟");
    await aimClient(seat0);
    await watchShot(seat0);
    await shoot(seat0);
    const motion = await recordShot([seat0, seat1], 0);
    const final0 = await readNet(seat0);
    const final1 = await readNet(seat1);
    assertSnapshotsEqual(final0.snapshot, final1.snapshot, "latency 两端结算快照");
    const visual = await assertShotVisual(seat0);
    const t = final0.timing;
    assert.ok(t.ackAtMs - t.spaceAtMs >= 130, `往返延迟应体现（Ack-Space=${Math.round(t.ackAtMs - t.spaceAtMs)}ms）`);
    assert.ok(t.projectedTouchAtMs - t.spaceAtMs >= leadMs + 40,
      `投影触球应包含入站单程延迟（${Math.round(t.projectedTouchAtMs - t.spaceAtMs)}ms < ${leadMs + 40}ms）`);
    const latencyAnimationDelta = t.animationTouchAtMs - t.projectedTouchAtMs;
    assert.ok(t.animationTouchAtMs <= visual.firstMotionAtMs,
      "延迟注入下实际显示触球帧不能晚于母球首次运动帧");
    assert.ok(t.firstMotionSnapshotAtMs - t.projectedTouchAtMs >= 30,
      `首个运动快照应晚于投影触球约一个出站单程（${Math.round(t.firstMotionSnapshotAtMs - t.projectedTouchAtMs)}ms）`);
    assert.ok(t.firstMotionSnapshotAtMs - t.projectedTouchAtMs <= 400, "出站延迟不应阻塞物理");
    assert.ok(t.retries === 0);
    const commonVersions = [...motion.samples[0].keys()].filter(version => motion.samples[1].has(version));
    assert.ok(commonVersions.length >= 2, "延迟下两端仍应共享同一杆快照版本");
    results.push({ name: "latency", leadMs, timing: t, visual, commonVersions: commonVersions.length,
      animationMinusProjectedMs: Math.round(latencyAnimationDelta),
      rttMs: Math.round(t.ackAtMs - t.spaceAtMs) });
    return { t, commonVersions };
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function runTwoRooms(browser) {
  const server = await startServer();
  const pages = [];
  try {
    const [roomA, roomB] = await Promise.all([
      openClient(browser, server.info, "iso-a", 0, "iso-a"),
      openClient(browser, server.info, "iso-b", 0, "iso-b")
    ]);
    pages.push(roomA, roomB);
    const aInitial = await readNet(roomA);
    const bInitial = await readNet(roomB);
    assert.equal(aInitial.snapshot.roomId, "iso-a");
    assert.equal(bInitial.snapshot.roomId, "iso-b");

    // 房间 A 推进时，房间 B 的权威版本与球位不得变化。
    await aimClient(roomA);
    await shoot(roomA);
    const bVersionBefore = (await readNet(roomB)).snapshot.version;
    const bBallsBefore = (await readNet(roomB)).snapshot.balls;
    await sleep(900);
    const aMid = await readNet(roomA);
    const bMid = await readNet(roomB);
    assert.equal(bMid.snapshot.version, bVersionBefore, "房间 A 推进不能改变房间 B 版本");
    assert.deepEqual(bMid.snapshot.balls.map(ball => [ball.index, ball.active, ball.x, ball.z]),
      bBallsBefore.map(ball => [ball.index, ball.active, ball.x, ball.z]), "房间 A 推进不能改变房间 B 球位");
    await recordShot([roomA], 0);
    const aDone = await readNet(roomA);

    // 房间 B 随后推进时，房间 A 的权威状态也不得变化。
    const aVersionBefore = aDone.snapshot.version;
    const aBallsBefore = aDone.snapshot.balls;
    await aimClient(roomB);
    await shoot(roomB);
    await recordShot([roomB], 0);
    const bDone = await readNet(roomB);
    const aAfter = await readNet(roomA);
    assert.equal(aAfter.snapshot.version, aVersionBefore, "房间 B 推进不能改变房间 A 版本");
    assert.deepEqual(aAfter.snapshot.balls.map(ball => [ball.index, ball.active, ball.x, ball.z]),
      aBallsBefore.map(ball => [ball.index, ball.active, ball.x, ball.z]), "房间 B 推进不能改变房间 A 球位");
    results.push({ name: "two-rooms", aVersion: aAfter.snapshot.version, bVersion: bDone.snapshot.version,
      aMidVersion: aMid.snapshot.version });
    return { aDone: aAfter, bDone };
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function runStall(browser) {
  const server = await startServer();
  const pages = [];
  try {
    const [seat0, seat1] = await Promise.all([
      openClient(browser, server.info, "s-stall", 0, "stall-seat0"),
      openClient(browser, server.info, "s-stall", 1, "stall-seat1")
    ]);
    pages.push(seat0, seat1);
    await aimClient(seat0);
    await watchShot(seat0);
    await shootAcrossStall(seat0, 1100);
    await recordShot(pages, 0);
    const visual = await assertShotVisual(seat0);
    const final0 = await readNet(seat0);
    const final1 = await readNet(seat1);
    assertSnapshotsEqual(final0.snapshot, final1.snapshot, "长帧之后两端结算");
    results.push({ name: "late-animation-start", stallMs: 1100, visual, timing: final0.timing });
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}

async function main() {
  buildServer();
  const browser = await chromium.launch({
    executablePath: CHROME_BIN, headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  try {
    const logResult = () => console.log(`NET_SMOKE_STEP ${JSON.stringify(results[results.length - 1])}`);
    await runBaseline(browser); logResult();
    await runAlignment(browser); logResult();
    await runStall(browser); logResult();
    await runDropAck(browser); logResult();
    await runLatency(browser); logResult();
    await runTwoRooms(browser); logResult();
    console.log(`NET_SMOKE_RESULTS ${JSON.stringify(results)}`);
    console.log("Net smoke passed: two real browser clients, authoritative shot sync, camera ownership, drop-ack retry, one-way latency, two-room isolation");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("Net smoke failed:", error);
  process.exitCode = 1;
});
