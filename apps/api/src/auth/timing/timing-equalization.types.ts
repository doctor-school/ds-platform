/**
 * Timing-equalization contract (EARS-16, ADR-0001 §7).
 *
 * Enumeration resistance has a timing dimension: even with identical status +
 * body, an existing-account path that does more work (a password verify, a
 * session establish, extra DB writes) than an unknown-account path leaks
 * existence through latency. EARS-16 caps that delta at ≤ 50 ms. The
 * {@link TimingEqualizationInterceptor} closes it by flooring every decorated
 * response — success *and* failure — to a fixed minimum duration, so both paths
 * resolve at ≈ the floor and their delta collapses to jitter.
 */

/** Monotonic-enough wall clock (ms). Injected so the interceptor is testable. */
export type Clock = () => number;

/**
 * The minimum duration (ms) every decorated auth response is floored to. Must
 * exceed the heaviest path's own time for the equalization to hold; the default
 * covers the BFF-side delta against the fake IdP. Calibrating it to ≥ the p99 of
 * the heaviest real-Zitadel path is an ops tuning task (documented seam) — it is
 * injected, not hard-coded, precisely so a deployment can raise it.
 */
export const DEFAULT_TIMING_FLOOR_MS = 40;

/** DI token for the timing floor (env/deployment-overridable in the module). */
export const TIMING_FLOOR_MS = Symbol("TIMING_FLOOR_MS");

/** DI token for the {@link Clock} (defaults to `Date.now`; a fake in tests). */
export const TIMING_CLOCK = Symbol("TIMING_CLOCK");

/** Nest metadata key the `@TimingEqualized` decorator writes and the interceptor reads. */
export const TIMING_EQUALIZED_KEY = "ds:timing-equalized";
