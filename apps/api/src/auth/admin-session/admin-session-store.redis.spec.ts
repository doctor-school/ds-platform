import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryPendingAuthStore } from "./admin-session-store.fake.js";
import {
  type AdminRedisLike,
  RedisAdminSessionStore,
  RedisPendingAuthStore,
} from "./admin-session-store.redis.js";
import type {
  AdminSessionRecord,
  PendingAuthRecord,
  PendingAuthStore,
} from "./admin-session.types.js";

/**
 * A minimal Redis double: string keys + set keys, with `expire` recorded but NOT
 * enforced. That is deliberate — the divergence under test is precisely what
 * happens when a session key expires by TTL while its sid stays listed in the
 * `sub` index, so the double must let the two fall out of step exactly as a real
 * Redis does.
 */
class FakeRedis implements AdminRedisLike {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

  set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  del(...keys: string[]): Promise<unknown> {
    for (const key of keys) {
      this.strings.delete(key);
      this.sets.delete(key);
    }
    return Promise.resolve(keys.length);
  }

  sadd(key: string, ...members: string[]): Promise<unknown> {
    let set = this.sets.get(key);
    if (!set) this.sets.set(key, (set = new Set()));
    for (const m of members) set.add(m);
    return Promise.resolve(members.length);
  }

  srem(key: string, ...members: string[]): Promise<unknown> {
    const set = this.sets.get(key);
    for (const m of members) set?.delete(m);
    return Promise.resolve(members.length);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  expire(): Promise<unknown> {
    return Promise.resolve(1);
  }
  incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? "0") + 1;
    this.strings.set(key, String(next));
    return Promise.resolve(next);
  }

  /** No Lua here — `createFromPending` is proven on a real Redis below. */
  eval(): Promise<unknown> {
    return Promise.reject(new Error("FakeRedis runs no scripts"));
  }
}

function record(sid: string, sub: string): AdminSessionRecord {
  return {
    sid,
    zitadelSessionId: `zit-${sid}`,
    sub,
    identifier: `${sub}@ds.test`,
    roles: ["platform_admin"],
    mfa: true,
    fingerprint: "fp",
    csrfToken: `csrf-${sid}`,
    expiresAtMs: Date.now() + 60_000,
  };
}

describe("011 EARS-10 — RedisAdminSessionStore force-logout", () => {
  it("EARS-10: deleteBySub returns only sessions that still exist, so no terminal row is emitted for a dead one", async () => {
    const redis = new FakeRedis();
    const store = new RedisAdminSessionStore(redis);
    await store.create(record("sid-live", "sub-1"));
    await store.create(record("sid-stale", "sub-1"));

    // The stale session's key expires by TTL; its sid stays in the `sub` index,
    // because only an explicit `delete` prunes the index. With a 30-day TTL and a
    // daily login this is the steady state, not an edge case.
    redis.strings.delete("ds:admin-session:sid-stale");

    const revoked = await store.deleteBySub("sub-1");

    // One row per session that actually ended (EARS-9's one-terminal-row-per-
    // lifecycle-event discipline), matching the in-memory store's `if (record)`
    // filter — the two adapters agree on what "revoked" means.
    expect(revoked).toEqual(["sid-live"]);
    expect(redis.strings.has("ds:admin-session:sid-live")).toBe(false);
    expect(redis.sets.has("ds:admin-session:sub:sub-1")).toBe(false);
  });

  it("EARS-10: deleteBySub on a subject with no sessions revokes nothing", async () => {
    const store = new RedisAdminSessionStore(new FakeRedis());
    await expect(store.deleteBySub("sub-unknown")).resolves.toEqual([]);
  });

  it("EARS-10: a record still keyed in Redis but past its own expiry reads as absent", async () => {
    const redis = new FakeRedis();
    const store = new RedisAdminSessionStore(redis);
    // `ttlSecondsUntil` floors the key TTL at one second, so a record can
    // outlive its own deadline by up to a second even with real Redis expiry —
    // and the request path must refuse it for that whole window, exactly as the
    // in-memory store does.
    await store.create({
      ...record("sid-past", "sub-2"),
      expiresAtMs: Date.now() - 1000,
    });

    await expect(store.get("sid-past")).resolves.toBeUndefined();
    // The read prunes it, so it can never resurface.
    expect(redis.strings.has("ds:admin-session:sid-past")).toBe(false);
    await expect(store.deleteBySub("sub-2")).resolves.toEqual([]);
  });
});

function pending(ref: string, expiresAtMs: number): PendingAuthRecord {
  return {
    ref,
    sub: `sub-${ref}`,
    identifier: `${ref}@ds.test`,
    roles: ["platform_admin"],
    nextStep: "mfa_challenge_required",
    zitadelSessionId: `zit-${ref}`,
    sessionToken: `tok-${ref}`,
    fingerprint: "fp",
    expiresAtMs,
    accessGeneration: 0,
  };
}

describe("011 EARS-3 — pending-auth expiry is enforced by both bindings", () => {
  // Both adapters must agree on when a pending reference is over: the Redis key
  // TTL is floored at one second (`ttlSecondsUntil`), so a record can outlive
  // its own `expiresAtMs` and still be served unless `get` re-checks the
  // deadline the record itself carries.
  const bindings: [string, () => PendingAuthStore][] = [
    ["InMemoryPendingAuthStore", () => new InMemoryPendingAuthStore()],
    ["RedisPendingAuthStore", () => new RedisPendingAuthStore(new FakeRedis())],
  ];

  for (const [name, make] of bindings) {
    it(`EARS-3: ${name} refuses a pending record past its own expiry`, async () => {
      const store = make();
      await store.create(pending("ref-past", Date.now() - 1000));

      await expect(store.get("ref-past")).resolves.toBeUndefined();
      // A second read must agree — the first one prunes it, so an expired
      // reference can never resurface.
      await expect(store.get("ref-past")).resolves.toBeUndefined();
    });

    it(`EARS-3: ${name} still serves a live pending record`, async () => {
      const store = make();
      await store.create(pending("ref-live", Date.now() + 60_000));

      await expect(store.get("ref-live")).resolves.toMatchObject({
        ref: "ref-live",
      });
    });
  }
});

