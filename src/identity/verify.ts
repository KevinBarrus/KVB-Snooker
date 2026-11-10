import type { Pool } from "pg";
import { authenticateSession } from "./identity-service.js";
import type { VerifiedIdentity } from "./types.js";

/** 未来房间/存档服务只依赖该窄接口，不依赖数据库实现。 */
export interface SessionVerifier {
  verify(token: string): Promise<VerifiedIdentity | null>;
}

export function createDatabaseSessionVerifier(options: {
  readonly pool: Pool;
  readonly now?: () => Date;
}): SessionVerifier {
  const clock = options.now ?? (() => new Date());
  return {
    async verify(token: string): Promise<VerifiedIdentity | null> {
      const view = await authenticateSession(options.pool, token, clock());
      if (view === null) return null;
      return { userId: view.user.id, displayName: view.user.displayName, role: view.user.role };
    },
  };
}
