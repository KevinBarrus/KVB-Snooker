import type { IncomingMessage } from "node:http";
import type { PlayerAccess } from "./player-access.js";

export function createPlayerAccess(options: {
  readonly origin: string; readonly identityUrl: string; readonly internalToken: string; readonly cookieName?: string;
}): PlayerAccess {
  const origin = new URL(options.origin);
  const identity = new URL("/api/internal/session/verify", options.identityUrl);
  if (!options.internalToken || !["http:", "https:"].includes(origin.protocol) ||
      !["http:", "https:"].includes(identity.protocol) || origin.origin !== options.origin) throw new Error("Invalid player service configuration");
  return {
    origin: origin.origin,
    async authenticate(request: IncomingMessage) {
      const name = options.cookieName ?? "snk_session";
      const values = (request.headers.cookie ?? "").split(";").map(part => part.trim())
        .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
      if (values.length !== 1 || !/^[A-Za-z0-9_-]{32,128}$/.test(values[0])) return null;
      const response = await fetch(identity, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(2500),
        headers: { "content-type": "application/json", authorization: `Bearer ${options.internalToken}` },
        body: JSON.stringify({ token: values[0] })
      });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Identity service unavailable");
      const user: unknown = await response.json();
      if (!user || typeof user !== "object" || !("userId" in user) || !("displayName" in user) || !("role" in user) ||
          typeof user.userId !== "string" || !user.userId || typeof user.displayName !== "string" ||
          !user.displayName || user.displayName.length > 80 || !["player", "admin"].includes(String(user.role))) {
        throw new Error("Invalid identity response");
      }
      return { userId: user.userId, name: user.displayName };
    }
  };
}
