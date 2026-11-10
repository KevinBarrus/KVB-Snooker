const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

/** 存储与查询统一使用 trim + lowercase；无效邮箱返回 null，交由调用方映射为凭证错误。 */
export function normalizeEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}
