export type MainMenuTab = "ai" | "two-player" | "practice" | "profile" | "guide";
export type MenuRuleset = "classic" | "snooker-900";
export type MenuDifficulty = "EASY" | "NORMAL" | "HARD";
export type TwoPlayerSubTab = "create" | "join";
export type PracticeSubTab = "shapes" | "my-shapes";
export type InGameActionId = "pause" | "restart" | "exit" | "guide";
export type MenuLocale = "zh" | "en";
export type CueBallStyle = "classic" | "red-dot";

export const MATCH_FRAME_OPTIONS = [1, 3, 5, 7, 9, 11, 17, 19, 25, 33, 35] as const;
export type MatchFrameOption = (typeof MATCH_FRAME_OPTIONS)[number];

export const PRESET_SHAPE_ITEMS = [
  { id: "snake", label: "经典蛇彩" },
  { id: "s-shape", label: "S球形" },
  { id: "t-shape", label: "T球形" },
  { id: "y-shape", label: "Y球形" },
  { id: "staple", label: "订书钉球形" },
  { id: "x-shape", label: "X球形" },
  { id: "pyramid", label: "金字塔散点" },
  { id: "double-dragon", label: "双龙球形" },
  { id: "clearance", label: "清彩练习" },
  { id: "five-spots", label: "五分点练习" }
] as const;
export type PresetShapeId = (typeof PRESET_SHAPE_ITEMS)[number]["id"];

export const PROFILE_ITEMS = [
  { id: "account", label: "账号" },
  { id: "stats", label: "技术统计" },
  { id: "friends", label: "我的好友" }
] as const;
export type ProfileItemId = (typeof PROFILE_ITEMS)[number]["id"];

export interface MatchLaunchRequest {
  readonly kind: "ai" | "two-player" | "practice";
  readonly mode: "single-play" | "practice";
  readonly difficulty: MenuDifficulty;
  readonly ruleset: MenuRuleset;
  readonly players?: readonly ["USER", "AI"] | readonly ["USER", "USER"];
  readonly totalFrames?: MatchFrameOption;
  readonly winFrames?: number;
  /** 球形练习：菜单选中的预设球形；自由练习与正式对局不携带。 */
  readonly shapeId?: PresetShapeId;
  /** 球形练习的母球外观；正式对局由规则决定。 */
  readonly cueBallStyle?: CueBallStyle;
}

export interface InGameActionItem {
  readonly id: InGameActionId;
  readonly label: string;
}

interface ReturnDirectory {
  readonly tab: Exclude<MainMenuTab, "guide">;
  readonly twoPlayerSub: TwoPlayerSubTab | null;
  readonly practiceSub: PracticeSubTab | null;
}

export function calcWinFrames(totalFrames: number): number {
  return Math.floor(totalFrames / 2) + 1;
}

export class GameMenu {
  locale: MenuLocale = "zh";
  mainMenuOpen = true;
  inGameMenuOpen = false;
  activeTab: Exclude<MainMenuTab, "guide"> | null = null;

  aiMode: MenuRuleset | null = null;
  aiDifficulty: MenuDifficulty | null = null;

  twoPlayerSub: TwoPlayerSubTab | null = null;
  createMode: MenuRuleset | null = null;
  createTotalFrames: MatchFrameOption | null = null;
  matchIdPopupOpen = false;
  generatedMatchId = "";
  joinMatchId = "";

  practiceSub: PracticeSubTab | null = null;
  createShapeClicked = false;

  activeMatch: MatchLaunchRequest | null = null;
  private returnDir: ReturnDirectory = { tab: "ai", twoPlayerSub: null, practiceSub: null };
  private readonly onPauseSignal?: () => void;

  constructor(options: { onPauseSignal?: () => void; locale?: MenuLocale } = {}) {
    this.onPauseSignal = options.onPauseSignal;
    if (options.locale) this.locale = options.locale;
  }

  get canStartAiMatch(): boolean {
    return this.aiMode !== null && this.aiDifficulty !== null;
  }

  get createWinFrames(): number | null {
    return this.createTotalFrames === null ? null : calcWinFrames(this.createTotalFrames);
  }

  get canGenerateMatchId(): boolean {
    return this.createMode !== null && this.createTotalFrames !== null;
  }

  get canEnterCreatedMatch(): boolean {
    return this.matchIdPopupOpen && this.createMode !== null && this.createTotalFrames !== null;
  }

  get canEnterJoinedMatch(): boolean {
    return this.joinMatchId.length > 0;
  }

  get myShapesStatusText(): string {
    return this.createShapeClicked ? "当前功能未实现" : "当前还未创建球形";
  }

  get frameRuleLabels(): { readonly prefix: string; readonly middle: string; readonly suffix: string } {
    return this.locale === "en"
      ? { prefix: "Best of", middle: "· First to", suffix: "" }
      : { prefix: "", middle: "局", suffix: "胜" };
  }

  selectTab(tab: MainMenuTab): void {
    if (tab === "guide") return;
    this.activeTab = tab;
    if (tab !== "two-player") {
      this.matchIdPopupOpen = false;
    }
    if (tab === "practice") {
      this.practiceSub = null;
      this.createShapeClicked = false;
    }
  }

  selectAiMode(mode: MenuRuleset): void {
    this.aiMode = mode;
  }

  selectAiDifficulty(difficulty: MenuDifficulty): void {
    this.aiDifficulty = difficulty;
  }

