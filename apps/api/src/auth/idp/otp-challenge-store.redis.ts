import type {
  OtpChallenge,
  OtpChallengeStore,
} from "./otp-challenge-store.types.js";

/**
 * The slice of a Redis client this store needs — narrowed (as
 * {@link RedisSessionStore}'s `RedisLike` narrows `ioredis`) so the adapter is
 * unit-testable without a live Redis. `ioredis`'s `set(key, val, "EX", seconds)`,
 * `get`, and `del` satisfy it.
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
}

/** Key namespace for in-flight OTP-login challenges. */
const KEY_PREFIX = "ds:otp-challenge:";

/**
 * Garbage-collection bound for an armed challenge, NOT the auth expiry
 * authority — Zitadel alone owns code expiry, attempt limits, and lockout
 * (EARS-15; a challenge consumed or rejected there is dead regardless of this
 * key). The TTL only stops abandoned challenges (code requested, never
 * submitted) from accumulating in Redis forever; it is deliberately generous so
 * it can never expire a challenge Zitadel would still accept.
 */
export const OTP_CHALLENGE_TTL_SECONDS = 600;

/**
 * Redis-backed {@link OtpChallengeStore} (#410) — the production binding, bound
 * by {@link IdpModule} only when `REDIS_URL` is set (mirroring
 * `SessionModule`'s `SESSION_STORE` choice). With the challenge in Redis the
 * two HTTP requests of an OTP login (`request*Otp` → `loginWith*Otp`) no longer
 * need to land on the same api instance — the fold that makes the BFF
 * scale-out-safe. Like {@link RedisSessionStore}, its socket paths are
 * exercised by integration runs against a real Redis; unit specs drive it
 * through a {@link RedisLike} stub (CI has no Redis service).
 */
export class RedisOtpChallengeStore implements OtpChallengeStore {
  constructor(private readonly redis: RedisLike) {}

  async set(key: string, challenge: OtpChallenge): Promise<void> {
    await this.redis.set(
      `${KEY_PREFIX}${key}`,
      JSON.stringify(challenge),
      "EX",
      OTP_CHALLENGE_TTL_SECONDS,
    );
  }

  async get(key: string): Promise<OtpChallenge | undefined> {
    const raw = await this.redis.get(`${KEY_PREFIX}${key}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as OtpChallenge;
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${key}`);
  }
}
