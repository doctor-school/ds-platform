import { beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "./rate-limit.service.js";
import type { RateLimitThresholds } from "./rate-limit.types.js";

// EARS-13: the auth rate limiter. Three fixed-window counters — per-user (the
// submitted identifier, 5/15 min), per-IP (20/15 min), per-ASN (100/h) — answer
// one question per attempt: may it proceed? Allowed only when EVERY applicable
// window has room; a refused attempt consumes NOTHING. Exercised here against a
// controllable fake clock so the window-reset boundary is deterministic, with no
// Nest/HTTP in the loop (ADR-0001 §7).
describe("RateLimitService (EARS-13)", () => {
  const thresholds: RateLimitThresholds = {
    perUserPer15Min: 5,
    perIpPer15Min: 20,
    perAsnPerHour: 100,
  };
  const identifier = "user@ds.test";
  const ip = "203.0.113.7";
  const asn = "AS64500";
  let now: number;
  let svc: RateLimitService;

  beforeEach(() => {
    now = 1_700_000_000_000;
    svc = new RateLimitService(thresholds, () => now);
  });

  it("EARS-13: allows an attempt when every dimension has room", () => {
    expect(svc.tryConsume({ ip, identifier, asn })).toBe(true);
  });

  it("EARS-13: enforces the per-user 15-min limit, refusing the over-limit attempt", () => {
    // 5/15 min: five succeed (distinct IPs so only the per-user window can trip).
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      expect(svc.tryConsume({ ip: `10.0.0.${i}`, identifier })).toBe(true);
    }
    expect(svc.tryConsume({ ip: "10.0.0.99", identifier })).toBe(false);
  });

  it("EARS-13: the per-user window is per identifier — a different identifier is unaffected", () => {
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      svc.tryConsume({ ip: `10.0.0.${i}`, identifier });
    }
    expect(svc.tryConsume({ ip: "10.0.0.99", identifier })).toBe(false);
    expect(
      svc.tryConsume({ ip: "10.0.0.99", identifier: "other@ds.test" }),
    ).toBe(true);
  });

  it("EARS-13: per-user keying is case-insensitive (same identifier, different case)", () => {
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      svc.tryConsume({ ip: `10.0.0.${i}`, identifier: "User@DS.test" });
    }
    expect(
      svc.tryConsume({ ip: "10.0.0.99", identifier: "user@ds.test" }),
    ).toBe(false);
  });

  it("EARS-13: enforces the per-IP 15-min limit independent of identifier", () => {
    // Same IP, distinct identifiers (so per-user never trips): the 21st refused.
    for (let i = 0; i < thresholds.perIpPer15Min; i++) {
      expect(svc.tryConsume({ ip, identifier: `u${i}@ds.test` })).toBe(true);
    }
    expect(svc.tryConsume({ ip, identifier: "u99@ds.test" })).toBe(false);
  });

  it("EARS-13: a refused attempt consumes nothing (only allowed attempts are counted)", () => {
    const tiny = new RateLimitService(
      { ...thresholds, perUserPer15Min: 1 },
      () => now,
    );
    expect(tiny.tryConsume({ ip, identifier })).toBe(true);
    expect(tiny.tryConsume({ ip, identifier })).toBe(false); // per-user refused
    // The refusal did not spend the per-IP budget: a different identifier on the
    // same IP still proceeds.
    expect(tiny.tryConsume({ ip, identifier: "fresh@ds.test" })).toBe(true);
  });

  it("EARS-13: the per-ASN window is only enforced when the edge supplies an ASN", () => {
    const perAsn = new RateLimitService(
      { perUserPer15Min: 100, perIpPer15Min: 100, perAsnPerHour: 1 },
      () => now,
    );
    expect(
      perAsn.tryConsume({ ip: "1.1.1.1", identifier: "a@ds.test", asn }),
    ).toBe(true);
    expect(
      perAsn.tryConsume({ ip: "1.1.1.2", identifier: "b@ds.test", asn }),
    ).toBe(false);
    // Without an ASN the per-ASN window cannot bucket the request, so it is
    // skipped (degrades to user/IP) rather than refusing blindly.
    expect(perAsn.tryConsume({ ip: "1.1.1.3", identifier: "c@ds.test" })).toBe(
      true,
    );
  });

  it("EARS-13: an identifier-less attempt is gated by IP alone (per-user window skipped)", () => {
    const ipOnly = new RateLimitService(
      { ...thresholds, perIpPer15Min: 1 },
      () => now,
    );
    expect(ipOnly.tryConsume({ ip })).toBe(true);
    expect(ipOnly.tryConsume({ ip })).toBe(false);
  });

  it("EARS-13: a window resets once its duration elapses", () => {
    const perUser = new RateLimitService(
      { ...thresholds, perUserPer15Min: 1 },
      () => now,
    );
    expect(perUser.tryConsume({ ip, identifier })).toBe(true);
    expect(perUser.tryConsume({ ip, identifier })).toBe(false);
    now += 15 * 60 * 1000 + 1; // advance just past the 15-min window
    expect(perUser.tryConsume({ ip, identifier })).toBe(true);
  });
});