  startAiMatch(): MatchLaunchRequest | null {
    if (!this.canStartAiMatch || !this.aiMode || !this.aiDifficulty) return null;
    const request: MatchLaunchRequest = {
      kind: "ai",
      mode: "single-play",
      difficulty: this.aiDifficulty,
      ruleset: this.aiMode,
      players: ["USER", "AI"]
    };
    this.returnDir = { tab: "ai", twoPlayerSub: null, practiceSub: null };
    this.enterMatchState(request);
    return request;
  }

  selectTwoPlayerSub(sub: TwoPlayerSubTab): void {
    this.twoPlayerSub = sub;
    if (sub !== "create") this.matchIdPopupOpen = false;
  }

  selectCreateMode(mode: MenuRuleset): void {
    this.createMode = mode;
    this.matchIdPopupOpen = false;
  }

  selectCreateFrames(frames: MatchFrameOption | null): void {
    this.createTotalFrames = frames;
    this.matchIdPopupOpen = false;
  }

  generateMatchId(): boolean {
    if (!this.canGenerateMatchId) return false;
    this.matchIdPopupOpen = true;
    return true;
  }

  setGeneratedMatchId(id: string): void {
    this.generatedMatchId = id;
  }

  enterCreatedMatch(): MatchLaunchRequest | null {
    if (!this.canEnterCreatedMatch || !this.createMode || !this.createTotalFrames) return null;
    const request: MatchLaunchRequest = {
      kind: "two-player",
      mode: "single-play",
      difficulty: "NORMAL",
      ruleset: this.createMode,
      players: ["USER", "USER"],
      totalFrames: this.createTotalFrames,
      winFrames: calcWinFrames(this.createTotalFrames)
    };
    this.returnDir = { tab: "two-player", twoPlayerSub: "create", practiceSub: null };
    this.enterMatchState(request);
    return request;
  }

  setJoinMatchId(value: string): void {
    this.joinMatchId = value;
  }

  enterJoinedMatch(): MatchLaunchRequest | null {
    if (!this.canEnterJoinedMatch) return null;
    const request: MatchLaunchRequest = {
      kind: "two-player",
      mode: "single-play",
      difficulty: "NORMAL",
      ruleset: "classic",
      players: ["USER", "USER"]
    };
    this.returnDir = { tab: "two-player", twoPlayerSub: "join", practiceSub: null };
    this.enterMatchState(request);
    return request;
  }

  startFreePractice(): MatchLaunchRequest {
    const request: MatchLaunchRequest = {
      kind: "practice",
      mode: "practice",
      difficulty: "NORMAL",
      ruleset: "classic"
    };
    this.returnDir = { tab: "practice", twoPlayerSub: null, practiceSub: null };
    this.enterMatchState(request);
    return request;
  }

  openShapePractice(): void {
    this.practiceSub = "shapes";
    this.createShapeClicked = false;
  }

  startShapePractice(shapeId: PresetShapeId, cueBallStyle: CueBallStyle = "classic"): MatchLaunchRequest {
    const request: MatchLaunchRequest = {
      kind: "practice",
      mode: "practice",
      difficulty: "NORMAL",
      ruleset: "classic",
      shapeId,
      cueBallStyle
    };
    this.returnDir = { tab: "practice", twoPlayerSub: null, practiceSub: "shapes" };
    this.enterMatchState(request);
    return request;
  }

  openMyShapes(): void {
    this.practiceSub = "my-shapes";
    this.createShapeClicked = false;
  }

  clickCreateShape(): void {
    this.createShapeClicked = true;
  }

  clickProfileItem(_itemId: ProfileItemId): void {
    return;
  }

  clickGuide(): void {
    return;
  }

  openInGameMenu(): void {
    if (this.mainMenuOpen) return;
    this.inGameMenuOpen = true;
  }

  closeInGameMenu(): void {
    this.inGameMenuOpen = false;
  }

  getInGameActions(): readonly InGameActionItem[] {
    const kind = this.activeMatch?.kind ?? "practice";
    if (kind === "two-player") {
      return [
        { id: "exit", label: "退出对局" },
        { id: "guide", label: "操作指南" },
        { id: "restart", label: "重新开始" }
      ];
    }
    if (kind === "ai") {
      return [
        { id: "pause", label: "暂停" },
        { id: "restart", label: "重新开始" },
        { id: "exit", label: "退出对局" },
        { id: "guide", label: "操作指南" }
      ];
    }
    return [
      { id: "pause", label: "暂停" },
      { id: "restart", label: "重新开始" },
      { id: "exit", label: "退出练习" },
      { id: "guide", label: "操作指南" }
    ];
  }

  triggerInGameAction(action: InGameActionId): MatchLaunchRequest | null {
    if (action === "guide") return null;
    if (action === "pause") {
      this.onPauseSignal?.();
      return null;
    }
    if (action === "restart") {
      this.inGameMenuOpen = false;
      return this.activeMatch;
    }
    this.inGameMenuOpen = false;
    this.mainMenuOpen = true;
    this.activeTab = this.returnDir.tab;
    this.twoPlayerSub = this.returnDir.twoPlayerSub;
    this.practiceSub = this.returnDir.practiceSub;
    this.matchIdPopupOpen = false;
    return null;
  }

  syncExternalMatch(request: MatchLaunchRequest): void {
    this.returnDir = {
      tab: request.kind === "ai" ? "ai" : request.kind === "two-player" ? "two-player" : "practice",
      twoPlayerSub: request.kind === "two-player" ? (this.twoPlayerSub ?? "create") : null,
      practiceSub: null
    };
    this.enterMatchState(request);
  }

  private enterMatchState(request: MatchLaunchRequest): void {
    this.activeMatch = request;
    this.mainMenuOpen = false;
    this.inGameMenuOpen = false;
    this.matchIdPopupOpen = false;
  }
}
