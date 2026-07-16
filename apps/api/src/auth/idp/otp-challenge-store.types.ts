/**
 * The server-side half of one in-flight passwordless OTP login (EARS-6/7): the
 * not-yet-checked Zitadel session armed by `request*Otp` (request #1) that the
 * matching `loginWith*Otp` (request #2 — a SEPARATE HTTP request) verifies the
 * code against. The {@link IdpClient} port passes only the `identifier` on both
 * hops (request #1 returns `void` for enumeration-safety, EARS-16 — no handle
 * may cross the port without leaking an existence oracle), so the BFF carries
 * this bridge itself, keyed by the lowercased identifier.
 */
export interface OtpChallenge {
  /** Zitadel Session-v2 id of the armed (unchecked) session. */
  sessionId: string;
  /** The not-yet-checked session token the verify hop must present. */
  sessionToken: string;
  /** Zitadel user id, threaded onto the checked {@link IdpSession} handle. */
  sub: string;
}

/**
 * Shared store for {@link OtpChallenge} records (#410) — the design-§3-style
 * seam that lets the challenge armed on one api instance be verified on another
 * (scale-out): request #1 and request #2 are two distinct HTTP requests with no
 * instance affinity. Keys are passed pre-normalized (lowercased identifier) by
 * the caller; the store never re-normalizes.
 *
 * Bound by {@link IdpModule}: Redis-backed when `REDIS_URL` is configured (the
 * production binding), else the in-memory fake — the same single-place backend
 * choice as `SESSION_STORE` in `SessionModule`.
 */
export interface OtpChallengeStore {
  /** Arm (or re-arm, last-write-wins) the challenge for `key`. */
  set(key: string, challenge: OtpChallenge): Promise<void>;
  /** Read the live challenge for `key`; `undefined` on a miss. */
  get(key: string): Promise<OtpChallenge | undefined>;
  /** Consume the challenge (single-use — called only on a successful verify). */
  delete(key: string): Promise<void>;
}

/** Nest DI token for the {@link OtpChallengeStore} binding (see {@link IdpModule}). */
export const OTP_CHALLENGE_STORE = Symbol("OTP_CHALLENGE_STORE");
