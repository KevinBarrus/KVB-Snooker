// PCOL L5909-5970（qi shortcutsBar）/ L6233-6234、L6306-6309（FPC 状态切换联动）。

export const CTRL_STATE = { STAND: 0, AIM: 1 } as const;

export class ShortcutsBar {
  active = false;
  /** 当前显示的按键组：1 为 aim-group，其余一律 stand-group（PCOL L5960）。 */
  group = -1;
}

// ---- DOM 视图 ----

// PCOL L12122，模板原样照抄
const SHORTCUTS_BAR_TEMPLATE =
  '<div class="shortcut-group no-drag stand-group">\n' +
  '\t\t<div class="shortcut-item aim-key"><span class="kb">W</span>AIM</div>\n' +
  '\t\t<div class="shortcut-item"><span class="kb">X</span>CROUCH</div>\n' +
  '\t\t<div class="shortcut-item pickup-key"><span class="kb">P</span>PLACE BALL</div>\n' +
  "\t</div>\n" +
  '\t<div class="shortcut-group no-drag aim-group">\n' +
  '\t\t<div class="shortcut-item"><span class="kb">S</span>STAND</div>\n' +
  '\t\t<div class="shortcut-item"><span class="kb">SPACE</span>SHOT</div>\n' +
  '\t\t<div class="shortcut-item"><span class="kb assi-key">Alt</span><span class="plus-icon sprite"></span><span class="m-d-i sprite"></span>ADD SPIN</div>\n' +
  '\t\t<div class="shortcut-item"><span class="kb">C</span>CLEAR SPIN</div>\n' +
  '\t\t<div class="shortcut-item"><span class="m-w-i sprite"></span>SET POWER</div>\n' +
  '\t\t<div class="shortcut-item"><span class="kb assi-key">Alt</span><span class="plus-icon sprite"></span><span class="m-w-i sprite"></span>ELEVATION</div>\n' +
  "\t</div>\n" +
  '\t<a class="more-button">...</a>\n';

export class ShortcutsBarDom {
  readonly element: HTMLElement;
  private readonly standGroup: HTMLElement;
  private readonly aimGroup: HTMLElement;
  private renderedGroup = -1;
  private renderedActive = false;

  constructor(doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "shortcuts-bar";
    this.element.style.display = "none";
    this.element.innerHTML = SHORTCUTS_BAR_TEMPLATE;
    const stand = this.element.querySelector(".stand-group");
    const aim = this.element.querySelector(".aim-group");
    if (!(stand instanceof HTMLElement) || !(aim instanceof HTMLElement)) {
      throw new Error("ShortcutsBarDom: template query failed");
    }
    this.standGroup = stand;
    this.aimGroup = aim;
    // PCOL L5926-5929
    if (/Mac/.test(doc.defaultView?.navigator.platform ?? "")) {
      for (const key of Array.from(this.element.querySelectorAll(".assi-key"))) key.innerHTML = "cmd";
    }
  }

  // PCOL L5932-5940 显示用 flex；L5958-5964 组切换
  sync(bar: ShortcutsBar): void {
    if (bar.active !== this.renderedActive) {
      this.renderedActive = bar.active;
      this.element.style.display = bar.active ? "flex" : "none";
    }
    if (bar.group !== this.renderedGroup) {
      this.renderedGroup = bar.group;
      const aim = bar.group === CTRL_STATE.AIM;
      this.standGroup.style.display = aim ? "none" : "flex";
      this.aimGroup.style.display = aim ? "flex" : "none";
    }
  }
}
