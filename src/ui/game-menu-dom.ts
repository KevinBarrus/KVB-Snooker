import {
  GameMenu,
  MATCH_FRAME_OPTIONS,
  PRESET_SHAPE_ITEMS,
  PROFILE_ITEMS,
  type CueBallStyle,
  type MainMenuTab,
  type MatchFrameOption,
  type MatchLaunchRequest,
  type MenuDifficulty,
  type MenuRuleset,
  type PresetShapeId
} from "./game-menu";
import { MyShapesPanelDom, type MyShapesPort } from "./my-shapes-panel";
import { MenuIdentityDom } from "./menu-identity";

const MODE_CARDS: readonly { readonly id: MenuRuleset; readonly label: string }[] = [
  { id: "classic", label: "经典斯诺克" },
  { id: "snooker-900", label: "斯诺克 900" }
];

const DIFFICULTY_ITEMS: readonly { readonly id: MenuDifficulty; readonly label: string }[] = [
  { id: "EASY", label: "easy" },
  { id: "NORMAL", label: "normal" },
  { id: "HARD", label: "hard" }
];

export class GameMenuDom {
  readonly element: HTMLElement;
  private readonly mainWrap: HTMLElement;
  private readonly panelHost: HTMLElement;
  private readonly homePanel: HTMLElement;
  private readonly backBar: HTMLElement;

  private readonly aiPanel: HTMLElement;
  private readonly aiModeButtons = new Map<MenuRuleset, HTMLButtonElement>();
  private readonly aiDiffButtons = new Map<MenuDifficulty, HTMLButtonElement>();
  private readonly aiStartBtn: HTMLButtonElement;

  private readonly twoPlayerPanel: HTMLElement;
  private readonly tpCreateTabBtn: HTMLButtonElement;
  private readonly tpJoinTabBtn: HTMLButtonElement;
  private readonly tpCreateBox: HTMLElement;
  private readonly tpJoinBox: HTMLElement;
  private readonly createModeButtons = new Map<MenuRuleset, HTMLButtonElement>();
  private readonly framesSelect: HTMLSelectElement;
  private readonly winFramesBox: HTMLElement;
  private readonly framePrefixText: HTMLElement;
  private readonly frameMiddleText: HTMLElement;
  private readonly frameSuffixText: HTMLElement;
  private readonly generateIdBtn: HTMLButtonElement;
  private readonly joinIdInput: HTMLInputElement;
  private readonly joinEnterBtn: HTMLButtonElement;

  private readonly matchIdPopup: HTMLElement;
  private readonly matchIdValue: HTMLElement;
  private readonly copyIdBtn: HTMLButtonElement;
  private readonly createEnterBtn: HTMLButtonElement;

  private readonly practicePanel: HTMLElement;
  private readonly practiceEntryBox: HTMLElement;
  private readonly shapesGridBox: HTMLElement;
  private readonly myShapesListBox: HTMLElement;
  private readonly myShapesEmptyText: HTMLElement | null;
  private readonly myShapesPanel: MyShapesPanelDom | null;

  private readonly profilePanel: HTMLElement;
  private readonly identity: MenuIdentityDom;
  private readonly homeCards = new Map<Exclude<MainMenuTab, "guide">, HTMLButtonElement>();
  private readonly homeDetails = new Map<Exclude<MainMenuTab, "guide">, HTMLElement>();
  private readonly guideDialog: HTMLElement;

  private readonly inGameTriggerBtn: HTMLButtonElement;
  private readonly inGameModal: HTMLElement;
  private readonly inGameActionsBox: HTMLElement;
  private readonly shapeStyleDialog: HTMLElement;
  private readonly shapeStyleLabel: HTMLElement;
  private readonly exitDialog: HTMLElement;
  private pendingShape: { readonly id: PresetShapeId; readonly label: string } | null = null;
  private pendingExit: (() => void) | null = null;
  private inGameActionsKey = "";

