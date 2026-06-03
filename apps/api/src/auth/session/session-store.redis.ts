import type { SessionRecord, SessionStore } from "./session.types.js";

/**
 * The slice of a Redis client the store needs — narrowed (as the IdP adapter
 * narrows `fetch`) so the adapter is unit-testable without a live Redis and does
 * not couple to a specific client's full surface. `ioredis`'s `set(key, val,
 * "EX", seconds)` and `get` satisfy it.
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/** Key namespace for BFF session records. */
const KEY_PREFIX = "ds:session:";

/**
 * Redis-backed {@link SessionStore} — the production binding (ADR-0001 §6:
 * "refresh stored server-side in Redis on the BFF"). Bound by
 * {@link SessionStoreModule} only when `REDIS_URL` is set; with no Redis the
 * in-memory fake is used (the dev-stand / CI default), so this adapter's socket
 * paths are exercised by integration runs that point at a real Redis, not by the
 * `api-e2e` job — mirroring how {@link ZitadelIdpClient} is integration-only.
 *
 * The record is stored as JSON under a TTL equal to its remaining lifetime, so
 * key expiry is the single source of truth for session expiry — an expired `sid`
 * is simply absent, indistinguishable from one that never existed.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: RedisLike) {}

  async create(record: SessionRecord): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.ceil((record.expiresAtMs - Date.now()) / 1000),
    );
    await this.redis.set(
      `${KEY_PREFIX}${record.sid}`,
      JSON.stringify(record),
      "EX",
      ttlSeconds,
    );
  }

  async get(sid: string): Promise<SessionRecord | undefined> {
    const raw = await this.redis.get(`${KEY_PREFIX}${sid}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as SessionRecord;
  }
}
