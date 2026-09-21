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
/**
 * The three PLATFORM ceilings — the ones ops may override per environment
 * ({@link RATE_LIMIT_ENV_VARS}). Split out from {@link RateLimitThresholds} so
 * that "a ceiling an env var can move" stays exactly these three, whatever else
 * the thresholds object grows.
 */
export interface RateLimitCeilings {
  perUserPer15Min: number;
  perIpPer15Min: number;
  perAsnPerHour: number;
}

export interface RateLimitThresholds extends RateLimitCeilings {
  /**
   * Per-SCOPE replacement of {@link RateLimitCeilings.perIpPer15Min} (#2294).
   *
   * {@link RateLimitContext.scope} already partitions the source-address KEYS
   * into disjoint buckets; this is the one thing it did not carry — a bucket's
   * own CEILING. A surface whose legitimate traffic differs by an order of
   * magnitude from an auth door's (the public congress intake: one corporate
   * NAT submitting a whole department's sign-ups, 044 EARS-1) needs its own
   * number, and expressing that as a raised PLATFORM default would raise it for
   * register, login and reset too — the opposite of what the scope exists for.
   *
   * A scope with no entry here falls back to the platform ceiling, so adding a
   * scope is never silently unlimited, and an unscoped request never reads this
   * map at all.
   */
  scopedPerIpPer15Min: Readonly<Record<string, number>>;
}

/**
 * 044 EARS-1 (#2294) — the scope tag the public congress intake keys its
 * source-address windows under, so its traffic can neither exhaust the budget
 * the 003 auth doors share nor be exhausted by them.
 */
export const CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE = "congress:sign-up";

/**
 * 044 EARS-1 / V-22 — the congress intake's own per-client-address ceiling:
 * 60 submissions per 15 minutes, three times the platform default.
 *
 * The number is sized for the legitimate shape of this surface rather than for
 * an auth door's: a congress landing page is shared inside hospitals and
 * departments, so many genuine participants submit from ONE public address
 * within minutes, while a single participant submits once. The platform default
 * of 20 stays exactly where it is (it bounds credential spraying, which this
 * surface cannot do — it holds no password).
 */
export const CONGRESS_SIGN_UP_PER_IP_15MIN = 60;

/**
 * EARS-13 defaults (ADR-0001 §7): per-user 10/15 min, per-IP 20/15 min, per-ASN
 * 100/h. The per-user ceiling was raised 5 → 10 (#222) so a legitimate
 * forgot-password → login recovery flow (a reset request, a few login typos, then
 * success) is not throttled mid-journey; a success additionally FORGIVES the
 * per-user window ({@link RateLimitService.reset}), so the counter never strands a
 * recovering user. The per-IP / per-ASN ceilings are unchanged (an attacker
 * spraying many identifiers from one origin / network still hits those).
 */
export const DEFAULT_RATE_LIMIT_THRESHOLDS: RateLimitThresholds = {
  perUserPer15Min: 10,
  perIpPer15Min: 20,
  perAsnPerHour: 100,
  scopedPerIpPer15Min: {
    [CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE]: CONGRESS_SIGN_UP_PER_IP_15MIN,
  },
};

/** Monotonic-enough wall clock (ms). Injected so window resets are testable. */
export type Clock = () => number;

/**
 * The request dimensions one auth attempt is keyed by. `ip` is always present
 * (Fastify supplies it); `identifier` (the submitted email/phone) and `asn` (the
 * edge-supplied `x-asn`) are optional — when absent their window is skipped, so
 * the limiter degrades rather than refusing blindly (mirrors the SMS budget).
 *
 * `scope` (#1646) partitions the SOURCE-ADDRESS windows (per-IP, per-ASN) into a
 * named bucket. Absent — the shape every 003 auth endpoint uses — the source
 * address alone is the key, so the whole auth surface keeps sharing one budget,
 * which is the EARS-13 intent: an attacker spraying identifiers across register,
 * login and reset from one origin must meet a single ceiling. A non-auth
 * consumer supplies its own tag instead, so its traffic can never exhaust the
 * key the auth endpoints consume, nor be exhausted by them. The per-user window
 * is never scoped: an identifier's budget is deliberately shared across the
 * endpoints that submit it (011 design §6).
 */