  constructor(
    readonly state: GameMenu,
    private readonly onLaunchMatch: (request: MatchLaunchRequest) => void,
    private readonly doc: Document = document,
    private readonly myShapesPort?: MyShapesPort,
    private readonly onLogout?: () => void
  ) {
    this.element = doc.createElement("div");
    this.element.className = "game-menu-layer";

    this.mainWrap = doc.createElement("section");
    this.mainWrap.className = "game-menu-main";
    this.mainWrap.setAttribute("aria-label", "游戏主菜单");

    this.backBar = doc.createElement("div");
    this.backBar.className = "menu-back-bar";
    this.backBar.append(this.makeButton("menu-back-btn", "← 返回首页", () => {
      this.state.goHome();
      this.sync();
    }));

    this.panelHost = doc.createElement("div");
    this.panelHost.className = "menu-stage";
    this.homePanel = this.makeHomePanel();

    this.aiPanel = doc.createElement("div");
    this.aiPanel.className = "menu-subpanel";
    const aiModeBox = doc.createElement("div");
    aiModeBox.className = "menu-choice-box menu-card-grid-2";
    for (const item of MODE_CARDS) {
      const card = this.makeImageCard(item.label, `ai-mode-${item.id}`, () => {
        this.state.selectAiMode(item.id);
        this.sync();
      });
      this.aiModeButtons.set(item.id, card);
      aiModeBox.append(card);
    }
    const aiDiffBox = doc.createElement("div");
    aiDiffBox.className = "menu-choice-box menu-seg-row";
    for (const item of DIFFICULTY_ITEMS) {
      const btn = this.makeButton("menu-seg-btn", item.label, () => {
        this.state.selectAiDifficulty(item.id);
        this.sync();
      });
      this.aiDiffButtons.set(item.id, btn);
      aiDiffBox.append(btn);
    }
    this.aiStartBtn = this.makeButton("menu-cta-btn", "开始比赛", () => {
      const req = this.state.startAiMatch();
      this.sync();
      if (req) this.onLaunchMatch(req);
    });
    this.aiPanel.append(aiModeBox, aiDiffBox, this.aiStartBtn);

    this.twoPlayerPanel = doc.createElement("div");
    this.twoPlayerPanel.className = "menu-subpanel";
    const tpSubRow = doc.createElement("div");
    tpSubRow.className = "menu-choice-box menu-seg-row";
    this.tpCreateTabBtn = this.makeButton("menu-seg-btn", "创建比赛", () => {
      this.state.selectTwoPlayerSub("create");
      this.sync();
    });
    this.tpJoinTabBtn = this.makeButton("menu-seg-btn", "加入比赛", () => {
      this.state.selectTwoPlayerSub("join");
      this.sync();
    });
    tpSubRow.append(this.tpCreateTabBtn, this.tpJoinTabBtn);

    this.tpCreateBox = doc.createElement("div");
    this.tpCreateBox.className = "menu-stack";
    const tpModeBox = doc.createElement("div");
    tpModeBox.className = "menu-choice-box menu-card-grid-2";
    for (const item of MODE_CARDS) {
      const card = this.makeImageCard(item.label, `tp-mode-${item.id}`, () => {
        this.state.selectCreateMode(item.id);
        this.sync();
      });
      this.createModeButtons.set(item.id, card);
      tpModeBox.append(card);
    }

    const framesBox = doc.createElement("div");
    framesBox.className = "menu-choice-box menu-frames-row";
    this.framePrefixText = doc.createElement("span");
    this.framePrefixText.className = "menu-frames-label";
    this.framesSelect = doc.createElement("select");
    this.framesSelect.className = "menu-frames-select";
    this.framesSelect.setAttribute("aria-label", "选择总局数");
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择局数";
    this.framesSelect.append(placeholder);
    for (const count of MATCH_FRAME_OPTIONS) {
      const opt = doc.createElement("option");
      opt.value = String(count);
      opt.textContent = String(count);
      this.framesSelect.append(opt);
    }
    this.framesSelect.addEventListener("change", () => {
      const raw = Number(this.framesSelect.value);
      const valid = MATCH_FRAME_OPTIONS.find(item => item === raw) ?? null;
      this.state.selectCreateFrames(valid as MatchFrameOption | null);
      this.sync();
    });
    this.frameMiddleText = doc.createElement("span");
    this.frameMiddleText.className = "menu-frames-label";
    this.winFramesBox = doc.createElement("output");
    this.winFramesBox.className = "menu-win-frames-box";
    this.winFramesBox.setAttribute("aria-label", "获胜所需局数");
    this.frameSuffixText = doc.createElement("span");
    this.frameSuffixText.className = "menu-frames-label";
    framesBox.append(this.framePrefixText, this.framesSelect, this.frameMiddleText, this.winFramesBox, this.frameSuffixText);

    this.generateIdBtn = this.makeButton("menu-cta-btn", "生成比赛 ID", () => {
      this.state.generateMatchId();
      this.sync();
    });
    this.tpCreateBox.append(tpModeBox, framesBox, this.generateIdBtn);

    this.tpJoinBox = doc.createElement("div");
    this.tpJoinBox.className = "menu-stack";
    const joinInputWrap = doc.createElement("div");
    joinInputWrap.className = "menu-choice-box";
    this.joinIdInput = doc.createElement("input");
    this.joinIdInput.type = "text";
    this.joinIdInput.className = "menu-text-input";
    this.joinIdInput.placeholder = "输入比赛 ID";
    this.joinIdInput.setAttribute("aria-label", "输入比赛 ID");
    this.joinIdInput.addEventListener("input", () => {
      this.state.setJoinMatchId(this.joinIdInput.value);
      this.sync();
    });
    joinInputWrap.append(this.joinIdInput);
    this.joinEnterBtn = this.makeButton("menu-cta-btn", "进入比赛", () => {
      const req = this.state.enterJoinedMatch();
      this.sync();
      if (req) this.onLaunchMatch(req);
    });
    this.tpJoinBox.append(joinInputWrap, this.joinEnterBtn);
    this.twoPlayerPanel.append(tpSubRow, this.tpCreateBox, this.tpJoinBox);

    this.matchIdPopup = doc.createElement("section");
    this.matchIdPopup.className = "menu-match-id-popup";
    this.matchIdPopup.setAttribute("aria-label", "比赛 ID 与进入比赛");
    const idBox = doc.createElement("div");
    idBox.className = "menu-match-id-box";
    this.matchIdValue = doc.createElement("span");
    this.matchIdValue.className = "menu-match-id-text";
    this.copyIdBtn = this.makeButton("menu-inline-copy-btn", "复制", () => {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(this.state.generatedMatchId).catch(() => {});
      }
    });
    idBox.append(this.matchIdValue, this.copyIdBtn);
    this.createEnterBtn = this.makeButton("menu-cta-btn", "进入比赛", () => {
      const req = this.state.enterCreatedMatch();
      this.sync();
      if (req) this.onLaunchMatch(req);
    });
    this.matchIdPopup.append(idBox, this.createEnterBtn);

