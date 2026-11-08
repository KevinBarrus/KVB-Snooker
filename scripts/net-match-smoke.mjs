import assert from "node:assert/strict";
import { aimClient, assertSnapshotsEqual, closePages, openClient, readNet, recordShot,
  resolveDecision, shoot, startServer, stopServer, waitFor } from "./net-smoke-lib.mjs";

export async function runMatch(browser) {
  const server = await startServer(["--best-of", "3", "--first-opening-player", "1", "--drop-next-ack"]);
  const pages = [];
  try {
    pages.push(...await Promise.all([0, 1].map(seat => openClient(browser, server.info, "match-three", seat, `match-${seat}`))));
    const initial = (await readNet(pages[0])).snapshot.match;
    assert.equal(initial.firstOpeningPlayer, 1);
    assert.equal(initial.bestOf, 3);
    for (const [index, loser] of [1, 0, 1].entries()) {
      const before = (await readNet(pages[0])).snapshot;
      assert.equal(before.match.frameNumber, index + 1);
      assert.equal(before.match.openingPlayer, index % 2 === 0 ? 1 : 0);
      if (index === 0) await aimClient(pages[1]);
      const page = pages[loser];
      await page.getByRole("button", { name: "认输本局", exact: true }).click();
      await page.getByRole("button", { name: "确认认输本局", exact: true }).click();
      await Promise.all(pages.map(p => waitFor(p, () => ["between-frames", "finished"].includes(window.__snkNet.snapshot().phase),
        10000, "本局结果")));
      const ended = await Promise.all(pages.map(readNet));
      assertSnapshotsEqual(ended[0].snapshot, ended[1].snapshot, "本局结束");
      assert.deepEqual(ended[0].snapshot.match, ended[1].snapshot.match);
      assert.equal(ended[0].snapshot.match.frames.length, index + 1);
      await Promise.all(pages.map(p => waitFor(p, () => window.__snkNet.cameraState === 0, 5000, "局间退出瞄准")));
      if (index === 2) break;
      if (index === 0) {
        await pages[0].getByRole("button", { name: "准备下一局", exact: true }).click();
        await pages[0].getByRole("button", { name: "已准备，等待对手", exact: true }).waitFor();
        assert.equal((await readNet(pages[0])).snapshot.match.frameNumber, index + 1);
        await pages[1].getByRole("button", { name: "准备下一局", exact: true }).click();
      } else {
        await Promise.all(pages.map(p => p.getByRole("button", { name: "准备下一局", exact: true }).click()));
      }
      await Promise.all(pages.map(p => p.waitForFunction(n => window.__snkNet.snapshot().match.frameNumber === n,
        index + 2, { timeout: 10000 })));
      const next = (await readNet(pages[0])).snapshot;
      assert.deepEqual(next.context.scores, [0, 0]);
      assert.equal(next.balls.filter(ball => ball.active).length, 22);
      assert.notEqual(next.match.attemptId, before.match.attemptId);
      if (index === 0) {
        await aimClient(pages[0]);
        await shoot(pages[0]);
        await recordShot(pages, 0);
        await resolveDecision(pages);
        const shot = (await readNet(pages[0])).snapshot.match;
        assert.equal(shot.shotCount, 1);
        assert.ok(shot.lastShotId.startsWith(shot.attemptId + "/shot-"));
      }
    }
    const final = (await readNet(pages[0])).snapshot.match;
    assert.deepEqual(final.frameWins, [2, 1]);
    assert.equal(final.result.winner, 0);
    assert.equal(final.result.resultId, initial.matchId + "/result");
    assert.equal(await pages[0].getByRole("button", { name: "准备下一局", exact: true }).isVisible(), false);
    await pages[0].screenshot({ path: ".cache/net/match-result.png" });
    return { name: "best-of-three", frames: final.frames.length, frameWins: final.frameWins,
      openers: final.frames.map(frame => frame.openingPlayer), resultId: final.result.resultId };
  } finally {
    await closePages(pages);
    await stopServer(server);
  }
}
