import { describe, expect, it } from "vitest";
import type { RedisLike } from "../session/session-store.redis.js";
import { InMemoryPendingAuthStore } from "./admin-session-store.fake.js";
import {
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
class FakeRedis implements RedisLike {
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
    await store.create({ ...record("sid-past", "sub-2"), expiresAtMs: Date.now() - 1000 });

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
