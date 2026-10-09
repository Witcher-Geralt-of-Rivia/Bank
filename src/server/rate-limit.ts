import "server-only";
import { RateLimitedError } from "@/lib/errors";

export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Sliding-window rate limiter.
 *
 * State lives in the memory of one server instance, which is enough to blunt
 * credential stuffing and accidental request storms in a single-region
 * deployment. The interface is deliberately tiny (`check`, `reset`) so a
 * shared store such as Redis can replace the Map without touching callers.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
  }
}

const store = globalThis as typeof globalThis & {
  __alderaLimiters?: Record<string, RateLimiter>;
};

function limiter(name: string, limit: number, windowMs: number): RateLimiter {
  const limiters = (store.__alderaLimiters ??= {});
  return (limiters[name] ??= new RateLimiter({ limit, windowMs }));
}

export const limiters = {
  /** Sign-in attempts per email + address. */
  get login() {
    return limiter("login", 8, 5 * 60_000);
  },
  /** Registrations and password-reset requests per address. */
  get signup() {
    return limiter("signup", 6, 15 * 60_000);
  },
  /** Money movements per user. */
  get movement() {
    return limiter("movement", 30, 60_000);
  },
  /** Other state-changing requests per user. */
  get mutation() {
    return limiter("mutation", 60, 60_000);
  },
};

/** Throws `RateLimitedError` when the key has exceeded its allowance. */
export function enforceRateLimit(limiter: RateLimiter, key: string): void {
  const decision = limiter.check(key);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
}
