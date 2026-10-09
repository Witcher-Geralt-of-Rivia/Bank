import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * Stored format: `scrypt$N$r$p$salt$hash` (base64url). The parameters travel
 * with the hash so they can be raised later without invalidating old hashes.
 */

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { N: n, r, p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64url"),
    Number(n),
    Number(r),
    Number(p),
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A valid hash of an unknowable password. Verifying against it when an email
 * is not registered keeps response times the same for known and unknown
 * accounts.
 */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  return (decoy ??= hashPassword(randomBytes(24).toString("hex")));
}
