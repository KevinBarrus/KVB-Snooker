import type { EventEmitter } from "node:events";

export class SecretInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretInputError";
  }
}

export class SecretInputCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretInputCancelledError";
  }
}

/** process.stdin 与测试用 Readable 都满足该最小接口。 */
export type SecretInput = EventEmitter & {
  readonly isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): void;
  resume(): void;
  pause(): void;
  setRawMode?(mode: boolean): void;
};

export interface SecretOutput {
  readonly isTTY?: boolean;
  write(chunk: string): boolean;
}

export interface SecretReader {
  read(prompt: string): Promise<string>;
  close(): void;
}

interface LineWaiter {
  readonly read: (value: string) => void;
  readonly reject: (error: Error) => void;
}

/**
 * 隐藏密码输入：TTY 下 raw mode 逐字符读取（支持退格、Ctrl+C，不回显）；
 * 非 TTY（部署脚本/管道）按行读取且不打印密码。
 * 非 TTY 行由本模块自行缓存，避免 readline 预读吞掉下一次输入。
 */
export function createSecretReader(options: { readonly input: SecretInput; readonly output: SecretOutput }): SecretReader {
  const { input, output } = options;
  const interactive = input.isTTY === true && typeof input.setRawMode === "function";
  let buffered = "";
  const queuedLines: string[] = [];
  let waiters: LineWaiter[] = [];
  let ended = false;
  let closed = false;

  input.setEncoding("utf8");

  function flushLines(): void {
    while (queuedLines.length > 0 && waiters.length > 0) {
      const line = queuedLines.shift();
      const waiter = waiters.shift();
      if (line !== undefined && waiter !== undefined) waiter.read(line);
    }
  }

  function handleData(chunk: string): void {
    buffered += chunk;
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      let line = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      queuedLines.push(line);
      newlineIndex = buffered.indexOf("\n");
    }
    flushLines();
  }

  function handleEnd(): void {
    ended = true;
    if (buffered.length > 0) {
      let line = buffered;
      buffered = "";
      if (line.endsWith("\r")) line = line.slice(0, -1);
      queuedLines.push(line);
      flushLines();
    }
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter.reject(new SecretInputError("密码输入已结束"));
  }

  if (!interactive) {
    input.on("data", handleData);
    input.on("end", handleEnd);
    input.resume();
  }

  function readInteractive(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let value = "";
      let settled = false;
      const onData = (chunk: string): void => {
        for (const character of Array.from(chunk)) {
          if (character === "\u0003") {
            finish(() => reject(new SecretInputCancelledError("已取消密码输入")));
            return;
          }
          if (character === "\u0004") {
            finish(() => reject(new SecretInputError("密码输入已结束")));
            return;
          }
          if (character === "\r" || character === "\n") {
            finish(() => resolve(value));
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = Array.from(value).slice(0, -1).join("");
            continue;
          }
          if (character >= " ") value += character;
        }
      };
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        input.off("data", onData);
        if (typeof input.setRawMode === "function") input.setRawMode(false);
        action();
      };
      input.on("data", onData);
      if (typeof input.setRawMode === "function") input.setRawMode(true);
      input.resume();
      if (output.isTTY === true) output.write(prompt);
    });
  }

  function readPiped(prompt: string): Promise<string> {
    if (output.isTTY === true) output.write(prompt);
    const line = queuedLines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.reject(new SecretInputError("密码输入已结束"));
    return new Promise<string>((resolve, reject) => {
      waiters.push({ read: resolve, reject });
    });
  }

  return {
    read(prompt: string): Promise<string> {
      if (closed) return Promise.reject(new SecretInputError("密码读取器已关闭"));
      return interactive ? readInteractive(prompt) : readPiped(prompt);
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (!interactive) {
        input.off("data", handleData);
        input.off("end", handleEnd);
      } else if (typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) waiter.reject(new SecretInputError("密码读取器已关闭"));
    },
  };
}
