import {
  GameMenu,
  MATCH_FRAME_OPTIONS,
  PRESET_SHAPE_ITEMS,
  PROFILE_ITEMS,
  type MainMenuTab,
  type MatchFrameOption,
  type MatchLaunchRequest,
  type MenuDifficulty,
  type MenuRuleset
} from "./game-menu";

const MAIN_TABS: readonly { readonly id: MainMenuTab; readonly label: string }[] = [
  { id: "ai", label: "AI 对战" },
  { id: "two-player", label: "双人对战" },
  { id: "practice", label: "练习" },
  { id: "profile", label: "我的" },
  { id: "guide", label: "操作指南" }
];

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
  private readonly tabButtons = new Map<MainMenuTab, HTMLButtonElement>();
  private readonly panelHost: HTMLElement;

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
  private readonly myShapesEmptyText: HTMLElement;

  private readonly profilePanel: HTMLElement;

  private readonly inGameTriggerBtn: HTMLButtonElement;
  private readonly inGameModal: HTMLElement;
  private readonly inGameActionsBox: HTMLElement;
  private inGameActionsKey = "";

  constructor(
    readonly state: GameMenu,
    private readonly onLaunchMatch: (request: MatchLaunchRequest) => void,
    private readonly doc: Document = document
  ) {
    this.element = doc.createElement("div");
    this.element.className = "game-menu-layer";

    this.mainWrap = doc.createElement("section");
    this.mainWrap.className = "game-menu-main";
    this.mainWrap.setAttribute("aria-label", "游戏主菜单");

    const nav = doc.createElement("nav");
    nav.className = "menu-top-nav";
    for (const item of MAIN_TABS) {
      const btn = this.makeButton("menu-nav-btn", item.label, () => {
        this.state.selectTab(item.id);
        this.sync();
      });
      this.tabButtons.set(item.id, btn);
      nav.append(btn);
    }

    this.panelHost = doc.createElement("div");
    this.panelHost.className = "menu-stage";

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
        this.state.clickPresetShape(shape.id);
        this.sync();
      });
      this.shapesGridBox.append(card);
    }
    const myShapesBtn = this.makeButton("menu-seg-btn menu-my-shapes-entry", "我的球形", () => {
      this.state.openMyShapes();
      this.sync();
    });
    this.shapesGridBox.append(myShapesBtn);

    this.myShapesListBox = doc.createElement("div");
    this.myShapesListBox.className = "menu-list-box";
    const createRowBtn = this.makeButton("menu-list-top-action", "创建球形", () => {
      this.state.clickCreateShape();
      this.sync();
    });
    this.myShapesEmptyText = doc.createElement("div");
    this.myShapesEmptyText.className = "menu-list-empty";
    this.myShapesEmptyText.setAttribute("role", "status");
    this.myShapesListBox.append(createRowBtn, this.myShapesEmptyText);
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
    this.profilePanel.append(profileBox);

    this.panelHost.append(this.aiPanel, this.twoPlayerPanel, this.practicePanel, this.profilePanel);
    this.mainWrap.append(nav, this.panelHost);

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

    this.element.append(this.mainWrap, this.matchIdPopup, this.inGameTriggerBtn, this.inGameModal);
    this.sync();
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
    this.panelHost.hidden = s.activeTab === null;

    for (const [id, btn] of this.tabButtons) {
      btn.setAttribute("aria-pressed", String(s.activeTab === id));
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
    this.generateIdBtn.disabled = !s.canGenerateMatchId;

    if (this.joinIdInput.value !== s.joinMatchId) {
      this.joinIdInput.value = s.joinMatchId;
    }
    this.joinEnterBtn.disabled = !s.canEnterJoinedMatch;

    this.matchIdPopup.hidden = !(s.mainMenuOpen && s.activeTab === "two-player" && s.twoPlayerSub === "create" && s.matchIdPopupOpen);
    this.matchIdValue.textContent = s.generatedMatchId;
    this.createEnterBtn.disabled = false;

    this.practicePanel.hidden = s.activeTab !== "practice";
    this.practiceEntryBox.hidden = s.practiceSub !== null;
    this.shapesGridBox.hidden = s.practiceSub !== "shapes";
    this.myShapesListBox.hidden = s.practiceSub !== "my-shapes";
    this.myShapesEmptyText.textContent = s.myShapesStatusText;

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
              const req = this.state.triggerInGameAction(item.id);
              this.sync();
              if (req) this.onLaunchMatch(req);
            })
          );
        }
      }
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
