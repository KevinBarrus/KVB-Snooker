export interface LoginScreenActions {
  submit(email: string, password: string): void;
  retry(): void;
}

export class LoginScreenDom {
  readonly element: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly email: HTMLInputElement;
  private readonly password: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly retryButton: HTMLButtonElement;
  private busy = false;

  constructor(private readonly actions: LoginScreenActions, private readonly doc: Document = document) {
    this.element = doc.createElement("section");
    this.element.className = "login-screen";
    this.element.setAttribute("aria-label", "内测登录");
    const card = doc.createElement("div");
    card.className = "login-card";
    const eyebrow = doc.createElement("span");
    eyebrow.className = "login-eyebrow";
    eyebrow.textContent = "KVB · SNOOKER";
    const title = doc.createElement("h1");
    title.className = "login-title";
    title.textContent = "内测登录";
    const hint = doc.createElement("p");
    hint.className = "login-hint";
    hint.textContent = "仅限受邀账号";
    this.form = doc.createElement("form");
    this.form.className = "login-form";
    this.email = this.makeInput("email", "邮箱", "username");
    this.password = this.makeInput("password", "密码", "current-password");
    this.message = doc.createElement("p");
    this.message.className = "login-message";
    this.message.setAttribute("role", "alert");
    this.submitButton = doc.createElement("button");
    this.submitButton.type = "submit";
    this.submitButton.className = "menu-cta-btn login-submit";
    this.submitButton.textContent = "登录";
    this.retryButton = doc.createElement("button");
    this.retryButton.type = "button";
    this.retryButton.className = "menu-seg-btn login-retry";
    this.retryButton.textContent = "重试连接";
    this.retryButton.hidden = true;
    this.retryButton.addEventListener("click", () => this.actions.retry());
    this.form.addEventListener("submit", event => {
      event.preventDefault();
      if (this.busy) return;
      this.actions.submit(this.email.value.trim(), this.password.value);
    });
    this.form.append(this.makeLabel("邮箱", this.email), this.makeLabel("密码", this.password),
      this.message, this.submitButton, this.retryButton);
    card.append(eyebrow, title, hint, this.form);
    this.element.append(card);
    this.element.hidden = true;
  }

  show(): void {
    this.element.hidden = false;
    this.focus();
  }

  hide(): void { this.element.hidden = true; }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.email.disabled = busy;
    this.password.disabled = busy;
    this.submitButton.disabled = busy;
    this.submitButton.textContent = busy ? "登录中…" : "登录";
  }

  setError(message: string, retry = false): void {
    this.message.textContent = message;
    this.retryButton.hidden = !retry;
    if (message) this.message.classList.add("login-message-error");
    else this.message.classList.remove("login-message-error");
  }

  focus(): void {
    if (this.element.hidden) return;
    if (!this.email.value) this.email.focus();
    else this.password.focus();
  }

  dispose(): void { this.element.remove(); }

  private makeInput(type: "email" | "password", name: string, autocomplete: "username" | "current-password"): HTMLInputElement {
    const input = this.doc.createElement("input");
    input.type = type;
    input.name = name;
    input.className = "menu-text-input login-input";
    input.autocomplete = autocomplete;
    input.required = true;
    if (type === "email") input.inputMode = "email";
    return input;
  }

  private makeLabel(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = this.doc.createElement("label");
    label.className = "login-label";
    const span = this.doc.createElement("span");
    span.textContent = text;
    label.append(span, input);
    return label;
  }
}
