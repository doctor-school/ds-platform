import { describe, expect, it } from "vitest";
import { InMemoryOtpChallengeStore } from "./otp-challenge-store.fake.js";
import {
  OTP_CHALLENGE_TTL_SECONDS,
  RedisOtpChallengeStore,
  type RedisLike,
} from "./otp-challenge-store.redis.js";
import type { OtpChallenge } from "./otp-challenge-store.types.js";

/**
 * #410 — unit coverage for both OtpChallengeStore adapters. The Redis adapter
 * is driven through a `RedisLike` stub (the shared CI job has no Redis service
 * — same discipline as `RedisSessionStore`); the fake is the in-memory default
 * binding preserving the pre-#410 single-instance Map semantics.
 */

const CHALLENGE: OtpChallenge = {
  sessionId: "otp-sess-1",
  sessionToken: "unchecked-token",
  sub: "otp-user-1",
};

describe("InMemoryOtpChallengeStore (#410)", () => {
  it("round-trips a challenge and returns undefined after delete", async () => {
    const store = new InMemoryOtpChallengeStore();
    await store.set("doc@ds.test", CHALLENGE);
    await expect(store.get("doc@ds.test")).resolves.toEqual(CHALLENGE);
    await store.delete("doc@ds.test");
    await expect(store.get("doc@ds.test")).resolves.toBeUndefined();
  });

  it("misses on a key never set (and delete of a missing key is a no-op)", async () => {
    const store = new InMemoryOtpChallengeStore();
    await expect(store.get("nobody@ds.test")).resolves.toBeUndefined();
    await expect(store.delete("nobody@ds.test")).resolves.toBeUndefined();
  });

  it("re-arm is last-write-wins (a fresh request*Otp replaces the prior challenge)", async () => {
    const store = new InMemoryOtpChallengeStore();
    await store.set("doc@ds.test", CHALLENGE);
    const fresh: OtpChallenge = { ...CHALLENGE, sessionId: "otp-sess-2" };
    await store.set("doc@ds.test", fresh);
    await expect(store.get("doc@ds.test")).resolves.toEqual(fresh);
  });
});

describe("RedisOtpChallengeStore (#410)", () => {
  /** A recording RedisLike stub with a real key→value map behind it. */
  function redisStub(): {
    redis: RedisLike;
    calls: { op: string; args: unknown[] }[];
  } {
    const kv = new Map<string, string>();
    const calls: { op: string; args: unknown[] }[] = [];
    const redis: RedisLike = {
      set: (key, value, mode, ttlSeconds) => {
        calls.push({ op: "set", args: [key, value, mode, ttlSeconds] });
        kv.set(key, value);
        return Promise.resolve("OK");
      },
      get: (key) => {
        calls.push({ op: "get", args: [key] });
        return Promise.resolve(kv.get(key) ?? null);
      },
      del: (...keys) => {
        calls.push({ op: "del", args: keys });
        for (const key of keys) kv.delete(key);
        return Promise.resolve(keys.length);
      },
    };
    return { redis, calls };
  }

  it("set writes JSON under the ds:otp-challenge: namespace with the EX garbage-collection TTL", async () => {
    const { redis, calls } = redisStub();
    const store = new RedisOtpChallengeStore(redis);
    await store.set("doc@ds.test", CHALLENGE);
    expect(calls).toEqual([
      {
        op: "set",
        args: [
          "ds:otp-challenge:doc@ds.test",
          JSON.stringify(CHALLENGE),
          "EX",
          OTP_CHALLENGE_TTL_SECONDS,
        ],
      },
    ]);
  });

  it("get parses the stored JSON back into the challenge; a missing key is undefined", async () => {
    const { redis } = redisStub();
    const store = new RedisOtpChallengeStore(redis);
    await store.set("doc@ds.test", CHALLENGE);
    await expect(store.get("doc@ds.test")).resolves.toEqual(CHALLENGE);
    await expect(store.get("nobody@ds.test")).resolves.toBeUndefined();
  });

  it("delete removes the namespaced key (single-use consume)", async () => {
    const { redis, calls } = redisStub();
    const store = new RedisOtpChallengeStore(redis);
    await store.set("doc@ds.test", CHALLENGE);
    await store.delete("doc@ds.test");
    expect(calls.at(-1)).toEqual({
      op: "del",
      args: ["ds:otp-challenge:doc@ds.test"],
    });
    await expect(store.get("doc@ds.test")).resolves.toBeUndefined();
  });
});
