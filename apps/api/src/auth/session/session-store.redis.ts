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
  del(...keys: string[]): Promise<unknown>;
  /** Add `sid`s to the `sub → sids` index set (EARS-12 revoke-all). */
  sadd(key: string, ...members: string[]): Promise<unknown>;
  /** Remove a `sid` from the index set when a single session ends. */
  srem(key: string, ...members: string[]): Promise<unknown>;
  /** Read every `sid` currently indexed for a `sub`. */
  smembers(key: string): Promise<string[]>;
  /** Bound the index set's lifetime so stale entries cannot leak unboundedly. */
  expire(key: string, ttlSeconds: number): Promise<unknown>;
}

/** Key namespace for BFF session records. */
const KEY_PREFIX = "ds:session:";
/** Key namespace for the `sub → sids` index used by {@link RedisSessionStore.deleteBySub}. */
const SUB_INDEX_PREFIX = "ds:session:sub:";

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
    // Maintain the `sub → sids` index (EARS-12). The set is bumped to the
    // longest-lived member's TTL so it cannot outlive every session it tracks;
    // any sid that expires by key-TTL while still listed is harmlessly skipped on
    // revoke (its `del` no-ops), and `deleteBySub` prunes the index afterwards.
    const indexKey = `${SUB_INDEX_PREFIX}${record.sub}`;
    await this.redis.sadd(indexKey, record.sid);
    await this.redis.expire(indexKey, ttlSeconds);
  }

  async get(sid: string): Promise<SessionRecord | undefined> {
    const raw = await this.redis.get(`${KEY_PREFIX}${sid}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as SessionRecord;
  }

  async rotate(
    sid: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
    // Re-`set` the record with its tokens replaced, under a TTL recomputed from
    // the unchanged `expiresAtMs` — so rotation refreshes the token pair without
    // extending (or resetting) the session's key expiry. No-op if the session is
    // gone (expired key / revoked) — rotation never resurrects a session.
    const record = await this.get(sid);
    if (!record) return;
    const next: SessionRecord = { ...record, accessToken, refreshToken };
    const ttlSeconds = Math.max(
      1,
      Math.ceil((record.expiresAtMs - Date.now()) / 1000),
    );
    await this.redis.set(
      `${KEY_PREFIX}${sid}`,
      JSON.stringify(next),
      "EX",
      ttlSeconds,
    );
  }

  async delete(sid: string): Promise<void> {
    // Read first to find the owning `sub` so the index entry is pruned with the
    // record; if the key is already gone we still issue the del (idempotent).
    const record = await this.get(sid);
    await this.redis.del(`${KEY_PREFIX}${sid}`);
    if (record) await this.redis.srem(`${SUB_INDEX_PREFIX}${record.sub}`, sid);
  }

  async deleteBySub(sub: string): Promise<void> {
    // Revoke every session of the subject (EARS-12): read the index, delete each
    // session key (a TTL-expired sid simply no-ops), then drop the index set.
    const indexKey = `${SUB_INDEX_PREFIX}${sub}`;
    const sids = await this.redis.smembers(indexKey);
    if (sids.length > 0) {
      await this.redis.del(...sids.map((sid) => `${KEY_PREFIX}${sid}`));
    }
    await this.redis.del(indexKey);
  }
}
