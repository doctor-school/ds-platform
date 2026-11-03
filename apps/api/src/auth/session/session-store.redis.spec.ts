import { describe, expect, it } from "vitest";
import { RedisSessionStore, type RedisLike } from "./session-store.redis.js";

/** A Map-backed {@link RedisLike} — just enough of Redis for `get`. */
function mapRedis(values: Map<string, string>): RedisLike {
  const sets = new Map<string, Set<string>>();
  return {
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve("OK");
    },
    get: (key) => Promise.resolve(values.get(key) ?? null),
    del: (...keys) => {
      for (const key of keys) values.delete(key);
      return Promise.resolve(keys.length);
    },
    sadd: (key, ...members) => {
      const set = sets.get(key) ?? new Set<string>();
      for (const m of members) set.add(m);
      sets.set(key, set);
      return Promise.resolve(members.length);
    },
    srem: (key, ...members) => {
      for (const m of members) sets.get(key)?.delete(m);
      return Promise.resolve(members.length);
    },
    smembers: (key) => Promise.resolve([...(sets.get(key) ?? [])]),
    expire: () => Promise.resolve(1),
  };
}

const base = {
  sid: "sid-1",
  sub: "sub-1",
  roles: ["doctor_guest"],
  mfa: false,
  accessToken: "at",
  refreshToken: "rt",
  fingerprint: "fp",
  expiresAtMs: Date.now() + 3600_000,
};

// 003 EARS-8 (amended), #3175 — production Redis holds records minted before
// the linked redeem; the adapter reads them as what they are (no Zitadel
// session id, no storefront client) so the service can refuse them.
describe("RedisSessionStore — reading records as stored", () => {
  it("003 EARS-8: a record minted before the linked redeem reads back without a Zitadel session id or storefront client", async () => {
    const values = new Map([["ds:session:sid-1", JSON.stringify(base)]]);
    const record = await new RedisSessionStore(mapRedis(values)).get("sid-1");

    expect(record).toEqual(base);
    expect(record?.zitadelSessionId).toBeUndefined();
    expect(record?.oidcClient).toBeUndefined();
  });

  it("003 EARS-8: a linked record reads back with its link", async () => {
    const linked = { ...base, zitadelSessionId: "zs-1", oidcClient: "doctor" };
    const values = new Map([["ds:session:sid-1", JSON.stringify(linked)]]);

    expect(await new RedisSessionStore(mapRedis(values)).get("sid-1")).toEqual(
      linked,
    );
  });

  it("003 EARS-8: a record of no known shape reads as absent", async () => {
    const values = new Map([
      ["ds:session:sid-1", JSON.stringify({ sid: "sid-1", sub: 7 })],
    ]);

    expect(
      await new RedisSessionStore(mapRedis(values)).get("sid-1"),
    ).toBeUndefined();
  });
});
