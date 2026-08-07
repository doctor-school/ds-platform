import type { RedisLike } from "../session/session-store.redis.js";
import type {
  AdminSessionRecord,
  AdminSessionStore,
  PendingAuthRecord,
  PendingAuthStore,
} from "./admin-session.types.js";

/**
 * Key namespaces (design §3: _"a separate Redis key namespace"_). The pending
 * namespace is distinct from the session namespace so a pending reference can
 * never resolve as a session even if a `ref` were guessed or replayed as a `sid`.
 */
const ADMIN_SESSION_PREFIX = "ds:admin-session:";
const ADMIN_SESSION_SUB_INDEX_PREFIX = "ds:admin-session:sub:";
const PENDING_AUTH_PREFIX = "ds:admin-pending:";

/** Remaining lifetime in whole seconds, floored at 1 (Redis rejects `EX 0`). */
function ttlSecondsUntil(expiresAtMs: number): number {
  return Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
}

/**
 * Redis-backed {@link AdminSessionStore} — the production binding (EARS-10:
 * _"the session record stored server-side in Redis"_, ADR-0001 §6). Bound by
 * {@link AdminSessionModule} only when `REDIS_URL` is set; with no Redis the
 * in-memory fake is used, exactly as the 003 session store does.
 *
 * The record is stored as JSON under a TTL equal to its remaining lifetime, so
 * key expiry is the single source of truth for session expiry — an expired `sid`
 * is simply absent, indistinguishable from one that never existed.
 */
export class RedisAdminSessionStore implements AdminSessionStore {
  constructor(private readonly redis: RedisLike) {}

  async create(record: AdminSessionRecord): Promise<void> {
    const ttl = ttlSecondsUntil(record.expiresAtMs);
    await this.redis.set(
      `${ADMIN_SESSION_PREFIX}${record.sid}`,
      JSON.stringify(record),
      "EX",
      ttl,
    );
    // `sub → sids` index for the EARS-10 force-logout primitive; bumped to this
    // member's TTL so the index cannot outlive every session it tracks.
    const indexKey = `${ADMIN_SESSION_SUB_INDEX_PREFIX}${record.sub}`;
    await this.redis.sadd(indexKey, record.sid);
    await this.redis.expire(indexKey, ttl);
  }

  async get(sid: string): Promise<AdminSessionRecord | undefined> {
    const raw = await this.redis.get(`${ADMIN_SESSION_PREFIX}${sid}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as AdminSessionRecord;
  }

  async rotate(
    sid: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
    const record = await this.get(sid);
    // No-op if the session is gone (expired/revoked) — rotation never resurrects.
    if (!record) return;
    await this.redis.set(
      `${ADMIN_SESSION_PREFIX}${sid}`,
      JSON.stringify({ ...record, accessToken, refreshToken }),
      "EX",
      ttlSecondsUntil(record.expiresAtMs),
    );
  }

  async delete(sid: string): Promise<void> {
    const record = await this.get(sid);
    await this.redis.del(`${ADMIN_SESSION_PREFIX}${sid}`);
    if (record) {
      await this.redis.srem(
        `${ADMIN_SESSION_SUB_INDEX_PREFIX}${record.sub}`,
        sid,
      );
    }
  }

  async deleteBySub(sub: string): Promise<string[]> {
    const indexKey = `${ADMIN_SESSION_SUB_INDEX_PREFIX}${sub}`;
    const sids = await this.redis.smembers(indexKey);
    if (sids.length > 0) {
      await this.redis.del(
        ...sids.map((sid) => `${ADMIN_SESSION_PREFIX}${sid}`),
      );
    }
    await this.redis.del(indexKey);
    return sids;
  }
}

/**
 * Redis-backed {@link PendingAuthStore}. Minutes-long TTL (design §3) enforced by
 * key expiry, so an expired pending reference is absent rather than stale — the
 * uniform-failure discipline gets "unknown reference" for free.
 */
export class RedisPendingAuthStore implements PendingAuthStore {
  constructor(private readonly redis: RedisLike) {}

  async create(record: PendingAuthRecord): Promise<void> {
    await this.redis.set(
      `${PENDING_AUTH_PREFIX}${record.ref}`,
      JSON.stringify(record),
      "EX",
      ttlSecondsUntil(record.expiresAtMs),
    );
  }

  async get(ref: string): Promise<PendingAuthRecord | undefined> {
    const raw = await this.redis.get(`${PENDING_AUTH_PREFIX}${ref}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as PendingAuthRecord;
  }

  async delete(ref: string): Promise<void> {
    await this.redis.del(`${PENDING_AUTH_PREFIX}${ref}`);
  }
}