    this.practicePanel = doc.createElement("div");
    this.practicePanel.className = "menu-subpanel";
    this.practiceEntryBox = doc.createElement("div");
    this.practiceEntryBox.className = "menu-choice-box menu-seg-row";
    const freeBtn = this.makeButton("menu-seg-btn", "自由练习", () => {
      const req = this.state.startFreePractice();
      this.sync();
      this.onLaunchMatch(req);
    });
    const shapeBtn = this.makeButton("menu-seg-btn", "球形练习", () => {
      this.state.openShapePractice();
      this.sync();
    });
    this.practiceEntryBox.append(freeBtn, shapeBtn);

    this.shapesGridBox = doc.createElement("div");
    this.shapesGridBox.className = "menu-shapes-grid";
    for (const shape of PRESET_SHAPE_ITEMS) {
      const card = this.makeImageCard(shape.label, `shape-${shape.id}`, () => {
        this.openShapeStyleDialog(shape.id, shape.label);
      });
      this.shapesGridBox.append(card);
    }
    const myShapesBtn = this.makeButton("menu-seg-btn menu-my-shapes-entry", "我的球形", () => {
      this.state.openMyShapes();
      this.myShapesPanel?.showMine();
      this.sync();
    });
    this.shapesGridBox.append(myShapesBtn);

