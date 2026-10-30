import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RateLimitService } from "./rate-limit.service.js";
import { InMemoryRateLimitStore } from "./rate-limit.store.fake.js";
import { RedisRateLimitStore } from "./rate-limit.store.redis.js";
import type { RateLimitStore } from "./rate-limit.store.js";
import type { RateLimitThresholds } from "./rate-limit.types.js";

const thresholds: RateLimitThresholds = {
  perUserPer15Min: 3,
  perIpPer15Min: 5,
  perAsnPerHour: 100,
  scopedPerIpPer15Min: {},
};
const T0 = 1_700_000_000_000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * 003 EARS-13 / EARS-15 (#3539): with the IdP lockout gone the three windows
 * are the only bound on password guessing, so they must survive an api
 * restart and be shared by every api replica. Two {@link RateLimitService}
 * instances bound to ONE store stand in for two replicas (or one instance
 * before and after a restart). The same contract runs against the in-memory
 * store and, when `REDIS_URL` is set, against a real Redis.
 */
function contract(name: string, makeStore: () => RateLimitStore) {
  describe(`${name} (EARS-13, #3539)`, () => {
    it("EARS-13: two instances on one store share the per-user window", async () => {
      const store = makeStore();
      let now = T0;
      const a = new RateLimitService(thresholds, () => now, store);
      const b = new RateLimitService(thresholds, () => now, store);
      const identifier = `${randomUUID()}@ds.test`;
      const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}`;
      expect(await a.tryConsume({ ip: ip(), identifier })).toBe(true);
      expect(await b.tryConsume({ ip: ip(), identifier })).toBe(true);
      expect(
        await a.tryConsume({ ip: ip(), identifier: identifier.toUpperCase() }),
      ).toBe(true);
      expect(await b.tryConsume({ ip: ip(), identifier })).toBe(false);
      now += FIFTEEN_MIN_MS;
      expect(await b.tryConsume({ ip: ip(), identifier })).toBe(true);
    });

    it("EARS-13: two instances on one store share the per-IP and per-ASN windows", async () => {
      const store = makeStore();
      const now = T0;
      const a = new RateLimitService(thresholds, () => now, store);
      const b = new RateLimitService(thresholds, () => now, store);
      const ip = `ip-${randomUUID()}`;
      const asn = `AS-${randomUUID()}`;
      for (let i = 0; i < 5; i++) {
        expect(await (i % 2 ? a : b).tryConsume({ ip })).toBe(true);
      }
      expect(await a.tryConsume({ ip })).toBe(false);
      const asnLimited = new RateLimitService(
        { ...thresholds, perAsnPerHour: 2, perIpPer15Min: 100 },
        () => now,
        store,
      );
      const asnPeer = new RateLimitService(
        { ...thresholds, perAsnPerHour: 2, perIpPer15Min: 100 },
        () => now,
        store,
      );
      expect(
        await asnLimited.tryConsume({ ip: `x-${randomUUID()}`, asn }),
      ).toBe(true);
      expect(await asnPeer.tryConsume({ ip: `x-${randomUUID()}`, asn })).toBe(
        true,
      );
      const refused = await asnLimited.consume({
        ip: `x-${randomUUID()}`,
        asn,
      });
      expect(refused.allowed).toBe(false);
      if (!refused.allowed) expect(refused.refusal.window).toBe("asn");
    });

    it("EARS-13: a refused attempt consumes nothing in any window", async () => {
      const store = makeStore();
      const svc = new RateLimitService(thresholds, () => T0, store);
      const identifier = `${randomUUID()}@ds.test`;
      const ip = `ip-${randomUUID()}`;
      for (let i = 0; i < 3; i++) {
        expect(await svc.tryConsume({ ip, identifier })).toBe(true);
      }
      // Refused on the per-user window: the per-IP window keeps its 2 units.
      expect(await svc.tryConsume({ ip, identifier })).toBe(false);
      expect(await svc.tryConsume({ ip })).toBe(true);
      expect(await svc.tryConsume({ ip })).toBe(true);
      expect(await svc.tryConsume({ ip })).toBe(false);
    });

    it("EARS-15: a tripped per-user window is reported tripped once, across instances", async () => {
      const store = makeStore();
      const a = new RateLimitService(thresholds, () => T0, store);
      const b = new RateLimitService(thresholds, () => T0, store);
      const identifier = `${randomUUID()}@ds.test`;
      for (let i = 0; i < 3; i++)
        await a.consume({ ip: `ip-${randomUUID()}`, identifier });
      const first = await a.consume({ ip: `ip-${randomUUID()}`, identifier });
      const second = await b.consume({ ip: `ip-${randomUUID()}`, identifier });
      expect(first.allowed || first.refusal).toMatchObject({
        window: "user",
        tripped: true,
      });
      expect(second.allowed || second.refusal).toMatchObject({
        window: "user",
        tripped: false,
      });
    });

    it("EARS-13: a success forgives the per-user window and refunds its own per-IP unit on another instance", async () => {
      const store = makeStore();
      const a = new RateLimitService(thresholds, () => T0, store);
      const b = new RateLimitService(thresholds, () => T0, store);
      const identifier = `${randomUUID()}@ds.test`;
      const ip = `ip-${randomUUID()}`;
      const d = await a.consume({ ip, identifier });
      expect(d.allowed).toBe(true);
      for (let i = 0; i < 2; i++) await a.tryConsume({ ip, identifier });
      await b.reset({ ip, identifier });
      await b.refundIpUnit(
        ip,
        d.allowed ? d.receipt.ipWindowResetAtMs : undefined,
      );
      // Per-user cleared: it fits again. Per-IP: 3 used, 1 refunded => 3 left.
      expect(await a.tryConsume({ ip: `ip-${randomUUID()}`, identifier })).toBe(
        true,
      );
      expect(await a.tryConsume({ ip })).toBe(true);
      expect(await a.tryConsume({ ip })).toBe(true);
      expect(await a.tryConsume({ ip })).toBe(true);
      expect(await a.tryConsume({ ip })).toBe(false);
    });

    it("011 EARS-7: tryConsumeUser shares the per-user budget across instances", async () => {
      const store = makeStore();
      const a = new RateLimitService(thresholds, () => T0, store);
      const b = new RateLimitService(thresholds, () => T0, store);
      const identifier = `${randomUUID()}@ds.test`;
      expect(await a.tryConsumeUser(identifier)).toBe(true);
      expect(await b.tryConsume({ ip: "203.0.113.1", identifier })).toBe(true);
      expect(await a.tryConsumeUser(identifier)).toBe(true);
      expect(await b.tryConsumeUser(identifier)).toBe(false);
    });
  });
}

const shared = new InMemoryRateLimitStore();
contract("InMemoryRateLimitStore", () => shared);

describe.skipIf(!process.env.REDIS_URL)(
  "RedisRateLimitStore (real Redis)",
  () => {
    let redis: Redis;
    beforeAll(() => {
      redis = new Redis(process.env.REDIS_URL!);
    });
    afterAll(async () => {
      await redis.quit();
    });
    contract(
      "RedisRateLimitStore",
      () => new RedisRateLimitStore(redis as never, "test-pepper"),
    );

    it("EARS-13: the per-user key in Redis is the peppered identifier hash, never the raw identifier", async () => {
      const identifier = `${randomUUID()}@ds.test`;
      const svc = new RateLimitService(
        thresholds,
        () => T0,
        new RedisRateLimitStore(redis as never, "test-pepper"),
      );
      await svc.tryConsume({ ip: "203.0.113.9", identifier });
      const keys = await redis.keys("ds:rate-limit:*");
      expect(keys.some((k) => k.includes(identifier))).toBe(false);
    });
  },
);
