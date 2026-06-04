/**
 * Auth rate-limit contract (EARS-13, ADR-0001 §7).
 *
 * The mandatory v1 security baseline rate-limits the auth surface per-user (the
 * submitted identifier), per-IP, and per-ASN. It is the request-rate sibling of
 * the EARS-14 SMS toll-fraud budget — same fixed-window counter shape — but
 * gates *every* decorated auth endpoint, not just SMS sends. A refusal is a
 * generic throttled response that names no threshold and no account, so it is
 * not an existence oracle (EARS-13/16).
 */

/**
 * The three EARS-13 ceilings. Per-user and per-IP are 15-minute windows; per-ASN
 * is hourly. Injected (not hard-coded) so a deployment can tighten them and the
 * e2e can drive the boundary without 20 real requests.
 */
export interface RateLimitThresholds {
  perUserPer15Min: number;
  perIpPer15Min: number;
  perAsnPerHour: number;
}

/** EARS-13 defaults (ADR-0001 §7): per-user 5/15 min, per-IP 20/15 min, per-ASN 100/h. */
export const DEFAULT_RATE_LIMIT_THRESHOLDS: RateLimitThresholds = {
  perUserPer15Min: 5,
  perIpPer15Min: 20,
  perAsnPerHour: 100,
};

/** Monotonic-enough wall clock (ms). Injected so window resets are testable. */
export type Clock = () => number;

/**
 * The request dimensions one auth attempt is keyed by. `ip` is always present
 * (Fastify supplies it); `identifier` (the submitted email/phone) and `asn` (the
 * edge-supplied `x-asn`) are optional — when absent their window is skipped, so
 * the limiter degrades rather than refusing blindly (mirrors the SMS budget).
 */
export interface RateLimitContext {
  ip: string;
  identifier?: string | undefined;
  asn?: string | undefined;
}

/** DI token for {@link RateLimitThresholds} (env-overridable in the module). */
export const RATE_LIMIT_THRESHOLDS = Symbol("RATE_LIMIT_THRESHOLDS");

/** DI token for the {@link Clock} (defaults to `Date.now`; a fake in tests). */
export const RATE_LIMIT_CLOCK = Symbol("RATE_LIMIT_CLOCK");

/** Nest metadata key the `@RateLimited` decorator writes and the guard reads. */
export const RATE_LIMITED_KEY = "ds:rate-limited";
