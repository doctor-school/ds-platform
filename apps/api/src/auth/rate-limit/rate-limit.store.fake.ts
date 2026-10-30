import type {
  RateLimitStore,
  RateLimitStoreResult,
  RateLimitWindowSpec,
} from "./rate-limit.store.js";

interface Window {
  count: number;
  resetAtMs: number;
}

/**
 * In-memory {@link RateLimitStore} — the binding when no `REDIS_URL` is
 * configured (CI `api-e2e`, a dev stand without Redis) and the unit-test
 * double. Single-process by construction: the same arithmetic as the Redis
 * store, without its restart and replica sharing.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private readonly trips = new Map<string, number>();

  consume(
    specs: readonly RateLimitWindowSpec[],
    nowMs: number,
  ): Promise<RateLimitStoreResult> {
    // Check every window before mutating any: a refused attempt takes nothing.
    for (const [index, s] of specs.entries()) {
      const w = this.live(s.key, nowMs);
      if (w !== undefined && w.count >= s.limit) {
        return Promise.resolve({
          allowed: false,
          index,
          resetAtMs: w.resetAtMs,
        });
      }
    }
    const resetAtMs = specs.map((s) => {
      const w = this.live(s.key, nowMs);
      if (w === undefined) {
        const fresh = { count: 1, resetAtMs: nowMs + s.windowMs };
        this.windows.set(s.key, fresh);
        return fresh.resetAtMs;
      }
      w.count++;
      return w.resetAtMs;
    });
    return Promise.resolve({ allowed: true, resetAtMs });
  }

  claimTrip(key: string, resetAtMs: number, nowMs: number): Promise<boolean> {
    const tripKey = `${key}@${resetAtMs}`;
    const expiresAt = this.trips.get(tripKey);
    if (expiresAt !== undefined && nowMs < expiresAt) {
      return Promise.resolve(false);
    }
    this.trips.set(tripKey, resetAtMs);
    return Promise.resolve(true);
  }

  clear(key: string): Promise<void> {
    this.windows.delete(key);
    return Promise.resolve();
  }

  refund(key: string, consumedResetAtMs: number, nowMs: number): Promise<void> {
    const w = this.live(key, nowMs);
    if (w !== undefined && w.resetAtMs === consumedResetAtMs && w.count > 0) {
      w.count--;
    }
    return Promise.resolve();
  }

  private live(key: string, nowMs: number): Window | undefined {
    const w = this.windows.get(key);
    return w === undefined || nowMs >= w.resetAtMs ? undefined : w;
  }
}
