import { beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "./rate-limit.service.js";
import {
  AUTH_SENDING_DOOR_PER_IP_15MIN,
  AUTH_SENDING_DOOR_RATE_LIMIT_BUCKET,
  DEFAULT_RATE_LIMIT_THRESHOLDS,
  type RateLimitDecision,
  type RateLimitThresholds,
} from "./rate-limit.types.js";

/** The receipt of an allowed decision (`undefined` when refused). */
const receiptOf = (d: RateLimitDecision) => (d.allowed ? d.receipt : undefined);

// EARS-13: the auth rate limiter. Three fixed-window counters — per-user (the
// submitted identifier, 10/15 min after #222), per-IP (20/15 min), per-ASN
// (100/h) — answer
// one question per attempt: may it proceed? Allowed only when EVERY applicable
// window has room; a refused attempt consumes NOTHING. Exercised here against a
// controllable fake clock so the window-reset boundary is deterministic, with no
// Nest/HTTP in the loop (ADR-0001 §7).
describe("RateLimitService (EARS-13)", () => {
  const thresholds: RateLimitThresholds = {
    perUserPer15Min: 5,
    perIpPer15Min: 20,
    perAsnPerHour: 100,
    scopedPerIpPer15Min: { "test:wide": 60 },
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

  it("EARS-13: allows an attempt when every dimension has room", async () => {
    expect(await svc.tryConsume({ ip, identifier, asn })).toBe(true);
  });

  it("EARS-13: a scope with its own per-address ceiling is held to that ceiling, not the platform one (#2294)", async () => {
    const scope = "test:wide";
    // 60, not the platform 20: the scoped bucket declares its own number.
    for (let i = 0; i < 60; i++) {
      expect(await svc.tryConsume({ ip, scope })).toBe(true);
    }
    expect(await svc.tryConsume({ ip, scope })).toBe(false);
    // …and the platform budget for the SAME address is untouched by all of it.
    expect(await svc.tryConsume({ ip })).toBe(true);
  });

  it("EARS-13: a scope with no declared ceiling falls back to the platform per-address ceiling (#2294)", async () => {
    const scope = "test:undeclared";
    for (let i = 0; i < thresholds.perIpPer15Min; i++) {
      expect(await svc.tryConsume({ ip, scope })).toBe(true);
    }
    expect(await svc.tryConsume({ ip, scope })).toBe(false);
  });

  it("EARS-13: enforces the per-user 15-min limit, refusing the over-limit attempt", async () => {
    // 5/15 min: five succeed (distinct IPs so only the per-user window can trip).
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      expect(await svc.tryConsume({ ip: `10.0.0.${i}`, identifier })).toBe(
        true,
      );
    }
    expect(await svc.tryConsume({ ip: "10.0.0.99", identifier })).toBe(false);
  });

  it("EARS-13: the per-user window is per identifier — a different identifier is unaffected", async () => {
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      await svc.tryConsume({ ip: `10.0.0.${i}`, identifier });
    }
    expect(await svc.tryConsume({ ip: "10.0.0.99", identifier })).toBe(false);
    expect(
      await svc.tryConsume({ ip: "10.0.0.99", identifier: "other@ds.test" }),
    ).toBe(true);
  });

  it("EARS-13: per-user keying is case-insensitive (same identifier, different case)", async () => {
    for (let i = 0; i < thresholds.perUserPer15Min; i++) {
      await svc.tryConsume({ ip: `10.0.0.${i}`, identifier: "User@DS.test" });
    }
    expect(
      await svc.tryConsume({ ip: "10.0.0.99", identifier: "user@ds.test" }),
    ).toBe(false);
  });

  it("EARS-13: enforces the per-IP 15-min limit independent of identifier", async () => {
    // Same IP, distinct identifiers (so per-user never trips): the 21st refused.
    for (let i = 0; i < thresholds.perIpPer15Min; i++) {
      expect(await svc.tryConsume({ ip, identifier: `u${i}@ds.test` })).toBe(
        true,
      );
    }
    expect(await svc.tryConsume({ ip, identifier: "u99@ds.test" })).toBe(false);
  });

  it("EARS-13: a refused attempt consumes nothing (only allowed attempts are counted)", async () => {
    const tiny = new RateLimitService(
      { ...thresholds, perUserPer15Min: 1 },
      () => now,
    );
    expect(await tiny.tryConsume({ ip, identifier })).toBe(true);
    expect(await tiny.tryConsume({ ip, identifier })).toBe(false); // per-user refused
    // The refusal did not spend the per-IP budget: a different identifier on the
    // same IP still proceeds.
    expect(await tiny.tryConsume({ ip, identifier: "fresh@ds.test" })).toBe(
      true,
    );
  });

  it("EARS-13: the per-ASN window is only enforced when the edge supplies an ASN", async () => {
    const perAsn = new RateLimitService(
      {
        perUserPer15Min: 100,
        perIpPer15Min: 100,
        perAsnPerHour: 1,
        scopedPerIpPer15Min: {},
      },
      () => now,
    );
    expect(
      await perAsn.tryConsume({ ip: "1.1.1.1", identifier: "a@ds.test", asn }),
    ).toBe(true);
    expect(
      await perAsn.tryConsume({ ip: "1.1.1.2", identifier: "b@ds.test", asn }),
    ).toBe(false);
    // Without an ASN the per-ASN window cannot bucket the request, so it is
    // skipped (degrades to user/IP) rather than refusing blindly.
    expect(
      await perAsn.tryConsume({ ip: "1.1.1.3", identifier: "c@ds.test" }),
    ).toBe(true);
  });

  it("EARS-13: an identifier-less attempt is gated by IP alone (per-user window skipped)", async () => {
    const ipOnly = new RateLimitService(
      { ...thresholds, perIpPer15Min: 1 },
      () => now,
    );
    expect(await ipOnly.tryConsume({ ip })).toBe(true);
    expect(await ipOnly.tryConsume({ ip })).toBe(false);
  });

  it("EARS-13: a window resets once its duration elapses", async () => {
    const perUser = new RateLimitService(
      { ...thresholds, perUserPer15Min: 1 },
      () => now,
    );
    expect(await perUser.tryConsume({ ip, identifier })).toBe(true);
    expect(await perUser.tryConsume({ ip, identifier })).toBe(false);
    now += 15 * 60 * 1000 + 1; // advance just past the 15-min window
    expect(await perUser.tryConsume({ ip, identifier })).toBe(true);
  });

  // #222 (EARS-13, ADR-0001 §7): the per-user ceiling is RAISED 5 → 10 / 15 min so
  // a legitimate forgot-password → login recovery flow is not throttled, and a
  // success FORGIVES (clears) the per-user window so the next attempt starts fresh
  // — without forgiving the broader per-IP / per-ASN windows (an attacker spraying
  // many identifiers from one origin must still hit those ceilings).
  describe("#222 relaxed per-user ceiling + forgive-on-success", () => {
    it("EARS-13: the default per-user ceiling is 10 / 15 min", async () => {
      expect(DEFAULT_RATE_LIMIT_THRESHOLDS.perUserPer15Min).toBe(10);
      // The broader windows are unchanged by #222.
      expect(DEFAULT_RATE_LIMIT_THRESHOLDS.perIpPer15Min).toBe(20);
      expect(DEFAULT_RATE_LIMIT_THRESHOLDS.perAsnPerHour).toBe(100);
    });

    it("EARS-13: when an attempt succeeds, the system shall clear the per-user window for that identifier", async () => {
      const perUser = new RateLimitService(
        { ...thresholds, perUserPer15Min: 1 },
        () => now,
      );
      expect(await perUser.tryConsume({ ip, identifier })).toBe(true);
      expect(await perUser.tryConsume({ ip, identifier })).toBe(false); // window full
      // A success forgives the per-user window keyed identically to tryConsume…
      await perUser.reset({ ip, identifier });
      // …so the very next attempt for that identifier proceeds again.
      expect(await perUser.tryConsume({ ip, identifier })).toBe(true);
    });

    it("EARS-13: reset() is case-insensitive on the identifier (same key as tryConsume)", async () => {
      const perUser = new RateLimitService(
        { ...thresholds, perUserPer15Min: 1 },
        () => now,
      );
      expect(await perUser.tryConsume({ ip, identifier: "User@DS.test" })).toBe(
        true,
      );
      expect(await perUser.tryConsume({ ip, identifier: "user@ds.test" })).toBe(
        false,
      );
      await perUser.reset({ ip, identifier: "USER@ds.TEST" });
      expect(await perUser.tryConsume({ ip, identifier: "user@ds.test" })).toBe(
        true,
      );
    });

    it("EARS-13: reset() forgives ONLY the per-user window — the per-IP window is untouched", async () => {
      const svc = new RateLimitService(
        {
          perUserPer15Min: 100,
          perIpPer15Min: 2,
          perAsnPerHour: 100,
          scopedPerIpPer15Min: {},
        },
        () => now,
      );
      // Spend the per-IP budget with two distinct identifiers from one origin.
      expect(await svc.tryConsume({ ip, identifier: "a@ds.test" })).toBe(true);
      expect(await svc.tryConsume({ ip, identifier: "b@ds.test" })).toBe(true);
      expect(await svc.tryConsume({ ip, identifier: "c@ds.test" })).toBe(false); // per-IP full
      // Forgiving one identifier's per-user window does NOT refund the per-IP one.
      await svc.reset({ ip, identifier: "a@ds.test" });
      expect(await svc.tryConsume({ ip, identifier: "c@ds.test" })).toBe(false);
    });

    it("EARS-13: reset() forgives ONLY the per-user window — the per-ASN window is untouched", async () => {
      const svc = new RateLimitService(
        {
          perUserPer15Min: 100,
          perIpPer15Min: 100,
          perAsnPerHour: 1,
          scopedPerIpPer15Min: {},
        },
        () => now,
      );
      expect(
        await svc.tryConsume({ ip: "1.1.1.1", identifier: "a@ds.test", asn }),
      ).toBe(true);
      expect(
        await svc.tryConsume({ ip: "1.1.1.2", identifier: "b@ds.test", asn }),
      ).toBe(false); // per-ASN full
      await svc.reset({ ip: "1.1.1.1", identifier: "a@ds.test", asn });
      expect(
        await svc.tryConsume({ ip: "1.1.1.3", identifier: "c@ds.test", asn }),
      ).toBe(false);
    });

    it("EARS-13: reset() with no identifier is a no-op (no per-user key to clear)", async () => {
      const ipOnly = new RateLimitService(
        { ...thresholds, perIpPer15Min: 1 },
        () => now,
      );
      expect(await ipOnly.tryConsume({ ip })).toBe(true);
      await ipOnly.reset({ ip }); // no identifier → nothing to forgive
      expect(await ipOnly.tryConsume({ ip })).toBe(false); // per-IP still spent
    });
  });

  // #1646: a non-auth consumer of the limiter must own its bucket. The per-IP
  // (and per-ASN) counters are keyed inside the caller's scope tag; the
  // argument-less 003 form passes none and keeps the shared auth budget.
  describe("scoped source-address buckets (#1646)", () => {
    const SCOPE = "storefront:specialty-choice";

    it("EARS-13: a scoped caller exhausting its per-IP window leaves the shared auth window untouched", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 2 },
        () => now,
      );
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(false); // scoped bucket full
      // Same source address, no scope — the auth surface's own window, untouched.
      expect(await svc.tryConsume({ ip, identifier })).toBe(true);
      expect(await svc.tryConsume({ ip, identifier })).toBe(true);
    });

    it("EARS-13: an exhausted auth window does not refuse the scoped caller", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 2 },
        () => now,
      );
      expect(await svc.tryConsume({ ip, identifier: "a@ds.test" })).toBe(true);
      expect(await svc.tryConsume({ ip, identifier: "b@ds.test" })).toBe(true);
      expect(await svc.tryConsume({ ip, identifier: "c@ds.test" })).toBe(false); // auth bucket full
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
    });

    it("EARS-13: two scopes from one address are disjoint budgets", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 1 },
        () => now,
      );
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(false);
      expect(await svc.tryConsume({ ip, scope: "other:route" })).toBe(true);
    });

    it("EARS-13: the per-ASN window is scoped the same way", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 1_000, perAsnPerHour: 1 },
        () => now,
      );
      expect(await svc.tryConsume({ ip: "1.1.1.1", asn, scope: SCOPE })).toBe(
        true,
      );
      expect(await svc.tryConsume({ ip: "1.1.1.2", asn, scope: SCOPE })).toBe(
        false,
      );
      expect(await svc.tryConsume({ ip: "1.1.1.3", asn })).toBe(true); // auth's ASN window
    });

    it("EARS-13: a scoped window rolls on its own 15-min boundary", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 1 },
        () => now,
      );
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(false);
      now += 15 * 60 * 1000;
      expect(await svc.tryConsume({ ip, scope: SCOPE })).toBe(true);
    });

    it("EARS-13: an undefined scope keys exactly as before — the 003 call sites are byte-for-byte unchanged", async () => {
      const svc = new RateLimitService(
        { ...thresholds, perIpPer15Min: 1 },
        () => now,
      );
      expect(await svc.tryConsume({ ip, scope: undefined })).toBe(true);
      expect(await svc.tryConsume({ ip })).toBe(false); // same unscoped key
    });
  });

  // #2684: one shared public address (a hospital, a congress hall, carrier
  // CGNAT) signs in many doctors by code. The source-address window splits by
  // door: a VERIFICATION door (password / code login, verify, reset-complete)
  // gives back its own per-IP unit on success, so the 20/15 min window counts
  // failed verifications; a SENDING door (code request, register, resend,
  // reset request, hand-off) keeps consuming in its own 60/15 min window.
  describe("#2684 door-split per-IP window", () => {
    const withSending: RateLimitThresholds = {
      ...thresholds,
      scopedPerIpPer15Min: {
        ...thresholds.scopedPerIpPer15Min,
        [AUTH_SENDING_DOOR_RATE_LIMIT_BUCKET]: 60,
      },
    };
    let split: RateLimitService;
    beforeEach(() => {
      split = new RateLimitService(withSending, () => now);
    });

    it("EARS-13: the default sending-door per-IP ceiling is 60 / 15 min, the verification ceiling stays 20", async () => {
      expect(AUTH_SENDING_DOOR_PER_IP_15MIN).toBe(60);
      expect(
        DEFAULT_RATE_LIMIT_THRESHOLDS.scopedPerIpPer15Min[
          AUTH_SENDING_DOOR_RATE_LIMIT_BUCKET
        ],
      ).toBe(60);
      expect(DEFAULT_RATE_LIMIT_THRESHOLDS.perIpPer15Min).toBe(20);
    });

    it("EARS-13: a sending door admits 60 requests from one address and refuses the 61st", async () => {
      for (let i = 0; i < 60; i++) {
        expect(await split.tryConsume({ ip, door: "sending" })).toBe(true);
      }
      expect(await split.tryConsume({ ip, door: "sending" })).toBe(false);
    });

    it("EARS-13: sending-door traffic does not consume the verification window of the same address", async () => {
      for (let i = 0; i < 60; i++)
        await split.tryConsume({ ip, door: "sending" });
      for (let i = 0; i < thresholds.perIpPer15Min; i++) {
        expect(await split.tryConsume({ ip })).toBe(true);
      }
      expect(await split.tryConsume({ ip })).toBe(false);
    });

    it("EARS-13: the per-ASN window is shared by both doors (unchanged)", async () => {
      const tight = new RateLimitService(
        { ...withSending, perAsnPerHour: 2 },
        () => now,
      );
      expect(await tight.tryConsume({ ip, asn, door: "sending" })).toBe(true);
      expect(await tight.tryConsume({ ip, asn })).toBe(true);
      expect(await tight.tryConsume({ ip, asn, door: "sending" })).toBe(false);
      expect(await tight.tryConsume({ ip, asn })).toBe(false);
    });

    it("EARS-13: when a verification succeeds, the system shall give back that request's own per-IP unit", async () => {
      // Many successes from one address: each consumes then refunds its unit.
      for (let i = 0; i < 100; i++) {
        const receipt = receiptOf(await split.consume({ ip }));
        expect(receipt).toBeDefined();
        await split.refundIpUnit(ip, receipt?.ipWindowResetAtMs);
      }
      // The window is empty again — the full failure budget is still there.
      for (let i = 0; i < thresholds.perIpPer15Min; i++) {
        expect(await split.tryConsume({ ip })).toBe(true);
      }
      expect(await split.tryConsume({ ip })).toBe(false);
    });

    it("EARS-13: an interleaved success refunds only its own unit — it never clears the failed verifications", async () => {
      for (let i = 0; i < thresholds.perIpPer15Min - 1; i++) {
        expect(await split.tryConsume({ ip })).toBe(true); // failures
      }
      const success = receiptOf(await split.consume({ ip })); // the 20th: a success
      expect(success).toBeDefined();
      await split.refundIpUnit(ip, success?.ipWindowResetAtMs);
      expect(await split.tryConsume({ ip })).toBe(true); // 20th failure
      expect(await split.tryConsume({ ip })).toBe(false); // 21st → refused
    });

    it("EARS-13: a refund on an empty or rolled-over window grants no credit", async () => {
      await split.refundIpUnit(ip, undefined); // nothing consumed yet
      const stale = receiptOf(await split.consume({ ip }));
      now += 15 * 60 * 1000; // the window rolls over
      await split.refundIpUnit(ip, stale?.ipWindowResetAtMs);
      for (let i = 0; i < thresholds.perIpPer15Min; i++) {
        expect(await split.tryConsume({ ip })).toBe(true);
      }
      expect(await split.tryConsume({ ip })).toBe(false);
    });

    it("EARS-13: a refund after the window rolled over does not decrement the fresh window", async () => {
      // The success's own unit was consumed in window A…
      const receipt = receiptOf(await split.consume({ ip }));
      expect(receipt).toBeDefined();
      now += 15 * 60 * 1000; // …window A rolls over before the handler refunds
      // Window B opens with a failure the refund must not erase.
      for (let i = 0; i < thresholds.perIpPer15Min; i++) {
        expect(await split.tryConsume({ ip })).toBe(true);
      }
      await split.refundIpUnit(ip, receipt?.ipWindowResetAtMs);
      expect(await split.tryConsume({ ip })).toBe(false);
    });

    it("EARS-13: a refund leaves the sending-door window untouched", async () => {
      let last;
      for (let i = 0; i < 60; i++)
        last = receiptOf(await split.consume({ ip, door: "sending" }));
      await split.refundIpUnit(ip, last?.ipWindowResetAtMs);
      expect(await split.tryConsume({ ip, door: "sending" })).toBe(false);
    });
  });

  describe("refusal names its window (#3379)", () => {
    const WINDOW_MS = 15 * 60 * 1000;

    it("003 EARS-13: a per-IP refusal returns the per-IP window and its reset time", async () => {
      const opened = now;
      for (let i = 0; i < thresholds.perIpPer15Min; i++) {
        await svc.tryConsume({ ip, identifier: `u${i}@ds.test` });
        now += 1000;
      }
      expect(await svc.consume({ ip, identifier: "u99@ds.test" })).toEqual({
        allowed: false,
        refusal: {
          window: "ip",
          resetAtMs: opened + WINDOW_MS,
          atMs: now,
          tripped: true,
        },
      });
    });

    it("003 EARS-13: a per-user refusal names the identifier window", async () => {
      for (let i = 0; i < thresholds.perUserPer15Min; i++) {
        await svc.tryConsume({ ip: `10.0.0.${i}`, identifier });
      }
      const d = await svc.consume({ ip: "10.0.0.99", identifier });
      expect(d.allowed).toBe(false);
      expect(d.allowed ? undefined : d.refusal.window).toBe("user");
    });

    it("003 EARS-15: only the first refusal of a live window is the trip; a new window trips afresh", async () => {
      for (let i = 0; i < thresholds.perUserPer15Min; i++) {
        await svc.tryConsume({ ip: `10.0.0.${i}`, identifier });
      }
      const trip = async () => {
        const d = await svc.consume({ ip: "10.0.0.99", identifier });
        return d.allowed ? undefined : d.refusal.tripped;
      };
      expect(await trip()).toBe(true);
      expect(await trip()).toBe(false);
      now += WINDOW_MS;
      for (let i = 0; i < thresholds.perUserPer15Min; i++) {
        await svc.tryConsume({ ip: `10.0.1.${i}`, identifier });
      }
      expect(await trip()).toBe(true);
    });

    it("003 EARS-13: an allowed attempt returns its receipt", async () => {
      expect(await svc.consume({ ip })).toEqual({
        allowed: true,
        receipt: { ipWindowResetAtMs: now + WINDOW_MS },
      });
    });
  });
});
