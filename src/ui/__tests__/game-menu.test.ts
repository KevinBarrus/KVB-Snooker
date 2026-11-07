import { describe, expect, it, vi } from "vitest";
import {
  calcWinFrames,
  GameMenu,
  MATCH_FRAME_OPTIONS,
  PRESET_SHAPE_ITEMS,
  PROFILE_ITEMS
} from "../game-menu";

describe("ui game menu", () => {
  it("进入游戏默认居中展开主菜单，点击操作指南返回空且不切换面板", () => {
    const menu = new GameMenu();
    expect(menu.mainMenuOpen).toBe(true);
    expect(menu.inGameMenuOpen).toBe(false);
    expect(menu.activeTab).toBeNull();

    menu.selectTab("guide");
    expect(menu.activeTab).toBeNull();
    expect(menu.mainMenuOpen).toBe(true);
  });

  it("AI 对战：模式与难度必须同时选好才可点击开始比赛，进入对局并支持退出回上一级目录", () => {
    const pauseSpy = vi.fn();
    const menu = new GameMenu({ onPauseSignal: pauseSpy });
    menu.selectTab("ai");
    expect(menu.activeTab).toBe("ai");
    expect(menu.canStartAiMatch).toBe(false);
    expect(menu.startAiMatch()).toBeNull();

    menu.selectAiMode("snooker-900");
    expect(menu.canStartAiMatch).toBe(false);
    expect(menu.startAiMatch()).toBeNull();

    menu.selectAiDifficulty("HARD");
    expect(menu.canStartAiMatch).toBe(true);

    const req = menu.startAiMatch();
    expect(req).toEqual({
      kind: "ai",
      mode: "single-play",
      difficulty: "HARD",
      ruleset: "snooker-900",
      players: ["USER", "AI"]
    });
    expect(menu.mainMenuOpen).toBe(false);

    menu.openInGameMenu();
    expect(menu.inGameMenuOpen).toBe(true);
    expect(menu.getInGameActions().map(a => a.label)).toEqual([
      "暂停",
      "重新开始",
      "退出对局",
      "操作指南"
    ]);

    expect(menu.triggerInGameAction("pause")).toBeNull();
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(menu.inGameMenuOpen).toBe(true);

    expect(menu.triggerInGameAction("guide")).toBeNull();
    expect(menu.inGameMenuOpen).toBe(true);

    const restartReq = menu.triggerInGameAction("restart");
    expect(restartReq).toEqual(req);
    expect(menu.inGameMenuOpen).toBe(false);
    expect(menu.mainMenuOpen).toBe(false);

    menu.openInGameMenu();
    expect(menu.triggerInGameAction("exit")).toBeNull();
    expect(menu.mainMenuOpen).toBe(true);
    expect(menu.inGameMenuOpen).toBe(false);
    expect(menu.activeTab).toBe("ai");
  });

  it("双人对战 · 创建比赛：局数下拉框联动胜场框自动填充，生成比赛 ID 后弹出进入比赛", () => {
    expect(MATCH_FRAME_OPTIONS).toEqual([1, 3, 5, 7, 9, 11, 17, 19, 25, 33, 35]);
    expect(calcWinFrames(1)).toBe(1);
    expect(calcWinFrames(5)).toBe(3);
    expect(calcWinFrames(25)).toBe(13);
    expect(calcWinFrames(35)).toBe(18);

    const menu = new GameMenu();
    menu.selectTab("two-player");
    menu.selectTwoPlayerSub("create");
    expect(menu.canGenerateMatchId).toBe(false);
    expect(menu.generateMatchId()).toBe(false);
    expect(menu.matchIdPopupOpen).toBe(false);

    menu.selectCreateMode("classic");
    expect(menu.canGenerateMatchId).toBe(false);

    menu.selectCreateFrames(25);
    expect(menu.createWinFrames).toBe(13);
    expect(menu.canGenerateMatchId).toBe(true);

    expect(menu.generateMatchId()).toBe(true);
    expect(menu.matchIdPopupOpen).toBe(true);
    expect(menu.canEnterCreatedMatch).toBe(true);

    const req = menu.enterCreatedMatch();
    expect(req).toEqual({
      kind: "two-player",
      mode: "single-play",
      difficulty: "NORMAL",
      ruleset: "classic",
      players: ["USER", "USER"],
      totalFrames: 25,
      winFrames: 13
    });
    expect(menu.mainMenuOpen).toBe(false);
    expect(menu.matchIdPopupOpen).toBe(false);

    menu.openInGameMenu();
    expect(menu.getInGameActions().map(a => a.label)).toEqual([
      "退出对局",
      "操作指南",
      "重新开始"
    ]);
    menu.closeInGameMenu();
    expect(menu.inGameMenuOpen).toBe(false);

    menu.openInGameMenu();
    menu.triggerInGameAction("exit");
    expect(menu.mainMenuOpen).toBe(true);
    expect(menu.activeTab).toBe("two-player");
    expect(menu.twoPlayerSub).toBe("create");
  });

  it("双人对战 · 加入比赛：输入任意非空比赛 ID 即点亮进入比赛，走本地双人对局", () => {
    const menu = new GameMenu();
    menu.selectTab("two-player");
    menu.selectTwoPlayerSub("join");
    expect(menu.canEnterJoinedMatch).toBe(false);
    expect(menu.enterJoinedMatch()).toBeNull();

    menu.setJoinMatchId("ROOM-001");
    expect(menu.canEnterJoinedMatch).toBe(true);

    const req = menu.enterJoinedMatch();
    expect(req).toEqual({
      kind: "two-player",
      mode: "single-play",
      difficulty: "NORMAL",
      ruleset: "classic",
      players: ["USER", "USER"]
    });
    expect(menu.mainMenuOpen).toBe(false);

    menu.openInGameMenu();
    menu.triggerInGameAction("exit");
    expect(menu.mainMenuOpen).toBe(true);
    expect(menu.activeTab).toBe("two-player");
    expect(menu.twoPlayerSub).toBe("join");
  });

  it("练习 · 自由练习与球形练习：10 种预设球形可启动，我的球形展示列表框与未实现提示", () => {
    const menu = new GameMenu();
    menu.selectTab("practice");
    const freeReq = menu.startFreePractice();
    expect(freeReq).toEqual({
      kind: "practice",
      mode: "practice",
      difficulty: "NORMAL",
      ruleset: "classic"
    });
    expect(menu.mainMenuOpen).toBe(false);

    menu.openInGameMenu();
    expect(menu.getInGameActions().map(a => a.label)).toEqual([
      "暂停",
      "重新开始",
      "退出练习",
      "操作指南"
    ]);
    menu.triggerInGameAction("exit");
    expect(menu.mainMenuOpen).toBe(true);
    expect(menu.activeTab).toBe("practice");

    menu.openShapePractice();
    expect(menu.practiceSub).toBe("shapes");
    expect(PRESET_SHAPE_ITEMS.map(item => item.label)).toEqual([
      "经典蛇彩",
      "S球形",
      "T球形",
      "Y球形",
      "订书钉球形",
      "X球形",
      "金字塔散点",
      "双龙球形",
      "清彩练习",
      "五分点练习"
    ]);
    for (const shape of PRESET_SHAPE_ITEMS) {
      menu.openShapePractice();
      const req = menu.startShapePractice(shape.id);
      expect(req.shapeId).toBe(shape.id);
      expect(req.mode).toBe("practice");
      expect(menu.mainMenuOpen).toBe(false);
    }

    menu.openMyShapes();
    expect(menu.practiceSub).toBe("my-shapes");
    expect(menu.myShapesStatusText).toBe("当前还未创建球形");

    menu.clickCreateShape();
    expect(menu.myShapesStatusText).toBe("当前功能未实现");
  });

  it("我的：账号、技术统计、我的好友点击均返回空；支持中英文局数文案结构", () => {
    const menu = new GameMenu();
    menu.selectTab("profile");
    expect(PROFILE_ITEMS.map(i => i.label)).toEqual(["账号", "技术统计", "我的好友"]);
    for (const item of PROFILE_ITEMS) {
      menu.clickProfileItem(item.id);
      expect(menu.activeTab).toBe("profile");
    }

    expect(menu.frameRuleLabels).toEqual({ prefix: "", middle: "局", suffix: "胜" });
    menu.locale = "en";
    expect(menu.frameRuleLabels).toEqual({ prefix: "Best of", middle: "· First to", suffix: "" });
  });
});
