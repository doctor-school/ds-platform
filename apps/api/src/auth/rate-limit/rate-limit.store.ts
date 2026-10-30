/**
 * Where the EARS-13 windows live (003 EARS-13 / EARS-15, ADR-0001 §7, #3539).
 *
 * With the IdP lockout gone the per-user, per-IP and per-ASN windows are the
 * only bound on password guessing, so they must survive an api restart and be
 * shared by every api replica: {@link RateLimitModule} binds the Redis store
 * when `REDIS_URL` is set (production), the in-memory store otherwise (the CI
 * / dev default and the unit-test double) — the SESSION_STORE / OTP-challenge
 * split. {@link RateLimitService} owns the policy (which windows, keys,
 * ceilings); a store owns only atomic window arithmetic on the limiter's clock.
 */

/** One window an attempt must fit: its store key, length and ceiling. */
export interface RateLimitWindowSpec {
  key: string;
  windowMs: number;
  limit: number;
}

/**
 * {@link RateLimitStore.consume}'s answer: every window's reset time after the
 * unit was taken, or the first full window (its index and reset time).
 */
export type RateLimitStoreResult =
  | { allowed: true; resetAtMs: number[] }
  | { allowed: false; index: number; resetAtMs: number };

export interface RateLimitStore {
  /**
   * Atomically: when every window has room at `nowMs`, take one unit from each
   * (opening a fresh window where none is live); otherwise take nothing and
   * name the first full window. No read-modify-write race between concurrent
   * attempts on any replica.
   */
  consume(
    windows: readonly RateLimitWindowSpec[],
    nowMs: number,
  ): Promise<RateLimitStoreResult>;

  /**
   * `true` exactly once per live window instance (`key` + its `resetAtMs`):
   * the window "tripped" (003 EARS-15 — one audit row per tripped window,
   * across replicas).
   */
  claimTrip(key: string, resetAtMs: number, nowMs: number): Promise<boolean>;

  /** Forget a window (a success forgives the per-user window, #222). */
  clear(key: string): Promise<void>;

  /**
   * Give back one unit, only to the live window that rolls over at
   * `consumedResetAtMs` and only when it holds one (#2684).
   */
  refund(key: string, consumedResetAtMs: number, nowMs: number): Promise<void>;
}

/** DI token for the {@link RateLimitStore} port. */
export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");
