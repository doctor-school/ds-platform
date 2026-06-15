import { createHmac } from "node:crypto";

/**
 * Per-address throttle for the EARS-23 account-exists notice (anti
 * inbox-flooding): the registration form must not be weaponisable to flood a
 * victim's inbox with notice emails. {@link tryAcquire} answers one question —
 * may a notice be sent for this email right now? — and is `true` only the first
 * time within the window.
 *
 * The marker is **ephemeral**: a short-TTL Redis key that self-expires, NEVER a
 * persistent / queryable per-email record. The key is `register-notice:<HMAC>`
 * where the HMAC reuses the #141 audit pepper + the same `hashIdentifier()`
 * construction, so the key is non-reversible (a bare digest over a low-entropy
 * email space would be a reproducible existence oracle).
 */
export interface RegisterNoticeThrottle {
  /**
   * `true` ⇒ a notice may be sent for `email` (and the window is now claimed);
   * `false` ⇒ a recent notice already went out, suppress this one. Implemented as
   * an atomic `SET key 1 NX EX <ttl>` — "allowed" only when the set succeeded.
   */
  tryAcquire(email: string): Promise<boolean>;
}

/** DI token for the {@link RegisterNoticeThrottle} port. */
export const REGISTER_NOTICE_THROTTLE = Symbol("REGISTER_NOTICE_THROTTLE");

/** Throttle window: a duplicate register within ~15 min sends at most one notice. */
export const REGISTER_NOTICE_TTL_SECONDS = 15 * 60;

/** Key namespace for the ephemeral per-address notice marker. */
const KEY_PREFIX = "register-notice:";

/** The slice of a Redis client the throttle needs: an atomic `SET … NX EX`. */
export interface ThrottleRedisLike {
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null>;
}

/**
 * Build the throttle key for `email`: `register-notice:<HMAC-SHA256(pepper,
 * lower(email))>` (hex). Reuses the #141 audit pepper + construction so the key
 * is not a reversible identifier (no rainbow table over the email space).
 */
export function noticeThrottleKey(email: string, pepper: string): string {
  const hash = createHmac("sha256", pepper)
    .update(email.toLowerCase())
    .digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

/**
 * Redis-backed {@link RegisterNoticeThrottle} — the production binding. The
 * marker self-expires (`EX`), so it is never a persistent per-email record;
 * `SET … NX` makes the first send the only one within the window atomically (no
 * read-modify-write race between concurrent duplicate registers).
 */
export class RedisRegisterNoticeThrottle implements RegisterNoticeThrottle {
  constructor(
    private readonly redis: ThrottleRedisLike,
    private readonly pepper: string,
  ) {}

  async tryAcquire(email: string): Promise<boolean> {
    const key = noticeThrottleKey(email, this.pepper);
    const res = await this.redis.set(
      key,
      "1",
      "NX",
      "EX",
      REGISTER_NOTICE_TTL_SECONDS,
    );
    // ioredis returns "OK" when the key was set, null when NX found it present.
    return res === "OK";
  }
}

/**
 * In-memory {@link RegisterNoticeThrottle} — the binding when no Redis is
 * configured (dev-stand / CI default, mirroring the in-memory session store) and
 * the unit-test double. Keeps the same HMAC key construction + TTL so its
 * behaviour matches the Redis adapter (first send within the window allowed,
 * later ones suppressed, the marker self-expires).
 */
export class InMemoryRegisterNoticeThrottle
  implements RegisterNoticeThrottle
{
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly pepper: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  tryAcquire(email: string): Promise<boolean> {
    const key = noticeThrottleKey(email, this.pepper);
    const t = this.now();
    const expiresAt = this.seen.get(key);
    if (expiresAt !== undefined && t < expiresAt) {
      return Promise.resolve(false);
    }
    this.seen.set(key, t + REGISTER_NOTICE_TTL_SECONDS * 1000);
    return Promise.resolve(true);
  }
}
