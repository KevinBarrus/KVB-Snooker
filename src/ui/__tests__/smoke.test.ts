import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/event-bus";
import { FOUL, getFoulDescription } from "../../core/rules/foul";
import { Hud } from "../hud";
import { CTRL_STATE } from "../shortcuts-bar";

const RED = 1;
const BLACK = 128;

function setup(players = [
  { pts: 0, penalty: 0, brk: 0 },
  { pts: 0, penalty: 0, brk: 0 }
]) {
  const bus = new EventBus();
  const hud = new Hud(() => players);
  hud.resetPlayers(["user", "ai-2"]);
  hud.attach(bus);
  return { bus, hud, players };
}

describe("ui smoke：EventBus → HUD 状态", () => {
  it("ball-on 指示只落在当前击球玩家组", () => {
    const { bus, hud } = setup();
    bus.emit("game/ball-on-changed", { ballOn: RED, inHand: 2 });
    expect(hud.scorePanel.groups[0].ballOn).toBe(RED);
    expect(hud.scorePanel.groups[1].ballOn).toBe(0);

    bus.emit("sim/shooting-start", { playerIndex: 1 });
    expect(hud.scorePanel.groups[0].ballOn).toBe(0);
    expect(hud.scorePanel.groups[1].ballOn).toBe(RED);
  });

  it("game/foul 弹出 FOUL 消息并按原作公式自动关闭", () => {
    const { bus, hud } = setup();
    bus.emit("game/ball-on-changed", { ballOn: RED, inHand: 0 });
    const foulCode = FOUL.MISS_TARGET;
    bus.emit("game/foul", { foulCode, description: getFoulDescription(foulCode), score: -4 });

    const notice = hud.foulNotice;
    expect(notice.active).toBe(true);
    expect(notice.head).toBe("FOUL");
    expect(notice.body).toBe("-4: MISS TARGET.");
    expect(notice.autoCloseTimer).toBeCloseTo(1 + 0.08 * (4 + 16));

    hud.update(2.5);
    expect(notice.active).toBe(true);
    hud.update(0.2);
    expect(notice.active).toBe(false);
  });

  it("终局 ballOn=0 时不弹 FOUL", () => {
    const { bus, hud } = setup();
    bus.emit("game/ball-on-changed", { ballOn: 0, inHand: 0 });
    bus.emit("game/foul", { foulCode: FOUL.POTTING_CUE_BALL, description: "POTTING THE CUE BALL.", score: -7 });
    expect(hud.foulNotice.active).toBe(false);
  });

  it("frame-events 同步记分：显示分 = 本人 pts − 对方 penalty", () => {
    const { bus, hud, players } = setup();
    players[0].pts = 12;
    players[0].brk = 12;
    players[1].penalty = -4;
    bus.emit("game/ball-on-changed", { ballOn: BLACK, inHand: 0 });
    bus.emit("game/frame-events", { potted: [7], respotted: [] });
    const [g0, g1] = hud.scorePanel.groups;
    expect(g0.pts).toBe(16);
    expect(g0.brk).toBe(12);
    expect(g1.pts).toBe(0);
    expect(g0.ballOn).toBe(BLACK);
  });

  it("单人模式隐藏右组", () => {
    const hud = new Hud(() => []);
    hud.resetPlayers(["user"]);
    expect(hud.scorePanel.playerCount).toBe(1);
    expect(hud.scorePanel.groups[0].head).toBe("USER");
    expect(hud.scorePanel.groups[1].visible).toBe(false);
  });

  it("ctrl 状态切换驱动快捷键条", () => {
    const { bus, hud } = setup();
    bus.emit("ctrl/state-change-start", { from: CTRL_STATE.STAND, to: CTRL_STATE.AIM });
    expect(hud.shortcutsBar.active).toBe(false);
    bus.emit("ctrl/state-change-end", { from: CTRL_STATE.STAND, to: CTRL_STATE.AIM });
    expect(hud.shortcutsBar.active).toBe(true);
    expect(hud.shortcutsBar.group).toBe(CTRL_STATE.AIM);
  });

  it("detach 后不再响应事件", () => {
    const { bus, hud } = setup();
    hud.detach();
    bus.emit("game/ball-on-changed", { ballOn: RED, inHand: 0 });
    expect(hud.scorePanel.ballOn).toBe(0);
  });
});
