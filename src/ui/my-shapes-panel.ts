import {
  CUSTOM_SHAPE_LIMIT, CUSTOM_SHAPE_RECYCLE_MS, isValidShapeName,
  type CustomShapeRecord, type CustomShapesSnapshot
} from "../core/practice/custom-shapes.js";
import type { CueBallStyle } from "./game-menu.js";

export interface MyShapesPort {
  snapshot(): CustomShapesSnapshot;
  create(): void;
  edit(id: string): void;
  start(id: string, cueBallStyle: CueBallStyle, respotColoursAfterReds: boolean): void;
  rename(id: string, name: string): boolean;
  remove(id: string): void;
  restore(id: string): "ok" | "full" | "missing";
  purge(id: string): void;
  /** 旧匿名本地球形仍保留；由玩家手动导入当前账号。 */
  legacy?: { readonly count: number; import(): { imported: number; skipped: number } };
}

type Section = "mine" | "recycle";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatRecycleExpiry(deletedAt: number): string {
  const date = new Date(deletedAt + CUSTOM_SHAPE_RECYCLE_MS);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export class MyShapesPanelDom {
  readonly element: HTMLElement;
  private readonly createButton: HTMLButtonElement;
  private readonly legacyButton: HTMLButtonElement;
  private readonly mineButton: HTMLButtonElement;
  private readonly recycleButton: HTMLButtonElement;
  private readonly items: HTMLElement;
  private section: Section = "mine";
  private signature = "";
  private contextMenu: HTMLElement | null = null;
  private dialog: HTMLElement | null = null;
  private readonly onDocumentPointer = (event: PointerEvent): void => {
    if (this.contextMenu?.contains(event.target as Node)) return;
    this.closeContextMenu();
  };
  private readonly onDocumentKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { this.closeContextMenu(); this.closeDialog(); }
  };

  constructor(private readonly port: MyShapesPort, private readonly doc: Document = document) {
    this.element = doc.createElement("div");
    this.element.className = "my-shapes-panel";
    this.createButton = doc.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "menu-list-top-action";
    this.createButton.textContent = "创建球形";
    this.createButton.addEventListener("click", () => this.requestCreate());
    this.legacyButton = doc.createElement("button");
    this.legacyButton.type = "button";
    this.legacyButton.className = "menu-list-top-action menu-legacy-import";
    this.legacyButton.textContent = "导入旧版本地球形";
    this.legacyButton.hidden = true;
    this.legacyButton.addEventListener("click", () => this.importLegacy());
    const tabs = doc.createElement("div");
    tabs.className = "my-shapes-tabs";
    this.mineButton = this.makeTab("我的球形", () => this.select("mine"));
    this.recycleButton = this.makeTab("球形回收站", () => this.select("recycle"));
    tabs.append(this.mineButton, this.recycleButton);
    this.items = doc.createElement("div");
    this.items.className = "my-shapes-items";
    this.element.append(this.createButton, this.legacyButton, tabs, this.items);
    doc.addEventListener("pointerdown", this.onDocumentPointer);
    doc.addEventListener("keydown", this.onDocumentKey);
  }

  showMine(): void {
    this.section = "mine";
    this.signature = "";
    this.sync();
  }

  sync(): void {
    const snapshot = this.port.snapshot();
    const list = this.section === "mine" ? snapshot.active : snapshot.recycle;
    this.legacyButton.hidden = !this.port.legacy || this.port.legacy.count === 0;
    this.mineButton.setAttribute("aria-pressed", String(this.section === "mine"));
    this.recycleButton.setAttribute("aria-pressed", String(this.section === "recycle"));
    const next = [this.section,
      snapshot.active.map(item => `${item.id}:${item.name}`).join(","),
      snapshot.recycle.map(item => `${item.id}:${item.name}:${item.deletedAt}`).join(",")].join("|");
    if (next !== this.signature) {
      this.signature = next;
      this.renderItems(list);
    }
  }

  dispose(): void {
    this.closeContextMenu();
    this.closeDialog();
    this.doc.removeEventListener("pointerdown", this.onDocumentPointer);
    this.doc.removeEventListener("keydown", this.onDocumentKey);
    this.element.remove();
  }

  private makeTab(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "my-shapes-tab";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private select(section: Section): void {
    this.section = section;
    this.signature = "";
    this.sync();
  }

  private importLegacy(): void {
    const legacy = this.port.legacy;
    if (!legacy) return;
    const result = legacy.import();
    this.signature = "";
    this.sync();
    if (result.imported === 0) this.showAlert("没有可导入的新球形。");
    else this.showAlert(`已导入 ${result.imported} 个球形${result.skipped ? `，跳过 ${result.skipped} 个` : ""}。`);
  }

  private requestCreate(): void {
    if (this.port.snapshot().active.length >= CUSTOM_SHAPE_LIMIT) {
      this.showAlert(`自建球形数量已达上限（${CUSTOM_SHAPE_LIMIT}个）`);
      return;
    }
    this.port.create();
  }

  private renderItems(list: readonly CustomShapeRecord[]): void {
    this.items.replaceChildren();
    if (list.length === 0) {
      const empty = this.doc.createElement("div");
      empty.className = "menu-list-empty";
      empty.textContent = this.section === "mine" ? "当前还未创建球形" : "回收站为空";
      this.items.append(empty);
      return;
    }
    for (const record of list) {
      const item = this.doc.createElement("button");
      item.type = "button";
      item.className = "my-shapes-item";
      const name = this.doc.createElement("span");
      name.className = "my-shapes-name";
      name.textContent = record.name;
      item.append(name);
      if (this.section === "recycle" && record.deletedAt !== null) {
        const expiry = this.doc.createElement("span");
        expiry.className = "my-shapes-expiry";
        expiry.textContent = formatRecycleExpiry(record.deletedAt);
        item.append(expiry);
      }
      item.addEventListener("click", () => {
        if (this.section === "mine") this.openStartDialog(record);
      });
      item.addEventListener("contextmenu", event => {
        event.preventDefault();
        this.openContextMenu(event.clientX, event.clientY, record);
      });
      this.items.append(item);
    }
  }

  private openContextMenu(x: number, y: number, record: CustomShapeRecord): void {
    this.closeDialog();
    this.closeContextMenu();
    const menu = this.doc.createElement("div");
    menu.className = "my-shapes-context";
    const items: { label: string; run: () => void }[] = this.section === "mine"
      ? [
        { label: "编辑", run: () => this.port.edit(record.id) },
        { label: "重命名", run: () => this.openRenameDialog(record) },
        { label: "删除", run: () => this.openDeleteDialog(record) }
      ]
      : [
        { label: "恢复", run: () => this.restore(record) },
        { label: "彻底删除", run: () => this.openPurgeDialog(record) }
      ];
    for (const item of items) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => { this.closeContextMenu(); item.run(); });
      menu.append(button);
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    this.doc.body.append(menu);
    this.contextMenu = menu;
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  private openStartDialog(record: CustomShapeRecord): void {
    this.showDialog(`开始「${record.name}」球形练习？`, [
      { label: "经典母球", primary: true, run: () => this.openClearanceDialog(record, "classic") },
      { label: "红点母球", run: () => this.openClearanceDialog(record, "red-dot") },
      { label: "取消", run: () => undefined }
    ]);
  }

  private openClearanceDialog(record: CustomShapeRecord, style: CueBallStyle): void {
    const hasRed = record.balls.some(ball => ball.index >= 1 && ball.index <= 15);
    const hasColour = record.balls.some(ball => ball.index >= 16 && ball.index <= 21);
    if (!hasRed || !hasColour) { this.port.start(record.id, style, false); return; }
    this.showDialog("红球清完后，打进的彩球还要继续复位吗？", [
      { label: "继续复位彩球", primary: true, run: () => this.port.start(record.id, style, true) },
      { label: "彩球不再复位", run: () => this.port.start(record.id, style, false) },
      { label: "取消", run: () => undefined }
    ]);
  }

  private openRenameDialog(record: CustomShapeRecord): void {
    const input = this.doc.createElement("input");
    input.className = "menu-text-input";
    input.maxLength = 30;
    input.value = record.name;
    this.showDialog("重命名球形", [
      { label: "确认", primary: true, run: () => { if (!this.port.rename(record.id, input.value)) this.showAlert("名称不能为空，且最多 30 个字符"); } },
      { label: "取消", run: () => undefined }
    ], input);
  }

  private openDeleteDialog(record: CustomShapeRecord): void {
    this.showDialog(`确认删除「${record.name}」？删除后进入球形回收站。`, [
      { label: "删除", primary: true, run: () => this.port.remove(record.id) },
      { label: "取消", run: () => undefined }
    ]);
  }

  private openPurgeDialog(record: CustomShapeRecord): void {
    this.showDialog(`彻底删除「${record.name}」？此操作不可恢复。`, [
      { label: "彻底删除", primary: true, run: () => this.port.purge(record.id) },
      { label: "取消", run: () => undefined }
    ]);
  }

  private restore(record: CustomShapeRecord): void {
    const result = this.port.restore(record.id);
    if (result === "full") this.showAlert(`自建球形数量已达上限（${CUSTOM_SHAPE_LIMIT}个），无法恢复`);
    else if (result === "missing") this.showAlert("该球形已不存在");
  }

  private showAlert(message: string): void {
    this.closeDialog();
    const dialog = this.makeDialog(message);
    const close = this.doc.createElement("button");
    close.type = "button";
    close.className = "my-shapes-dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => this.closeDialog());
    dialog.prepend(close);
    this.mountDialog(dialog);
  }

  private showDialog(title: string, actions: readonly { label: string; primary?: boolean; run: () => void }[],
    input?: HTMLInputElement): void {
    this.closeDialog();
    const dialog = this.makeDialog(title);
    if (input) dialog.append(input);
    const row = this.doc.createElement("div");
    row.className = "my-shapes-dialog-actions";
    for (const action of actions) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = action.primary ? "menu-cta-btn" : "menu-seg-btn";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        this.closeDialog();
        action.run();
        this.signature = "";
        this.sync();
      });
      row.append(button);
    }
    dialog.append(row);
    if (input) {
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") { this.closeDialog(); actions[0]?.run(); this.signature = ""; this.sync(); }
      });
    }
    this.mountDialog(dialog);
  }

  private makeDialog(title: string): HTMLElement {
    const dialog = this.doc.createElement("section");
    dialog.className = "menu-choice-dialog";
    const heading = this.doc.createElement("strong");
    heading.textContent = title;
    dialog.append(heading);
    return dialog;
  }

  private mountDialog(dialog: HTMLElement): void {
    this.doc.body.append(dialog);
    this.dialog = dialog;
  }

  private closeDialog(): void {
    this.dialog?.remove();
    this.dialog = null;
  }
}

export function isMyShapeNameValid(name: string): boolean {
  return isValidShapeName(name);
}
