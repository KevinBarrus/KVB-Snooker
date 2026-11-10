import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt";
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 1024;

// 合法负载恒定耗时：邮箱不存在时对一个固定假哈希执行同参数 scrypt，避免枚举时序差。
const DUMMY_PASSWORD_HASH = `${HASH_PREFIX}$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$` +
  `${"0".repeat(SCRYPT_SALT_LENGTH * 2)}$${"0".repeat(SCRYPT_KEY_LENGTH * 2)}`;

interface ScryptParameters {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
}

interface DecodedPasswordHash {
  readonly parameters: ScryptParameters;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

function formatHash(salt: Buffer, key: Buffer): string {
  return [
    HASH_PREFIX,
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt.toString("hex"),
    key.toString("hex"),
  ].join("$");
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function decodePasswordHash(encoded: string): DecodedPasswordHash | null {
  const parts = encoded.split("$");
  if (parts.length !== 6) return null;
  const [prefix, costText, blockSizeText, parallelizationText, saltHex, keyHex] = parts;
  if (prefix !== HASH_PREFIX || !costText || !blockSizeText || !parallelizationText || !saltHex || !keyHex) {
    return null;
  }
  const cost = parsePositiveInteger(costText);
  const blockSize = parsePositiveInteger(blockSizeText);
  const parallelization = parsePositiveInteger(parallelizationText);
  if (cost === null || blockSize === null || parallelization === null) return null;
  if (!isPowerOfTwo(cost) || cost < 1024 || cost > 65536) return null;
  if (blockSize < 1 || blockSize > 32) return null;
  if (parallelization < 1 || parallelization > 16) return null;
  if (saltHex.length !== SCRYPT_SALT_LENGTH * 2 || !/^[0-9a-f]+$/.test(saltHex)) return null;
  if (keyHex.length !== SCRYPT_KEY_LENGTH * 2 || !/^[0-9a-f]+$/.test(keyHex)) return null;
  return {
    parameters: { cost, blockSize, parallelization },
    salt: Buffer.from(saltHex, "hex"),
    key: Buffer.from(keyHex, "hex"),
  };
}

/** 生成 `scrypt$N$r$p$salt$hash` 格式哈希；salt 每次随机。 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("password too long");
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const key = await deriveKey(password, salt, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  });
  return formatHash(salt, key);
}

/** 格式非法或参数越界一律返回 false，不抛数据库内容，也不跳过计时保护。 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const decoded = decodePasswordHash(encoded);
  if (decoded === null) return false;
  const key = await deriveKey(password, decoded.salt, decoded.parameters);
  if (key.length !== decoded.key.length) return false;
  return timingSafeEqual(key, decoded.key);
}

/** 用户不存在时对固定假哈希做等价开销校验；返回值恒为 false。 */
export async function verifyPasswordOrDummy(password: string, encoded: string | null): Promise<boolean> {
  const matched = await verifyPassword(password, encoded ?? DUMMY_PASSWORD_HASH);
  return encoded !== null && matched;
}
