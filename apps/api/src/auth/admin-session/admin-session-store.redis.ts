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
    const key = `${ADMIN_SESSION_PREFIX}${sid}`;
    const raw = await this.redis.get(key);
    if (!raw) return undefined;
    const record = JSON.parse(raw) as AdminSessionRecord;
    // Key TTL is the primary expiry mechanism, but it is a rounded, floored
    // approximation of the record's real deadline: `ttlSecondsUntil` ceils to
    // whole seconds and never writes below 1s (Redis rejects `EX 0`). So a
    // record can outlive its own `expiresAtMs` by up to a second — and the
    // record carries that deadline, so enforce it on read too. An expired
    // record is absent, the exact answer the in-memory store gives (EARS-10:
    // an expired session record refuses the request); the two adapters must
    // not disagree about when a session is over.
    if (record.expiresAtMs <= Date.now()) {
      await this.redis.del(key);
      return undefined;
    }
    return record;
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
    // The index outlives its members: a session key expires by TTL while its sid
    // stays listed (only an explicit `delete` prunes it), so with a 30-day TTL and
    // a daily login the set accumulates stale sids. Resolve each member against
    // the session key and return ONLY the ones that were actually live, pruning
    // the misses — otherwise force-logout would emit an
    // `auth.session.terminated` row for a session that ended days ago, breaking
    // EARS-9's one-terminal-row-per-lifecycle-event discipline. Same filter the
    // in-memory store applies, so the two adapters agree on what "revoked" means.
    // The stale members need no `srem` — the whole index key is dropped below.
    const revoked: string[] = [];
    for (const sid of sids) {
      // Through `get`, so a record that is present but past its own
      // `expiresAtMs` counts as dead here exactly as it does on a request.
      if (await this.get(sid)) {
        await this.redis.del(`${ADMIN_SESSION_PREFIX}${sid}`);
        revoked.push(sid);
      }
    }
    await this.redis.del(indexKey);
    return revoked;
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
