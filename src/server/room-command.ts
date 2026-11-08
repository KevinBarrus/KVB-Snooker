import type { DecideTurnAction, MatchAction, PrepareShotAction } from "../net/protocol.js";

/** 命令去重用的规范化动作摘要：只含实质参数，不含 clientSentAtMs 等发送元数据。 */
export function commandSignature(action: unknown): string {
  if (!action || typeof action !== "object") return "unknown:non-object";
  const record = action as { readonly type?: unknown; readonly vars?: unknown; readonly takeOver?: unknown; readonly attemptId?: unknown };
  if (record.type === "ready-next-frame" || record.type === "concede-frame") return `${record.type}:${String(record.attemptId)}`;
  if (record.type === "prepare-shot") {
    return `prepare-shot:${Array.isArray(record.vars) ? record.vars.join(",") : "<invalid>"}`;
  }
  if (record.type === "decide-turn") return `decide-turn:${record.takeOver === true ? "1" : "0"}`;
  return `unknown:${String(record.type)}`;
}

export function isPrepareShotAction(action: unknown): action is PrepareShotAction {
  if (!action || typeof action !== "object") return false;
  const record = action as { readonly type?: unknown; readonly vars?: unknown };
  return record.type === "prepare-shot" && Array.isArray(record.vars);
}

export function isDecideTurnAction(action: unknown): action is DecideTurnAction {
  if (!action || typeof action !== "object") return false;
  const record = action as { readonly type?: unknown; readonly takeOver?: unknown };
  return record.type === "decide-turn" && typeof record.takeOver === "boolean";
}

export function isMatchAction(action: unknown): action is MatchAction {
  if (!action || typeof action !== "object") return false;
  const record = action as { readonly type?: unknown; readonly attemptId?: unknown };
  return (record.type === "ready-next-frame" || record.type === "concede-frame") &&
    typeof record.attemptId === "string" && record.attemptId.length > 0 && record.attemptId.length <= 128;
}
