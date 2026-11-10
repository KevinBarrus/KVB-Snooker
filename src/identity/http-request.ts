export const MAX_JSON_BODY_BYTES = 16 * 1024;

export type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: "too_large" | "invalid_json" };

/**
 * 有上限地读取 JSON 请求体；超限后继续排空剩余数据但不保留，
 * 避免连接被提前销毁导致客户端只看到断连。
 */
export async function readJsonBody(
  request: AsyncIterable<Buffer>,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    if (tooLarge) continue;
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (tooLarge) return { ok: false, failure: "too_large" };
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return { ok: false, failure: "invalid_json" };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, failure: "invalid_json" };
  }
}

/** 只接受对象形态的 `{ email: string, password: string }`，其余交由 invalid_request。 */
export function readCredentials(value: unknown): { readonly email: string; readonly password: string } | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("email" in value) || !("password" in value)) return null;
  const email = value.email;
  const password = value.password;
  if (typeof email !== "string" || typeof password !== "string") return null;
  return { email, password };
}

/** 内部校验端点需要 `{ token: string }`。 */
export function readSessionTokenBody(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("token" in value)) return null;
  const token = value.token;
  return typeof token === "string" ? token : null;
}
