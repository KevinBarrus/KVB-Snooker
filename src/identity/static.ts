import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { writeError } from "./http-response.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".babylon": "application/octet-stream",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "SAMEORIGIN",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join("; "),
};

export function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function isInsideRoot(rootDir: string, candidatePath: string): boolean {
  return candidatePath === rootDir || candidatePath.startsWith(rootDir + sep);
}

function resolveRequestedPath(rootDir: string, urlPath: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidatePath = resolve(rootDir, relativePath);
  return isInsideRoot(rootDir, candidatePath) ? candidatePath : null;
}

export interface StaticFileResult {
  readonly status: number;
}

/**
 * 服务 STATIC_DIR 下的文件；GET / 映射 index.html，缺失返回 404。
 * 返回 null 表示该方法不由静态服务处理（调用方回 405）。
 */
export async function serveStaticFile(
  rootDir: string,
  urlPath: string,
  method: string,
  response: ServerResponse,
): Promise<StaticFileResult | null> {
  if (method !== "GET" && method !== "HEAD") return null;
  const resolvedRoot = resolve(rootDir);
  const filePath = resolveRequestedPath(resolvedRoot, urlPath);
  if (filePath === null) return { status: writeError(response, 404, "not_found") };
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    return { status: writeError(response, 404, "not_found") };
  }
  if (!fileInfo.isFile()) return { status: writeError(response, 404, "not_found") };
  const isHtml = extname(filePath).toLowerCase() === ".html";
  const cacheControl = isHtml ? "no-store" : "public, max-age=31536000, immutable";
  const headers: Record<string, string> = {
    ...STATIC_SECURITY_HEADERS,
    "content-type": contentTypeForPath(filePath),
    "content-length": String(fileInfo.size),
    "cache-control": cacheControl,
  };
  response.writeHead(200, headers);
  if (method === "HEAD") {
    response.end();
    return { status: 200 };
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    response.destroy();
  });
  stream.pipe(response);
  return { status: 200 };
}
