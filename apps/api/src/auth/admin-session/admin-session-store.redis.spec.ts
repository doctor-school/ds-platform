import { describe, expect, it } from "vitest";
import type { RedisLike } from "../session/session-store.redis.js";
import { RedisAdminSessionStore } from "./admin-session-store.redis.js";
import type { AdminSessionRecord } from "./admin-session.types.js";

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
});
