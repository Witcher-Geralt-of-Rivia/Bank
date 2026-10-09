import "server-only";
import { createHash, randomBytes } from "node:crypto";

export type IdPrefix = "usr" | "acc" | "ben" | "txn" | "aud" | "ntf";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Prefixed, unguessable identifier, e.g. `txn_9f2c41d07ab35e6c8d10`. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

/** Stable identifier derived from a seed, used for deterministic demo data. */
export function seededId(prefix: IdPrefix, seed: string): string {
  const digest = createHash("sha256").update(`${prefix}:${seed}`).digest("hex");
  return `${prefix}_${digest.slice(0, 20)}`;
}

function toReference(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 10; i++) out += CROCKFORD[bytes[i] % 32];
  return `TX-${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Short human-friendly transaction reference, e.g. `TX-7Q4M9-K2P0X`. */
export function newReference(): string {
  return toReference(randomBytes(10));
}

export function seededReference(seed: string): string {
  return toReference(createHash("sha256").update(`ref:${seed}`).digest());
}

/** Deterministic JSON: object keys are sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Fingerprint of a request payload, stored next to its idempotency key. */
export function fingerprint(payload: Record<string, unknown>): string {
  return sha256(stableStringify(payload));
}
