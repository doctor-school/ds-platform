import {
  RATE_LIMIT_THRESHOLDS,
  type RateLimitThresholds,
} from "../../src/auth/rate-limit/rate-limit.types.js";

/**
 * Effectively-unlimited EARS-13 thresholds for functional e2e suites.
 *
 * The global {@link RateLimitGuard} is stateful per app instance; a functional
 * suite reusing one app makes far more than the production per-IP ceiling (20 /
 * 15 min) of requests from the loopback address, so without relaxing the limiter
 * it would start returning 429 mid-suite. The limiter's own behaviour is proven
 * by the unit spec + the dedicated `abuse-limits.e2e` (which binds LOW
 * thresholds), so here it must simply not interfere.
 */
export const RELAXED_RATE_LIMIT: RateLimitThresholds = {
  perUserPer15Min: 1_000_000,
  perIpPer15Min: 1_000_000,
  perAsnPerHour: 1_000_000,
};

export { RATE_LIMIT_THRESHOLDS };
