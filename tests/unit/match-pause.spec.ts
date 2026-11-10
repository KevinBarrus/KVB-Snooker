import { describe, expect, it } from "vitest";
import { MatchPause, readPauseCheckpoint } from "../../src/core/match-pause.js";
import { GameSession, GAME_STATE } from "../../src/core/game.js";
import { Simulator } from "../../src/core/simulator/simulator.js";
import { makePocketTable } from "../fixtures/table.js";
import { makeStrokeVars } from "../../src/core/ai/stroke.js";

const policy = { players: 2, maxPerPlayer: 1, maxSeconds: 180, countdownSeconds: 3 };
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("暂停生命周期", () => {
  it("请求不停止比赛，对手接受后等安全边界；拒绝与取消不消费预算", () => {
    const pause = new MatchPause(policy);
    expect(pause.request(2)).toBe(false);
    expect(pause.request(0)).toBe(true);
    expect(pause.respond(0, true)).toBe(false);
    expect(pause.advance(5, true, false)).toBe(5);
    expect(pause.respond(1, false)).toBe(true);
    expect(pause.view.used).toEqual([0, 0]);
    pause.request(0);
    expect(pause.cancel(1)).toBe(false);
    expect(pause.cancel(0)).toBe(true);
    pause.request(1); pause.respond(0, true);
    expect(pause.advance(5, false, false)).toBe(5);
    expect(pause.advance(0, true, false)).toBe(0);
    expect(pause.view).toMatchObject({ phase: "paused", used: [0, 1], remainingSeconds: 180 });
  });

  it("双方准备后倒计时，恢复只消耗倒计时外的余量，不补时或重置预算", () => {
    const pause = new MatchPause(policy);
    pause.request(0); pause.respond(1, true); pause.advance(0, true, false);
    expect(pause.advance(30, true, false)).toBe(0);
    expect(pause.ready(0)).toBe(true);
    expect(pause.ready(0)).toBe(false);
    expect(pause.advance(1, true, false)).toBe(0);
    expect(pause.ready(1)).toBe(true);
    expect(pause.advance(2, true, false)).toBe(0);
    expect(pause.blocksPlay).toBe(true);
    expect(pause.advance(1.2, true, false)).toBeCloseTo(.2);
    expect(pause.blocksPlay).toBe(false);
    expect(pause.request(0)).toBe(false);
    expect(pause.request(1)).toBe(true);
    pause.resetFrame();
    expect(pause.view.used).toEqual([0, 0]);
  });

  it("到上限自动进入倒计时，经典无限暂停不自动解除", () => {
    const pause = new MatchPause(policy);
    pause.request(0); pause.respond(1, true);
    expect(pause.advance(182, true, false)).toBe(0);
    expect(pause.view).toMatchObject({ phase: "resuming", countdownSeconds: 1 });
    expect(pause.advance(5, true, false)).toBe(4);
    const unlimited = new MatchPause({ ...policy, players: 1, maxSeconds: null, maxPerPlayer: null });
    unlimited.request(0);
    expect(unlimited.advance(1e6, true, false)).toBe(0);
    expect(unlimited.view.phase).toBe("paused");
    unlimited.ready(0);
    expect(unlimited.advance(3, true, false)).toBe(0);
    expect(unlimited.view.phase).toBe("running");
  });

  it("终局先于接受生效，不撤销结果；掉线撤销未生效请求", () => {
    const pause = new MatchPause(policy);
    pause.request(0); pause.respond(1, true);
    expect(pause.advance(1, true, true)).toBe(1);
    expect(pause.view).toMatchObject({ phase: "running", used: [0, 0] });
    pause.request(0); pause.respond(1, true);
    expect(pause.disconnect(1)).toBe(true);
    expect(pause.view.phase).toBe("running");
  });

  it("JSON恢复暂停预算和剩余量，撤销旧准备，不接受损坏或不兼容策略", () => {
    const pause = new MatchPause(policy);
    pause.request(0); pause.respond(1, true); pause.advance(10, true, false); pause.ready(0);
    const saved = json(pause.exportCheckpoint());
    const next = new MatchPause(policy);
    next.restoreCheckpoint(saved);
    expect(next.view).toMatchObject({ phase: "paused", remainingSeconds: 170, ready: [false, false], used: [1, 0] });
    for (const bad of [null, { ...saved, format: 2 }, { ...saved, view: { ...saved.view, used: [-1, 0] } },
      { ...saved, view: { ...saved.view, remainingSeconds: NaN } }, { ...saved, policy: { ...policy, players: 1 } }]) {
      expect(() => next.restoreCheckpoint(bad)).toThrow();
    }
    expect(() => next.advance(-1, true, false)).toThrow();
    expect(() => next.advance(Infinity, true, false)).toThrow();
    expect(readPauseCheckpoint(saved)).toEqual(saved);
  });

  it("真实900：摆球/提名及分数保留，两表冻结，恢复之后原截止仍有效", () => {
    const game = new GameSession(new Simulator(makePocketTable()), "single-play", { ruleset: "snooker-900" });
    const pause = new MatchPause(policy);
    game.advanceTime(7);
    const saved = game.exportCheckpoint();
    pause.request(0); pause.respond(1, true);
    game.advanceTime(pause.advance(30, game.canPause, game.finished));
    expect(game.exportCheckpoint()).toEqual(saved);
    pause.ready(0); pause.ready(1);
    game.advanceTime(pause.advance(3, game.canPause, game.finished));
    expect(game.clock?.shotSeconds).toBe(13);
    game.advanceTime(pause.advance(13, game.canPause, game.finished));
    expect(game.result.foulCode).toBe(128);
    expect(game.getScore(1)).toBe(4);
  });

  it("900请求未同意期间仍超时计罚，晚接受保留罚分，终局优先", () => {
    const game = new GameSession(new Simulator(makePocketTable()), "single-play", { ruleset: "snooker-900" });
    const pause = new MatchPause(policy);
    pause.request(0);
    expect(game.advanceTime(pause.advance(20, game.canPause, game.finished))).toBe("shot");
    expect(game.getScore(1)).toBe(4);
    pause.respond(1, true);
    game.advanceTime(pause.advance(0, game.canPause, game.finished));
    expect(pause.blocksPlay).toBe(true);
    expect(game.getScore(1)).toBe(4);
    expect(game.clock).toMatchObject({ frameSeconds: 880, shotSeconds: 20 });
    const saved = game.exportCheckpoint();
    const final = GameSession.fromCheckpoint(new Simulator(makePocketTable()), { ...saved,
      nine: { ...saved.nine!, clock: { ...saved.nine!.clock, frameSeconds: 1 } } });
    const pending = new MatchPause(policy);
    pending.request(0);
    final.advanceTime(pending.advance(1, final.canPause, final.finished));
    pending.respond(1, true);
    pending.advance(0, final.canPause, final.finished);
    expect(final.finished).toBe(true);
    expect(pending.view.used).toEqual([0, 0]);
    expect(pending.blocksPlay).toBe(false);
  });

  it("已准备和运动中的真实出杆必须完成后暂停，不丢触球和判罚", () => {
    const game = new GameSession(new Simulator(makePocketTable()));
    const pause = new MatchPause(policy);
    const vars = makeStrokeVars(game.simulator, { dx: -1, dy: 0, dz: 0, fbSpin: 0, powerFactor: .1, priority: 1 });
    expect(game.prepareStroke(0, vars)).toBe(true);
    expect(game.canPause).toBe(false);
    pause.request(0); pause.respond(1, true);
    expect(pause.advance(.1, game.canPause, game.finished)).toBe(.1);
    expect(game.stroke(0, vars)).toBe(true);
    for (let i = 0; game.state === GAME_STATE.SIMULATING && i < 2000; i++) {
      game.step(pause.advance(.1, game.canPause, game.finished));
    }
    expect(game.canPause).toBe(true);
    expect(game.players[0].shootingCount).toBe(1);
    const settled = game.exportCheckpoint();
    game.step(pause.advance(0, game.canPause, game.finished));
    expect(pause.blocksPlay).toBe(true);
    expect(game.exportCheckpoint()).toEqual(settled);
  });
});
