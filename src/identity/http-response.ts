import type { ServerResponse } from "node:http";

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function writeHeaders(
  response: ServerResponse,
  statusCode: number,
  extraHeaders: Readonly<Record<string, string>>,
): void {
  const headers: Record<string, string> = { ...COMMON_HEADERS, ...extraHeaders };
  response.writeHead(statusCode, headers);
}

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): number {
  const payload = JSON.stringify(body);
  writeHeaders(response, statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload, "utf8")),
    ...extraHeaders,
  });
  response.end(payload);
  return statusCode;
}

export function writeError(
  response: ServerResponse,
  statusCode: number,
  error: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): number {
  return writeJson(response, statusCode, { error }, extraHeaders);
}

export function writeNoContent(
  response: ServerResponse,
  extraHeaders: Readonly<Record<string, string>> = {},
): number {
  writeHeaders(response, 204, extraHeaders);
  response.end();
  return 204;
}
