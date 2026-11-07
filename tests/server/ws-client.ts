import type { ClientMessage, ServerMessage } from "../../src/net/protocol.js";

/** 真实 Node 内置 WebSocket 客户端，带消息缓冲与按类型等待，用于传输层验收。 */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private readonly socket: WebSocket;
  private readonly waiters: Array<() => void> = [];
  private cursor = 0;
  private closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", event => {
      const data: unknown = event.data;
      if (typeof data !== "string") return;
      const parsed: unknown = JSON.parse(data);
      this.messages.push(parsed as ServerMessage);
      this.notify();
    });
    socket.addEventListener("close", () => {
      this.closed = true;
      this.notify();
    });
    socket.addEventListener("error", () => {
      this.closed = true;
      this.notify();
    });
  }

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const onError = (): void => reject(new Error(`WebSocket 连接失败：${url}`));
      socket.addEventListener("open", () => {
        socket.removeEventListener("error", onError);
        resolve(new TestClient(socket));
      });
      socket.addEventListener("error", onError);
    });
  }

  get isClosed(): boolean { return this.closed; }

  send(message: ClientMessage | { readonly type: string; readonly [key: string]: unknown }): void {
    this.socket.send(JSON.stringify(message));
  }

  peerClosed(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(), 3000);
      const check = (): void => {
        if (this.closed) {
          clearTimeout(timer);
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  close(): void {
    if (!this.closed) this.socket.close();
  }

  /** 按到达顺序取第一条未消费的匹配消息；不存在时等待新消息。 */
  async waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 8000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let index = this.cursor; index < this.messages.length; ++index) {
        const message = this.messages[index];
        if (predicate(message)) {
          this.cursor = index + 1;
          return message;
        }
      }
      this.cursor = this.messages.length;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("等待服务器消息超时");
      if (this.closed) throw new Error("等待服务器消息时连接已关闭");
      await this.waitForChange(remaining);
    }
  }

  all(predicate: (message: ServerMessage) => boolean): readonly ServerMessage[] {
    return this.messages.filter(predicate);
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const wake = (): void => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(wake);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve();
      }, timeoutMs);
      this.waiters.push(wake);
    });
  }

  private notify(): void {
    for (const wake of this.waiters.splice(0)) wake();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
