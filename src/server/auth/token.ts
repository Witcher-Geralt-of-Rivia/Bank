/**
 * Session token settings shared by the server and the request proxy.
 * Kept free of framework imports so it can load in either runtime.
 */

export const SESSION_COOKIE = "aldera_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * The HS256 signing key.
 *
 * Production requires `SESSION_SECRET`. Development falls back to a fixed,
 * clearly-labelled value so the app runs without any setup; that fallback is
 * refused when NODE_ENV is "production".
 */
export function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 32) return new TextEncoder().encode(secret);

  if (process.env.NODE_ENV === "production") {
    throw new ConfigurationError(
      "SESSION_SECRET is not configured. Set it to a random value of at least 32 characters.",
    );
  }
  return new TextEncoder().encode("aldera-development-only-session-key-not-for-production");
}

export function isSessionConfigured(): boolean {
  try {
    sessionKey();
    return true;
  } catch {
    return false;
  }
}