describe("047 EARS-7 — PendingAuthStore.deleteBySub drops every pending sign-in of one person", () => {
  function pendingOf(ref: string, sub: string): PendingAuthRecord {
    return { ...pending(ref, Date.now() + 60_000), sub };
  }

  const bindings: [string, () => PendingAuthStore][] = [
    ["InMemoryPendingAuthStore", () => new InMemoryPendingAuthStore()],
    ["RedisPendingAuthStore", () => new RedisPendingAuthStore(new FakeRedis())],
  ];

  for (const [name, make] of bindings) {
    it(`047 EARS-7: ${name} deleteBySub removes the person's pending records and keeps another person's`, async () => {
      const store = make();
      await store.create(pendingOf("ref-a1", "sub-a"));
      await store.create(pendingOf("ref-a2", "sub-a"));
      await store.create(pendingOf("ref-b1", "sub-b"));

      await store.deleteBySub("sub-a");

      await expect(store.get("ref-a1")).resolves.toBeUndefined();
      await expect(store.get("ref-a2")).resolves.toBeUndefined();
      await expect(store.get("ref-b1")).resolves.toMatchObject({
        ref: "ref-b1",
      });
      // Idempotent: a repeat over an empty index is a no-op.
      await expect(store.deleteBySub("sub-a")).resolves.toBeUndefined();
    });
  }

  it("047 EARS-7: the Redis sub index expires with the pending record and is pruned on delete(ref)", async () => {
    const redis = new FakeRedis();
    const expire = vi.spyOn(redis, "expire");
    const store = new RedisPendingAuthStore(redis);
    await store.create(pendingOf("ref-a1", "sub-a"));
    await store.create(pendingOf("ref-a2", "sub-a"));
    const indexKey = "ds:admin-pending:sub:sub-a";
    expect(expire).toHaveBeenCalledWith(indexKey, expect.any(Number));
    const ttl = (expire.mock.calls.at(-1) as unknown[])[1] as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    await store.delete("ref-a1");
    expect([...(redis.sets.get(indexKey) ?? [])]).toEqual(["ref-a2"]);

    await store.deleteBySub("sub-a");
    expect(redis.sets.has(indexKey)).toBe(false);
    expect(redis.strings.has("ds:admin-pending:ref-a2")).toBe(false);
  });
});

/**
 * 047 EARS-7 — the session write from a pending sign-in is one atomic step on a
 * REAL Redis (the Lua script cannot run on the double above): the pending record
 * is consumed and the person's access generation compared in the same step, so
 * a revocation that bumped the generation or removed the pending record can
 * never be raced by a session write.
 */
describe.skipIf(!process.env.REDIS_URL)(
  "047 EARS-7 — RedisAdminSessionStore.createFromPending (real Redis)",
  () => {
    let redis: Redis;
    beforeAll(() => {
      redis = new Redis(process.env.REDIS_URL!);
    });
    afterAll(async () => {
      await redis.quit();
    });

    async function seeded() {
      const sub = `sub-${randomUUID()}`;
      const ref = `ref-${randomUUID()}`;
      const pendingStore = new RedisPendingAuthStore(redis);
      await pendingStore.create({ ...pending(ref, Date.now() + 60_000), sub });
      const store = new RedisAdminSessionStore(redis);
      const generation = await store.accessGeneration(sub);
      return { sub, ref, pendingStore, store, generation };
    }

    it("047 EARS-7: writes the session and consumes the pending record when the generation is unchanged", async () => {
      const { sub, ref, pendingStore, store, generation } = await seeded();
      const session = record(`sid-${randomUUID()}`, sub);

      await expect(
        store.createFromPending(session, ref, generation),
      ).resolves.toBe(true);
      await expect(store.get(session.sid)).resolves.toMatchObject({ sub });
      await expect(pendingStore.get(ref)).resolves.toBeUndefined();
      await expect(store.deleteBySub(sub)).resolves.toEqual([session.sid]);
    });

    it("047 EARS-7: a bumped access generation refuses the create — no session written", async () => {
      const { sub, ref, store, generation } = await seeded();
      await store.bumpAccessGeneration(sub);
      const session = record(`sid-${randomUUID()}`, sub);

      await expect(
        store.createFromPending(session, ref, generation),
      ).resolves.toBe(false);
      await expect(store.get(session.sid)).resolves.toBeUndefined();
      await expect(store.deleteBySub(sub)).resolves.toEqual([]);
      await redis.del(`ds:admin-access-gen:${sub}`);
    });

    it("047 EARS-7: a consumed pending record refuses the create — no session written", async () => {
      const { sub, ref, pendingStore, store, generation } = await seeded();
      await pendingStore.deleteBySub(sub);
      const session = record(`sid-${randomUUID()}`, sub);

      await expect(
        store.createFromPending(session, ref, generation),
      ).resolves.toBe(false);
      await expect(store.get(session.sid)).resolves.toBeUndefined();
      await expect(store.deleteBySub(sub)).resolves.toEqual([]);
    });
  },
);
