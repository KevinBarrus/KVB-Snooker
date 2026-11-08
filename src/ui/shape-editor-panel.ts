import type { CueBallStyle } from "./game-menu.js";

export interface ShapeEditorInventoryItem {
  readonly ballNumber: number;
  readonly count: number;
}

export interface ShapeEditorColourOption {
  readonly ballNumber: number;
  readonly available: boolean;
  readonly count: number;
}

export interface ShapeEditorPort {
  readonly editing: boolean;
  inventory(): readonly ShapeEditorInventoryItem[];
  selectedBall(): number | null;
  selectBall(ballNumber: number): void;
  finish(name: string): void;
  save(): void;
  exit(): void;
  colourOptions(): readonly ShapeEditorColourOption[];
  applyColours(ballNumbers: readonly number[]): { readonly ok: boolean; readonly occupied: readonly string[] };
  colourName(ballNumber: number): string;
  focusCanvas(): void;
  dialogsOpen(open: boolean): void;
}

const BALL_LABELS: Record<number, string> = {
  1: "红球", 2: "黄球", 3: "绿球", 4: "棕球", 5: "蓝球", 6: "粉球", 7: "黑球"
};

const BALL_COLOURS: Record<number, string> = {
  1: "#c0392b", 2: "#e3c229", 3: "#1f8b4c", 4: "#7a4a2c", 5: "#2f6fb0", 6: "#e08fa8", 7: "#151515"
};

export class ShapeEditorPanelDom {
  readonly element: HTMLElement;
  private readonly ballButtons = new Map<number, HTMLButtonElement>();
  private readonly toolRow: HTMLElement;
  private readonly spotButton: HTMLButtonElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly detailPoint: HTMLElement;
  private dialog: HTMLElement | null = null;

  constructor(private readonly port: ShapeEditorPort, private readonly doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "shape-editor-layer";
    const tools = doc.createElement("div");
    tools.className = "shape-editor-tools";
    this.spotButton = this.makeButton("将彩球放在点位", () => this.openColourDialog());
    this.finishButton = this.makeButton(port.editing ? "保存" : "完成创建", () => this.requestFinish());
    this.exitButton = this.makeButton("退出创建", () => this.requestExit());
    tools.append(this.spotButton, this.finishButton, this.exitButton);
    this.toolRow = doc.createElement("div");
    this.toolRow.className = "shape-editor-inventory";
    this.detailPoint = doc.createElement("p");
    this.detailPoint.className = "shape-editor-hint";
    this.detailPoint.hidden = true;
    this.element.append(tools, this.toolRow, this.detailPoint);
    doc.body.append(this.element);
  }

  sync(): void {
    const inventory = this.port.inventory();
    if (this.ballButtons.size !== inventory.length) this.buildInventory(inventory);
    const selected = this.port.selectedBall();
    for (const item of inventory) {
      const button = this.ballButtons.get(item.ballNumber);
      if (!button) continue;
      button.classList.toggle("selected", selected === item.ballNumber);
      button.classList.toggle("empty", item.count === 0);
      button.setAttribute("aria-pressed", String(selected === item.ballNumber));
      const count = button.querySelector(".shape-editor-count");
      if (count) count.textContent = String(item.count);
      button.setAttribute("aria-label", `${BALL_LABELS[item.ballNumber] ?? ""}，剩余 ${item.count}`);
    }
    this.finishButton.textContent = this.port.editing ? "保存" : "完成创建";
  }

  showRecycle(ballNumber: number, onConfirm: () => void): void {
    this.showConfirm(`回收这颗${BALL_LABELS[ballNumber] ?? "球"}？`, "回收", onConfirm);
  }

  dispose(): void {
    this.closeDialog();
    this.element.remove();
  }

