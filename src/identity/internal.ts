import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createDatabaseSessionVerifier } from "./verify.js";
import { MAX_JSON_BODY_BYTES, readJsonBody, readSessionTokenBody } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";
import { isJsonContentType, readBearerToken } from "./request-guard.js";
import { isInternalTokenValid } from "./secret-token.js";

export interface InternalVerifyContext {
  readonly pool: Pool;
  readonly internalToken: string;
  readonly now: Date;
}

/**
 * 仅当 INTERNAL_TOKEN 非空时由路由器暴露；公开代理必须屏蔽 /api/internal/*。
 * 请求方必须携带 `Authorization: Bearer <INTERNAL_TOKEN>`。
 */
export async function handleInternalVerify(
  request: IncomingMessage,
  response: ServerResponse,
  context: InternalVerifyContext,
): Promise<number> {
  const bearer = readBearerToken(request.headers.authorization);
  if (bearer === null || !isInternalTokenValid(bearer, context.internalToken)) {
    return writeError(response, 401, "unauthorized");
  }
  if (!isJsonContentType(request.headers["content-type"])) {
    return writeError(response, 415, "unsupported_media_type");
  }
  const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
  if (!body.ok) {
    return body.failure === "too_large"
      ? writeError(response, 413, "payload_too_large")
      : writeError(response, 400, "invalid_request");
  }
  const token = readSessionTokenBody(body.value);
  if (token === null) return writeError(response, 400, "invalid_request");
  const verifier = createDatabaseSessionVerifier({ pool: context.pool, now: () => context.now });
  const identity = await verifier.verify(token);
  if (identity === null) return writeError(response, 401, "unauthenticated");
  return writeJson(response, 200, identity);
}
