import type { MenuIdentity } from "./game-menu";

export class MenuIdentityDom {
  readonly chip: HTMLElement;
  readonly account: HTMLElement;
  private readonly email: HTMLElement;
  private readonly accountEmail: HTMLElement;
  private readonly accountId: HTMLElement;

  constructor(doc: Document, onLogout?: () => void) {
    this.chip = doc.createElement("div");
    this.chip.className = "menu-identity";
    this.email = doc.createElement("span");
    this.email.className = "menu-identity-email";
    const logout = doc.createElement("button");
    logout.type = "button";
    logout.className = "menu-logout-btn";
    logout.textContent = "退出登录";
    logout.addEventListener("click", () => onLogout?.());
    this.chip.append(this.email, logout);
    this.chip.hidden = true;

    this.account = doc.createElement("section");
    this.account.className = "menu-account";
    const label = doc.createElement("span");
    label.className = "menu-account-label";
    label.textContent = "当前账号";
    this.accountEmail = doc.createElement("strong");
    this.accountEmail.className = "menu-account-email";
    this.accountId = doc.createElement("span");
    this.accountId.className = "menu-account-id";
    const accountLogout = doc.createElement("button");
    accountLogout.type = "button";
    accountLogout.className = "menu-seg-btn";
    accountLogout.textContent = "退出登录";
    accountLogout.addEventListener("click", () => onLogout?.());
    this.account.append(label, this.accountEmail, this.accountId, accountLogout);
    this.account.hidden = true;
  }

  sync(viewer: MenuIdentity | null, mainMenuOpen: boolean): void {
    this.chip.hidden = !viewer || !mainMenuOpen;
    this.email.textContent = viewer?.email ?? "";
    this.account.hidden = !viewer;
    if (viewer) {
      this.accountEmail.textContent = viewer.email;
      this.accountId.textContent = `用户 ID ${viewer.id}`;
    }
  }
}
