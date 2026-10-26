import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

export const BCRYPT_COST = 10;

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const TEMPORARY_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function isPasswordHash(stored: unknown): boolean {
  return typeof stored === "string" && BCRYPT_HASH.test(stored);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(String(plain), BCRYPT_COST);
}

/**
 * Checks a login password against the stored value. Rows written before hashing hold plaintext;
 * those are compared in constant time and reported with `needsUpgrade` so the caller re-saves a hash.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (stored == null || stored === "") return { ok: false, needsUpgrade: false };
  if (isPasswordHash(stored)) {
    return { ok: await bcrypt.compare(String(plain), stored), needsUpgrade: false };
  }
  // Digests give equal-length buffers, so timingSafeEqual does not leak the stored length.
  const left = crypto.createHash("sha256").update(String(plain)).digest();
  const right = crypto.createHash("sha256").update(stored).digest();
  const ok = crypto.timingSafeEqual(left, right);
  return { ok, needsUpgrade: ok };
}

export function generateTemporaryPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMPORARY_PASSWORD_CHARS[crypto.randomInt(TEMPORARY_PASSWORD_CHARS.length)];
  }
  return out;
}
