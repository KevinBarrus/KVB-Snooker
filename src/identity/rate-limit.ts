export interface LoginRateLimiterOptions {
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly maxKeys?: number;
}

export interface RateLimitStatus {
  readonly limited: boolean;
  readonly retryAfterSeconds: number;
}

export interface LoginRateLimiter {
  status(key: string, nowMs: number): RateLimitStatus;
  recordFailure(key: string, nowMs: number): void;
  reset(key: string): void;
}

interface WindowEntry {
  windowStartedAt: number;
  failures: number;
}

const DEFAULT_MAX_KEYS = 10_000;

/**
 * 单实例内存固定窗口限流：按来源 IP + 邮箱统计失败次数。
 * 进程重启会清空状态，作为单实例内测的可接受限制记录在设计 §3.2。
 */
export function createLoginRateLimiter(options: LoginRateLimiterOptions): LoginRateLimiter {
  const entries = new Map<string, WindowEntry>();
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

  function isExpired(entry: WindowEntry, nowMs: number): boolean {
    return nowMs - entry.windowStartedAt >= options.windowMs;
  }

  function prune(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (isExpired(entry, nowMs)) entries.delete(key);
    }
    while (entries.size > maxKeys) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  }

  return {
    status(key: string, nowMs: number): RateLimitStatus {
      const entry = entries.get(key);
      if (entry === undefined) return { limited: false, retryAfterSeconds: 0 };
      if (isExpired(entry, nowMs)) {
        entries.delete(key);
        return { limited: false, retryAfterSeconds: 0 };
      }
      if (entry.failures < options.maxAttempts) return { limited: false, retryAfterSeconds: 0 };
      const remainingMs = entry.windowStartedAt + options.windowMs - nowMs;
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    },
    recordFailure(key: string, nowMs: number): void {
      prune(nowMs);
      const entry = entries.get(key);
      if (entry === undefined || isExpired(entry, nowMs)) {
        entries.set(key, { windowStartedAt: nowMs, failures: 1 });
        return;
      }
      entry.failures += 1;
    },
    reset(key: string): void {
      entries.delete(key);
    },
  };
}