  private buildInventory(inventory: readonly ShapeEditorInventoryItem[]): void {
    this.ballButtons.clear();
    this.toolRow.replaceChildren();
    for (const item of inventory) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "shape-editor-ball";
      const ball = this.doc.createElement("span");
      ball.className = "shape-editor-sphere";
      ball.style.setProperty("--ball-colour", BALL_COLOURS[item.ballNumber] ?? "#888");
      const cross = this.doc.createElement("span");
      cross.className = "shape-editor-forbidden";
      cross.textContent = "×";
      const count = this.doc.createElement("span");
      count.className = "shape-editor-count";
      count.textContent = String(item.count);
      button.append(ball, cross, count);
      button.addEventListener("click", () => { this.port.selectBall(item.ballNumber); this.port.focusCanvas(); });
      this.ballButtons.set(item.ballNumber, button);
      this.toolRow.append(button);
    }
  }

  private requestFinish(): void {
    if (this.port.editing) {
      this.showConfirm("确认保存当前球形？", "保存", () => this.port.save());
      return;
    }
    const input = this.doc.createElement("input");
    input.className = "menu-text-input";
    input.maxLength = 30;
    input.placeholder = "球形名称（最多 30 个字符）";
    const dialog = this.makeDialog("为球形命名");
    dialog.append(input);
    const row = this.doc.createElement("div");
    row.className = "my-shapes-dialog-actions";
    const create = this.makeAction("创建", true, () => {
      const name = input.value.trim();
      if (!name) { this.showAlert("名称不能为空"); return; }
      this.closeDialog();
      this.showConfirm(`确认以「${name}」完成创建？`, "确认", () => {
        this.showNotice("已创建。回到我的球形后点击该球形即可开始练习", "返回", () => this.port.finish(name));
      });
    });
    const cancel = this.makeAction("取消", false, () => { this.closeDialog(); this.port.focusCanvas(); });
    row.append(create, cancel);
    dialog.append(row);
    this.mount(dialog);
    input.focus();
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); create.click(); }
    });
  }

  private requestExit(): void {
    this.showConfirm("放弃修改并退出创建？", "确认退出", () => this.port.exit());
  }

  private openColourDialog(): void {
    this.closeDialog();
    const options = this.port.colourOptions();
    const selected = new Set<number>();
    const dialog = this.makeDialog("将彩球放在点位");
    const grid = this.doc.createElement("div");
    grid.className = "shape-editor-colours";
    for (const option of options) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "shape-editor-colour";
      button.disabled = !option.available;
      const ball = this.doc.createElement("span");
      ball.className = "shape-editor-sphere";
      ball.style.setProperty("--ball-colour", BALL_COLOURS[option.ballNumber] ?? "#888");
      button.append(ball);
      button.setAttribute("aria-label", this.port.colourName(option.ballNumber));
      button.addEventListener("click", () => {
        if (!option.available) return;
        if (selected.has(option.ballNumber)) { selected.delete(option.ballNumber); button.classList.remove("selected"); }
        else { selected.add(option.ballNumber); button.classList.add("selected"); }
      });
      grid.append(button);
    }
    const row = this.doc.createElement("div");
    row.className = "my-shapes-dialog-actions";
    const confirm = this.makeAction("确认", true, () => {
      const result = this.port.applyColours([...selected]);
      if (!result.ok) {
        this.showAlert(`有球占用了${result.occupied.join("、")}的点位，右键选中球可以移开`);
        return;
      }
      this.closeDialog();
      this.port.focusCanvas();
    });
    const cancel = this.makeAction("取消", false, () => { this.closeDialog(); this.port.focusCanvas(); });
    row.append(confirm, cancel);
    dialog.append(grid, row);
    this.mount(dialog);
    this.port.focusCanvas();
  }

  private showConfirm(message: string, confirmLabel: string, onConfirm: () => void): void {
    this.closeDialog();
    this.ensureCameraFree();
    const dialog = this.makeDialog(message);
    const row = this.doc.createElement("div");
    row.className = "my-shapes-dialog-actions";
    row.append(
      this.makeAction(confirmLabel, true, () => { this.closeDialog(); onConfirm(); this.port.focusCanvas(); }),
      this.makeAction("取消", false, () => { this.closeDialog(); this.port.focusCanvas(); })
    );
    dialog.append(row);
    this.mount(dialog);
    this.port.focusCanvas();
  }

  private showNotice(message: string, actionLabel: string, after: () => void): void {
    this.closeDialog();
    const dialog = this.makeDialog(message);
    const row = this.doc.createElement("div");
    row.className = "my-shapes-dialog-actions";
    const action = this.makeAction(actionLabel, true, () => { this.closeDialog(); after(); });
    row.append(action);
    dialog.append(row);
    this.mount(dialog);
    this.port.focusCanvas();
  }

  private showAlert(message: string, after?: () => void): void {
    this.closeDialog();
    const dialog = this.makeDialog(message);
    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "my-shapes-dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => { this.closeDialog(); this.port.focusCanvas(); after?.(); });
    dialog.prepend(close);
    this.mount(dialog);
  }

  private makeDialog(title: string): HTMLElement {
    const dialog = this.doc.createElement("section");
    dialog.className = "menu-choice-dialog shape-editor-dialog";
    const heading = this.doc.createElement("strong");
    heading.textContent = title;
    dialog.append(heading);
    return dialog;
  }

  private makeAction(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    return this.makeButton(label, onClick, primary ? "menu-cta-btn" : "menu-seg-btn");
  }

  private makeButton(label: string, onClick: () => void, className = "menu-seg-btn"): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private mount(dialog: HTMLElement): void {
    this.doc.body.append(dialog);
    this.dialog = dialog;
    this.port.dialogsOpen(true);
  }

  private closeDialog(): void {
    const had = this.dialog !== null;
    this.dialog?.remove();
    this.dialog = null;
    if (had) this.port.dialogsOpen(false);
  }

  /** 弹出框不锁镜头；仅把焦点从画布移开，指针拖动仍能重新聚焦。 */
  private ensureCameraFree(): void {
    void this.detailPoint;
  }
}

export type { CueBallStyle };