    this.myShapesListBox = doc.createElement("div");
    this.myShapesListBox.className = "menu-list-box";
    if (this.myShapesPort) {
      this.myShapesPanel = new MyShapesPanelDom(this.myShapesPort, doc);
      this.myShapesListBox.append(this.myShapesPanel.element);
      this.myShapesEmptyText = null;
    } else {
      this.myShapesPanel = null;
      const createRowBtn = this.makeButton("menu-list-top-action", "创建球形", () => {
        this.state.clickCreateShape();
        this.sync();
      });
      this.myShapesEmptyText = doc.createElement("div");
      this.myShapesEmptyText.className = "menu-list-empty";
      this.myShapesEmptyText.setAttribute("role", "status");
      this.myShapesListBox.append(createRowBtn, this.myShapesEmptyText);
    }
    this.practicePanel.append(this.practiceEntryBox, this.shapesGridBox, this.myShapesListBox);

    this.profilePanel = doc.createElement("div");
    this.profilePanel.className = "menu-subpanel";
    const profileBox = doc.createElement("div");
    profileBox.className = "menu-choice-box menu-seg-row";
    for (const item of PROFILE_ITEMS) {
      profileBox.append(
        this.makeButton("menu-seg-btn", item.label, () => {
          this.state.clickProfileItem(item.id);
          this.sync();
        })
      );
    }
    this.identity = new MenuIdentityDom(doc, onLogout);
    profileBox.prepend(this.identity.account);
    this.profilePanel.append(profileBox);

    this.panelHost.append(this.homePanel, this.aiPanel, this.twoPlayerPanel, this.practicePanel, this.profilePanel);
    this.mainWrap.append(this.backBar, this.panelHost);

    this.inGameTriggerBtn = this.makeButton("ingame-menu-trigger", "菜单", () => {
      this.state.openInGameMenu();
      this.sync();
    });

    this.inGameModal = doc.createElement("section");
    this.inGameModal.className = "ingame-menu-modal";
    this.inGameModal.setAttribute("aria-label", "对局菜单");
    const closeBtn = this.makeButton("ingame-menu-close", "×", () => {
      this.state.closeInGameMenu();
      this.sync();
    });
    closeBtn.setAttribute("aria-label", "关闭菜单");
    this.inGameActionsBox = doc.createElement("div");
    this.inGameActionsBox.className = "ingame-menu-actions";
    this.inGameModal.append(closeBtn, this.inGameActionsBox);

    this.shapeStyleDialog = doc.createElement("section");
    this.shapeStyleDialog.className = "menu-choice-dialog";
    this.shapeStyleDialog.setAttribute("aria-label", "选择母球样式");
    this.shapeStyleDialog.hidden = true;
    const styleTitle = doc.createElement("strong");
    styleTitle.textContent = "选择母球样式";
    this.shapeStyleLabel = doc.createElement("p");
    this.shapeStyleLabel.className = "menu-choice-message";
    const classicBtn = this.makeButton("menu-seg-btn", "经典母球", () => this.finishShapeStyle("classic"));
    const redDotBtn = this.makeButton("menu-seg-btn", "红点母球", () => this.finishShapeStyle("red-dot"));
    const styleCancel = this.makeButton("menu-seg-btn", "取消", () => this.closeShapeStyleDialog());
    this.shapeStyleDialog.append(styleTitle, this.shapeStyleLabel, classicBtn, redDotBtn, styleCancel);