export interface RateLimitContext {
  ip: string;
  identifier?: string | undefined;
  asn?: string | undefined;
  scope?: string | undefined;
}

/** DI token for {@link RateLimitThresholds} (env-overridable in the module). */
export const RATE_LIMIT_THRESHOLDS = Symbol("RATE_LIMIT_THRESHOLDS");

/** DI token for the {@link Clock} (defaults to `Date.now`; a fake in tests). */
export const RATE_LIMIT_CLOCK = Symbol("RATE_LIMIT_CLOCK");

/** Nest metadata key the `@RateLimited` decorator writes and the guard reads. */
export const RATE_LIMITED_KEY = "ds:rate-limited";

/**
 * What `@RateLimited` writes into {@link RATE_LIMITED_KEY}: `true` for the
 * shared auth budget (every 003 call site), or a scope tag for a consumer that
 * must own its bucket (#1646). The guard only ever tests truthiness to decide
 * whether the handler is marked, so the two forms are interchangeable there.
 */
export type RateLimitedMarker = true | string;

/**
 * Scope tag for the storefront's public specialty-choice POST (#1646, audit D2
 * of #1639) — the first non-auth consumer of the EARS-13 limiter. Named as a
 * constant so the route and its tests key on one literal.
 */
export const SPECIALTY_CHOICE_RATE_LIMIT_SCOPE = "storefront:specialty-choice";

/**
 * Env var name per ceiling for the ops / load-test-window overrides (#1076,
 * prep for the #873 phase-2 auth-burst window). The DI token's doc comment has
 * always said "env-overridable in the module"; these names make that true
 * without changing the EARS-13 defaults or semantics. Each is optional and
 * independent: unset ⇒ that ceiling's default; a valid positive integer ⇒
 * overrides ONLY that field.
 */
export const RATE_LIMIT_ENV_VARS = {
  perUserPer15Min: "RATE_LIMIT_PER_USER_15MIN",
  perIpPer15Min: "RATE_LIMIT_PER_IP_15MIN",
  perAsnPerHour: "RATE_LIMIT_PER_ASN_1H",
} as const satisfies Record<keyof RateLimitCeilings, string>;

/** The three raw env values the {@link resolveRateLimitThresholds} factory reads. */
export type RateLimitEnv = {
  [K in (typeof RATE_LIMIT_ENV_VARS)[keyof typeof RATE_LIMIT_ENV_VARS]]?:
    | string
    | undefined;
};

/** A rejected override: which env var, and the raw value that failed validation. */
export interface RateLimitOverrideRejection {
  envVar: string;
  rawValue: string;
}

/**
 * Resolve the effective EARS-13 thresholds by overlaying only the env vars that
 * hold a valid **positive integer** onto {@link DEFAULT_RATE_LIMIT_THRESHOLDS}
 * (#1076). The contract is deliberately fail-SAFE, not fail-closed:
 *
 * - unset / empty / whitespace ⇒ that ceiling keeps its default (no rejection);
 * - a valid positive integer ⇒ overrides ONLY that field;
 * - malformed / ≤0 / non-integer ⇒ the default for that field, reported via
 *   `onReject` (the module logs one loud warn naming the var + value).
 *
 * A fat-fingered load-test-window var can therefore only ever tighten or keep a
 * ceiling — never open an unlimited or disabled limiter, and never crash api
 * boot (which a coerced positive-int schema field would do on a typo). When all
 * three are unset the result is byte-identical to the defaults — a fresh object,
 * so the caller can never mutate the shared default.
 */
export function resolveRateLimitThresholds(
  env: RateLimitEnv,
  onReject: (rejection: RateLimitOverrideRejection) => void = () => {},
): RateLimitThresholds {
  const resolved: RateLimitThresholds = { ...DEFAULT_RATE_LIMIT_THRESHOLDS };
  for (const field of Object.keys(
    RATE_LIMIT_ENV_VARS,
  ) as (keyof RateLimitCeilings)[]) {
    const envVar = RATE_LIMIT_ENV_VARS[field];
    const rawValue = env[envVar];
    if (rawValue === undefined || rawValue.trim() === "") continue; // unset ⇒ default
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      onReject({ envVar, rawValue }); // malformed / ≤0 / non-integer ⇒ default
      continue;
    }
    resolved[field] = parsed;
  }
  return resolved;
}
