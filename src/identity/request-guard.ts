import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";

export interface ClientAddressRequest {
  readonly headers: IncomingHttpHeaders;
  readonly socket: { readonly remoteAddress?: string | undefined };
}

function normalizeIp(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("::ffff:")) {
    const ipv4 = trimmed.slice("::ffff:".length);
    return isIP(ipv4) === 4 ? ipv4 : "";
  }
  return isIP(trimmed) === 0 ? "" : trimmed;
}

/**
 * 默认使用 socket 地址；仅 TRUST_PROXY=1 时读取 X-Forwarded-For 最左值，
 * 且最左值必须是合法 IP，否则回退到 socket 地址。
 */
export function resolveClientIp(request: ClientAddressRequest, trustProxy: boolean): string {
  const socketAddress = normalizeIp(request.socket.remoteAddress ?? "");
  if (!trustProxy) return socketAddress === "" ? "unknown" : socketAddress;
  const forwarded = request.headers["x-forwarded-for"];
  const headerValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (headerValue === undefined) return socketAddress === "" ? "unknown" : socketAddress;
  const first = headerValue.split(",")[0] ?? "";
  const forwardedAddress = normalizeIp(first);
  if (forwardedAddress !== "") return forwardedAddress;
  return socketAddress === "" ? "unknown" : socketAddress;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 带 Origin 的请求必须同源：配置 PUBLIC_ORIGIN 时精确匹配该 origin，
 * 否则按 Origin 的 host 与请求 Host 比较。没有 Origin 的请求（非浏览器）放行。
 */
export function isOriginAllowed(
  requestOrigin: string | undefined,
  hostHeader: string | undefined,
  publicOrigin: string | null,
): boolean {
  if (requestOrigin === undefined || requestOrigin.trim() === "") return true;
  const origin = normalizeOrigin(requestOrigin);
  if (origin === null) return false;
  if (publicOrigin !== null) return origin === normalizeOrigin(publicOrigin);
  if (hostHeader === undefined || hostHeader.trim() === "") return false;
  const originHost = new URL(origin).host.toLowerCase();
  return originHost === hostHeader.trim().toLowerCase();
}

export function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(";")[0];
  return mediaType !== undefined && mediaType.trim().toLowerCase() === "application/json";
}

export function readBearerToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  const token = match?.[1];
  return token === undefined || token.length === 0 ? null : token;
}
