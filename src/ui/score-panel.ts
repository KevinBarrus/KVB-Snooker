// PCOL L12110（score-container 模板）/ L7540-7592（As scoreBar 行为）。

export interface ScoreSource {
  readonly pts: number;
  readonly penalty: number;
  readonly brk: number;
}

export interface ScoreGroupState {
  head: string;
  pts: number;
  brk: number;
  // PCOL L7582/7587
  ballOn: number;
  visible: boolean;
}

function makeGroup(): ScoreGroupState {
  return { head: "", pts: 0, brk: 0, ballOn: 0, visible: true };
}

export class ScorePanel {
  readonly groups: [ScoreGroupState, ScoreGroupState] = [makeGroup(), makeGroup()];
  private playerCountValue = 1;
  private playerIndex = 0;
  private ballOnValue = 0;

  get playerCount(): number {
    return this.playerCountValue;
  }

  get ballOn(): number {
    return this.ballOnValue;
  }

  // PCOL L7562-7575
  resetPlayers(names: readonly string[]): void {
    const [g0, g1] = this.groups;
    g0.head = (names[0] ?? "").toUpperCase();
    g0.visible = true;
    if (names.length > 1) {
      g1.visible = true;
      g1.head = names[1].toUpperCase();
      this.playerCountValue = 2;
    } else {
      g1.visible = false;
      g1.head = "";
      this.playerCountValue = 1;
    }
  }

  setBallOn(ballOn: number): void {
    this.ballOnValue = ballOn;
    this.applyBallOn();
  }

  setPlayerIndex(playerIndex: number): void {
    this.playerIndex = playerIndex;
    this.applyBallOn();
  }

  // PCOL L7577-7592
  syncResults(players: readonly ScoreSource[], playerIndex: number): void {
    const s = players[0];
    if (s === undefined) return;
    const n = players[1];
    const [g0, g1] = this.groups;
    g0.brk = s.brk;
    this.playerIndex = playerIndex;
    let pts0 = s.pts;
    if (n !== undefined) {
      g1.brk = n.brk;
      g1.pts = n.pts - s.penalty;
      pts0 -= n.penalty;
    }
    g0.pts = pts0;
    this.applyBallOn();
  }

  private applyBallOn(): void {
    this.groups[0].ballOn = this.playerIndex === 0 ? this.ballOnValue : 0;
    this.groups[1].ballOn = this.playerIndex === 1 ? this.ballOnValue : 0;
  }
}

// PCOL L12110
const SCORE_PANEL_TEMPLATE =
  '<div class="left">\n' +
  '\t\t<h2 class="head"></h2>\n' +
  '\t\t<div class="ball-on-icon snooker"></div>\n' +
  '\t\t<div class="brk-label label-div-125">BRK</div>\n' +
  '\t\t<div class="brk label-div-125">999</div>\n' +
  '\t\t<div class="pts">999</div>\n' +
  "\t</div>\n" +
  '\t<div class="right">\n' +
  '\t\t<h2 class="head"></h2>\n' +
  '\t\t<div class="ball-on-icon snooker"></div>\n' +
  '\t\t<div class="brk-label label-div-125">BRK</div>\n' +
  '\t\t<div class="brk label-div-125">999</div>\n' +
  '\t\t<div class="pts">999</div>\n' +
  "\t</div>";

interface GroupElements {
  root: HTMLElement;
  head: HTMLElement;
  ballOn: HTMLElement;
  brk: HTMLElement;
  pts: HTMLElement;
}

// PCOL L7535-7552
interface GroupCache {
  head: string;
  pts: number;
  brk: number;
  ballOn: number;
  visible: boolean;
}

function makeCache(): GroupCache {
  return { head: "", pts: NaN, brk: NaN, ballOn: 0, visible: true };
}

export class ScorePanelDom {
  readonly element: HTMLElement;
  private readonly groups: [GroupElements, GroupElements];
  private readonly cache: [GroupCache, GroupCache] = [makeCache(), makeCache()];
  private single = false;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "score-container no-drag";
    this.element.innerHTML = SCORE_PANEL_TEMPLATE;
    this.groups = [this.queryGroup(".left"), this.queryGroup(".right")];
  }

  private queryGroup(selector: string): GroupElements {
    const root = this.element.querySelector(selector);
    const head = this.element.querySelector(selector + " .head");
    const ballOn = this.element.querySelector(selector + " .ball-on-icon");
    const brk = this.element.querySelector(selector + " .brk");
    const pts = this.element.querySelector(selector + " .pts");
    if (!(root instanceof HTMLElement) || !(head instanceof HTMLElement) ||
        !(ballOn instanceof HTMLElement) || !(brk instanceof HTMLElement) ||
        !(pts instanceof HTMLElement)) {
      throw new Error("ScorePanelDom: template query failed");
    }
    return { root, head, ballOn, brk, pts };
  }

  sync(panel: ScorePanel): void {
    const single = panel.playerCount === 1;
    if (single !== this.single) {
      this.single = single;
      this.element.classList.toggle("single", single);
    }
    this.syncGroup(0, panel.groups[0]);
    this.syncGroup(1, panel.groups[1]);
  }

  // PCOL L7553-7560
  private syncGroup(index: number, state: ScoreGroupState): void {
    const els = this.groups[index];
    const cache = this.cache[index];
    if (cache.head !== state.head) {
      cache.head = state.head;
      els.head.innerHTML = state.head;
    }
    if (cache.pts !== state.pts) {
      cache.pts = state.pts;
      els.pts.innerHTML = String(state.pts);
    }
    if (cache.brk !== state.brk) {
      cache.brk = state.brk;
      els.brk.innerHTML = String(state.brk);
    }
    if (cache.ballOn !== state.ballOn) {
      cache.ballOn = state.ballOn;
      els.ballOn.className = "ball-on-icon snooker b-" + state.ballOn;
    }
    if (cache.visible !== state.visible) {
      cache.visible = state.visible;
      els.root.style.display = state.visible ? "block" : "none";
    }
  }
}
