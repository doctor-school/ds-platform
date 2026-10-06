import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  handoffKey,
  InMemoryLoginHandoffStore,
  LOGIN_HANDOFF_TTL_SECONDS,
  RedisLoginHandoffStore,
  type HandoffRedisLike,
} from "./login-handoff.store.js";

const ACCOUNT = "6f1b0c3e-0000-4000-8000-000000000001";

describe("login hand-off store (003 EARS-44)", () => {
  it("003 EARS-44: a minted reference is 32 random bytes in base64url and carries no data", async () => {
    const store = new InMemoryLoginHandoffStore();
    const a = await store.mint(ACCOUNT);
    const b = await store.mint(ACCOUNT);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    // Same account, two references: nothing derives from the account.
    expect(a).not.toBe(b);
    expect(a).not.toContain(ACCOUNT);
  });

  it("003 EARS-44: only SHA-256 of the reference is stored, never the reference itself", async () => {
    const store = new InMemoryLoginHandoffStore();
    const ref = await store.mint(ACCOUNT);
    const sha = createHash("sha256").update(ref).digest("hex");
    expect(store.storedKeys()).toEqual([`login-handoff:${sha}`]);
    expect(store.storedKeys().join()).not.toContain(ref);
  });

  it("003 EARS-44: a reference redeems three times, the fourth is refused", async () => {
    const store = new InMemoryLoginHandoffStore();
    const ref = await store.mint(ACCOUNT);
    expect(await store.redeem(ref)).toBe(ACCOUNT);
    expect(await store.redeem(ref)).toBe(ACCOUNT);
    expect(await store.redeem(ref)).toBe(ACCOUNT);
    expect(await store.redeem(ref)).toBeNull();
  });

  it("003 EARS-44: a reference expires 24 h after the sign-up", async () => {
    let t = 1_000_000;
    const store = new InMemoryLoginHandoffStore(() => t);
    const ref = await store.mint(ACCOUNT);
    t += LOGIN_HANDOFF_TTL_SECONDS * 1000 - 1;
    expect(await store.redeem(ref)).toBe(ACCOUNT);
    t += 1;
    expect(await store.redeem(ref)).toBeNull();
  });

  it("003 EARS-44: unknown and malformed references are refused without state", async () => {
    const store = new InMemoryLoginHandoffStore();
    expect(await store.redeem("A".repeat(43))).toBeNull();
    expect(await store.redeem("")).toBeNull();
    expect(await store.redeem("not a reference")).toBeNull();
    expect(await store.redeem("A".repeat(44))).toBeNull();
    expect(store.storedKeys()).toEqual([]);
  });

  it("003 EARS-44: the Redis adapter keys on the hash, sets the 24 h TTL and passes the ceiling, never the reference", async () => {
    const calls: { numKeys: number; args: (string | number)[] }[] = [];
    const redis: HandoffRedisLike = {
      eval: (_script, numKeys, ...args) => {
        calls.push({ numKeys, args });
        return Promise.resolve(calls.length === 1 ? 1 : ACCOUNT);
      },
    };
    const store = new RedisLoginHandoffStore(redis);
    const ref = await store.mint(ACCOUNT);
    expect(calls[0]).toEqual({
      numKeys: 1,
      args: [handoffKey(ref), ACCOUNT, LOGIN_HANDOFF_TTL_SECONDS],
    });
    expect(await store.redeem(ref)).toBe(ACCOUNT);
    expect(calls[1]).toEqual({ numKeys: 1, args: [handoffKey(ref), 3] });
    expect(JSON.stringify(calls)).not.toContain(ref);
  });

  it("003 EARS-44: the Redis adapter refuses a malformed reference without a round trip, and maps nil to null", async () => {
    let round = 0;
    const redis: HandoffRedisLike = {
      eval: () => {
        round += 1;
        return Promise.resolve(null);
      },
    };
    const store = new RedisLoginHandoffStore(redis);
    expect(await store.redeem("short")).toBeNull();
    expect(round).toBe(0);
    expect(await store.redeem("B".repeat(43))).toBeNull();
    expect(round).toBe(1);
  });
});
