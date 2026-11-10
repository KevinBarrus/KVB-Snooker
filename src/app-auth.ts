import { AuthClient, AuthError, type IdentitySession } from "./auth/client.js";
import { LoginScreenDom } from "./ui/login-screen.js";

export class BrowserAuthGate {
  private readonly screen: LoginScreenDom;
  private resolveSession: ((session: IdentitySession) => void) | null = null;
  private settled = false;

  constructor(private readonly client: AuthClient, doc: Document = document) {
    this.screen = new LoginScreenDom({
      submit: (email, password) => { void this.submit(email, password); },
      retry: () => { void this.retry(); }
    }, doc);
    doc.body.append(this.screen.element);
  }

  async requireSession(): Promise<IdentitySession> {
    const ready = new Promise<IdentitySession>(resolve => { this.resolveSession = resolve; });
    try {
      const session = await this.client.me();
      if (session) this.settle(session);
      else {
        this.screen.show();
        this.screen.setBusy(false);
        this.screen.setError("");
        this.screen.focus();
      }
      return await ready;
    } catch {
      this.screen.show();
      this.screen.setBusy(false);
      this.screen.setError("身份服务暂时不可用，请稍后重试。", true);
      return await ready;
    }
  }

  dispose(): void { this.screen.dispose(); }

  private async submit(email: string, password: string): Promise<void> {
    if (!email || !password) {
      this.screen.setError("请输入邮箱和密码。");
      return;
    }
    this.screen.setBusy(true);
    this.screen.setError("");
    try {
      this.settle(await this.client.login(email, password));
    } catch (error) {
      this.screen.setBusy(false);
      this.screen.setError(this.loginMessage(error), error instanceof AuthError && error.code === "unavailable");
    }
  }

  private async retry(): Promise<void> {
    this.screen.setBusy(true);
    this.screen.setError("");
    try {
      const session = await this.client.me();
      if (session) this.settle(session);
      else {
        this.screen.setBusy(false);
        this.screen.setError("请使用内测账号登录。");
        this.screen.focus();
      }
    } catch {
      this.screen.setBusy(false);
      this.screen.setError("身份服务暂时不可用，请稍后重试。", true);
    }
  }

  private settle(session: IdentitySession): void {
    if (this.settled) return;
    this.settled = true;
    this.screen.hide();
    this.resolveSession?.(session);
    this.resolveSession = null;
  }

  private loginMessage(error: unknown): string {
    if (!(error instanceof AuthError)) return "登录失败，请稍后重试。";
    if (error.code === "invalid_credentials") return "邮箱或密码不正确。";
    if (error.code === "rate_limited") {
      const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds));
      return `登录尝试过多，请 ${seconds} 秒后重试。`;
    }
    if (error.code === "invalid_request") return "请输入有效的邮箱和密码。";
    return "身份服务暂时不可用，请稍后重试。";
  }
}