    this.exitDialog = doc.createElement("section");
    this.exitDialog.className = "menu-choice-dialog";
    this.exitDialog.setAttribute("aria-label", "确认退出练习");
    this.exitDialog.hidden = true;
    const exitTitle = doc.createElement("strong");
    exitTitle.textContent = "确认退出练习";
    const exitMessage = doc.createElement("p");
    exitMessage.className = "menu-choice-message";
    exitMessage.textContent = "当前练习进度不会保留。";
    const exitConfirm = this.makeButton("menu-seg-btn", "确认退出", () => this.finishExit(true));
    const exitCancel = this.makeButton("menu-seg-btn", "取消", () => this.finishExit(false));
    this.exitDialog.append(exitTitle, exitMessage, exitConfirm, exitCancel);

    this.guideDialog = doc.createElement("section");
    this.guideDialog.className = "guide-dialog";
    this.guideDialog.setAttribute("aria-label", "操作指南");
    this.guideDialog.hidden = true;
    const guideClose = this.makeButton("guide-dialog-close", "×", () => { this.guideDialog.hidden = true; });
    guideClose.setAttribute("aria-label", "关闭操作指南");
    this.guideDialog.append(guideClose, this.makeGuideContent("guide-dialog-content"));

    this.element.append(this.mainWrap, this.matchIdPopup, this.shapeStyleDialog, this.exitDialog,
      this.guideDialog, this.inGameTriggerBtn, this.inGameModal, this.identity.chip);
    this.sync();
  }

  private openShapeStyleDialog(id: PresetShapeId, label: string): void {
    this.pendingShape = { id, label };
    this.shapeStyleLabel.textContent = `${label} · 选择母球样式`;
    this.shapeStyleDialog.hidden = false;
  }

  private closeShapeStyleDialog(): void {
    this.pendingShape = null;
    this.shapeStyleDialog.hidden = true;
  }

  private finishShapeStyle(style: CueBallStyle): void {
    const pending = this.pendingShape;
    if (!pending) return;
    this.pendingShape = null;
    this.shapeStyleDialog.hidden = true;
    const req = this.state.startShapePractice(pending.id, style);
    this.sync();
    this.onLaunchMatch(req);
  }

  private openExitDialog(proceed: () => void): void {
    this.pendingExit = proceed;
    this.exitDialog.hidden = false;
  }

  private finishExit(confirm: boolean): void {
    const proceed = this.pendingExit;
    this.pendingExit = null;
    this.exitDialog.hidden = true;
    if (confirm && proceed) proceed();
  }

  private makeHomePanel(): HTMLElement {
    const panel = this.doc.createElement("div");
    panel.className = "menu-home";
    const eyebrow = this.doc.createElement("span");
    eyebrow.className = "menu-home-eyebrow";
    eyebrow.textContent = "KVB · SNOOKER";
    const title = this.doc.createElement("h1");
    title.className = "menu-home-title";
    title.textContent = "斯诺克";
    const subtitle = this.doc.createElement("p");
    subtitle.className = "menu-home-subtitle";
    subtitle.textContent = "经典对局、练习球形与自建球形";
    const cards = this.doc.createElement("div");
    cards.className = "menu-home-cards";
    const items: readonly { id: Exclude<MainMenuTab, "guide">; title: string; detail: string }[] = [
      { id: "ai", title: "AI 对战", detail: "选择规则与难度，挑战电脑" },
      { id: "two-player", title: "双人对战", detail: "创建或加入一场对局" },
      { id: "practice", title: "练习", detail: "自由练习、预设球形与我的球形" },
      { id: "profile", title: "我的", detail: "账号、统计与好友" }
    ];
    for (const item of items) {
      const card = this.doc.createElement("button");
      card.type = "button";
      card.className = `home-card home-card-${item.id}`;
      card.setAttribute("aria-label", item.title);
      const name = this.doc.createElement("strong");
      name.textContent = item.title;
      const detail = this.doc.createElement("span");
      detail.textContent = item.detail;
      card.append(name, detail);
      this.homeCards.set(item.id, card);
      this.homeDetails.set(item.id, detail);
      card.addEventListener("click", () => { this.state.selectTab(item.id); this.sync(); });
      cards.append(card);
    }
    const guide = this.makeButton("home-guide-btn", "操作指南", () => this.openGuide());
    const footer = this.doc.createElement("div");
    footer.className = "menu-home-footer";
    footer.append(guide, this.doc.createTextNode("  ·  v0.1 个人项目"));
    panel.append(eyebrow, title, subtitle, cards, footer);
    return panel;
  }

  private openGuide(): void {
    this.guideDialog.hidden = false;
    this.guideDialog.querySelector<HTMLButtonElement>(".guide-dialog-close")?.focus();
  }

  private makeGuideContent(className: string): HTMLElement {
    const panel = this.doc.createElement("div");
    panel.className = className;
    const title = this.doc.createElement("h2");
    title.textContent = "操作指南";
    panel.append(title);
    const sections: readonly { title: string; items: readonly [string, string][] }[] = [
      { title: "瞄准与击球", items: [
        ["W / ↑", "进入瞄准"], ["S / ↓", "起身"], ["Space", "击球"],
        ["鼠标拖动", "观察或微调方向"], ["A / D 或 ← / →", "环绕镜头"],
        ["X", "蹲下观察"], ["R", "回到主视角"], ["V", "切换观察视角"]
      ] },
      { title: "力度、旋转与摆球", items: [
        ["滚轮", "调整力度"], ["Alt / Cmd + 拖动", "添加或调整加塞"], ["Alt / Cmd + 滚轮", "调整杆头高度"],
        ["C", "清除加塞"], ["P", "打开或关闭摆球"], ["Esc", "结束摆球"]
      ] },
      { title: "练习与球形", items: [
        ["自由练习", "任意练习基础击球与走位"], ["预设球形", "十种固定训练球形"],
        ["我的球形", "创建、编辑、回收和开始自建球形"], ["复位 / 重摆", "回滚上一杆或恢复初始布局"]
      ] }
    ];
    for (const section of sections) {
      const block = this.doc.createElement("section");
      block.className = "guide-section";
      const heading = this.doc.createElement("h3");
      heading.textContent = section.title;
      const list = this.doc.createElement("dl");
      list.className = "guide-keys";
      for (const [key, text] of section.items) {
        const dt = this.doc.createElement("dt");
        dt.textContent = key;
        const dd = this.doc.createElement("dd");
        dd.textContent = text;
        list.append(dt, dd);
      }
      block.append(heading, list);
      panel.append(block);
    }
    return panel;
  }

  private makeButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = this.doc.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private makeImageCard(label: string, slotId: string, onClick: () => void): HTMLButtonElement {
    const btn = this.doc.createElement("button");
    btn.type = "button";
    btn.className = "menu-image-card";
    const media = this.doc.createElement("span");
    media.className = "menu-image-slot";
    media.dataset.imageSlot = slotId;
    const title = this.doc.createElement("span");
    title.className = "menu-image-title";
    title.textContent = label;
    btn.append(media, title);
    btn.addEventListener("click", onClick);
    return btn;
  }

  sync(): void {
    const s = this.state;
    this.mainWrap.hidden = !s.mainMenuOpen;
    this.identity.sync(s.viewer, s.mainMenuOpen);
    for (const [id, card] of this.homeCards) {
      const disabled = id === "two-player" && !s.onlineEnabled;
      card.disabled = disabled;
      card.setAttribute("aria-disabled", String(disabled));
      const detail = this.homeDetails.get(id);
      if (id === "two-player" && detail) detail.textContent = disabled ? "内测暂未开放" : "创建或加入一场对局";
    }

    this.aiPanel.hidden = s.activeTab !== "ai";
    for (const [id, btn] of this.aiModeButtons) {
      btn.setAttribute("aria-pressed", String(s.aiMode === id));
    }
    for (const [id, btn] of this.aiDiffButtons) {
      btn.setAttribute("aria-pressed", String(s.aiDifficulty === id));
    }
    this.aiStartBtn.disabled = !s.canStartAiMatch;

    this.twoPlayerPanel.hidden = s.activeTab !== "two-player";
    this.tpCreateTabBtn.disabled = !s.onlineEnabled;
    this.tpJoinTabBtn.disabled = !s.onlineEnabled;
    this.tpCreateTabBtn.setAttribute("aria-pressed", String(s.twoPlayerSub === "create"));
    this.tpJoinTabBtn.setAttribute("aria-pressed", String(s.twoPlayerSub === "join"));
    this.tpCreateBox.hidden = s.twoPlayerSub !== "create";
    this.tpJoinBox.hidden = s.twoPlayerSub !== "join";

    for (const [id, btn] of this.createModeButtons) {
      btn.setAttribute("aria-pressed", String(s.createMode === id));
    }
    const labels = s.frameRuleLabels;
    this.framePrefixText.textContent = labels.prefix;
    this.framePrefixText.hidden = !labels.prefix;
    this.frameMiddleText.textContent = labels.middle;
    this.frameSuffixText.textContent = labels.suffix;
    this.frameSuffixText.hidden = !labels.suffix;
    this.framesSelect.value = s.createTotalFrames === null ? "" : String(s.createTotalFrames);
    this.winFramesBox.textContent = s.createWinFrames === null ? "" : String(s.createWinFrames);
    this.generateIdBtn.disabled = !s.onlineEnabled || !s.canGenerateMatchId;

    this.joinIdInput.disabled = !s.onlineEnabled;
    if (this.joinIdInput.value !== s.joinMatchId) {
      this.joinIdInput.value = s.joinMatchId;
    }
    this.joinEnterBtn.disabled = !s.onlineEnabled || !s.canEnterJoinedMatch;

    this.matchIdPopup.hidden = !(s.mainMenuOpen && s.activeTab === "two-player" && s.twoPlayerSub === "create" && s.matchIdPopupOpen);
    this.matchIdValue.textContent = s.generatedMatchId;
    this.createEnterBtn.disabled = !s.onlineEnabled;

    this.practicePanel.hidden = s.activeTab !== "practice";
    this.practiceEntryBox.hidden = s.practiceSub !== null;
    this.shapesGridBox.hidden = s.practiceSub !== "shapes";
    this.myShapesListBox.hidden = s.practiceSub !== "my-shapes";
    if (this.myShapesPanel && !this.myShapesListBox.hidden) this.myShapesPanel.sync();
    if (this.myShapesEmptyText) this.myShapesEmptyText.textContent = s.myShapesStatusText;

    this.homePanel.hidden = s.activeTab !== null;
    this.backBar.hidden = s.activeTab === null;
    this.mainWrap.classList.toggle("menu-home-mode", s.activeTab === null);
    this.profilePanel.hidden = s.activeTab !== "profile";

    this.inGameTriggerBtn.hidden = s.mainMenuOpen;
    this.inGameModal.hidden = s.mainMenuOpen || !s.inGameMenuOpen;

    if (!this.inGameModal.hidden) {
      const actions = s.getInGameActions();
      const key = actions.map(a => `${a.id}:${a.label}`).join("|");
      if (key !== this.inGameActionsKey) {
        this.inGameActionsKey = key;
        this.inGameActionsBox.replaceChildren();
        for (const item of actions) {
          this.inGameActionsBox.append(
            this.makeButton("ingame-action-btn", item.label, () => {
              if (item.id === "guide") { this.openGuide(); return; }
              const run = (): void => {
                const req = this.state.triggerInGameAction(item.id);
                this.sync();
                if (req) this.onLaunchMatch(req);
              };
              if (item.id === "exit" && this.state.activeMatch?.kind === "practice") this.openExitDialog(run);
              else run();
            })
          );
        }
      }
    }
  }

  dispose(): void {
    this.myShapesPanel?.dispose();
    this.element.remove();
  }
}
