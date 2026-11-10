import { createHash, timingSafeEqual } from "node:crypto";

/** 内部令牌比较：先哈希到等长再 timingSafeEqual，避免长度与内容时序泄露。 */
export function isInternalTokenValid(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
