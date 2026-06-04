import { beforeEach, describe, expect, it } from "vitest";
import { SmsBudgetService } from "./sms-budget.service.js";
import type { SmsBudgetThresholds } from "./sms-budget.types.js";

// EARS-14: the SMS toll-fraud budget. The service owns four fixed-window counters
// — per-phone (3/h), per-IP (10/h), per-ASN (100/h), and a global daily breaker
// (≤2000/day) — and answers a single question per attempted send: may this SMS go
// out? A send is allowed only when EVERY applicable window has room; a refused
// send consumes NOTHING (no SMS reached the provider, so no budget is spent). The
// guard is exercised here against a controllable fake clock so the window-reset
// boundary is deterministic, with no Nest/HTTP in the loop (design §10, §2).
describe("SmsBudgetService (EARS-14)", () => {
  const thresholds: SmsBudgetThresholds = {
    perPhonePerHour: 3,
    perIpPerHour: 10,
    perAsnPerHour: 100,
    globalPerDay: 2000,
  };
  const phone = "+79991234567";
  const ip = "203.0.113.7";
  const asn = "AS64500";
  let now: number;
  let svc: SmsBudgetService;

  beforeEach(() => {
    now = 1_700_000_000_000;
    svc = new SmsBudgetService(thresholds, () => now);
  });

  it("EARS-14: allows a send when every threshold has room", () => {
    expect(svc.tryConsume({ phone, ip, asn })).toBe(true);
  });

  it("EARS-14: enforces the per-phone hourly limit, refusing the over-limit send", () => {
    // 3/h: three succeed, the fourth for the same phone is refused.
    for (let i = 0; i < thresholds.perPhonePerHour; i++) {
      expect(svc.tryConsume({ phone, ip: `10.0.0.${i}`, asn })).toBe(true);
    }
    expect(svc.tryConsume({ phone, ip: "10.0.0.99", asn })).toBe(false);
  });

  it("EARS-14: per-phone limit is per number — a different phone is unaffected", () => {
    for (let i = 0; i < thresholds.perPhonePerHour; i++) {
      svc.tryConsume({ phone, ip: `10.0.0.${i}`, asn });
    }
    expect(svc.tryConsume({ phone, ip: "10.0.0.99", asn })).toBe(false);
    // A distinct phone still has its own full budget.
    expect(svc.tryConsume({ phone: "+79990000000", ip: "10.0.0.99", asn })).toBe(
      true,
    );
  });

  it("EARS-14: enforces the per-IP hourly limit independent of phone", () => {
    // Same IP, distinct phones (so per-phone never trips): the 11th from one IP refused.
    for (let i = 0; i < thresholds.perIpPerHour; i++) {
      expect(svc.tryConsume({ phone: `+7999000${1000 + i}`, ip, asn })).toBe(true);
    }
    expect(svc.tryConsume({ phone: "+79990002000", ip, asn })).toBe(false);
  });

  it("EARS-14: the global daily breaker refuses every send once the budget is exhausted", () => {
    const tiny = new SmsBudgetService(
      { ...thresholds, globalPerDay: 1 },
      () => now,
    );
    expect(tiny.tryConsume({ phone, ip, asn })).toBe(true);
    // Different phone + IP so only the global daily window can be the cause.
    expect(tiny.tryConsume({ phone: "+70000000000", ip: "198.51.100.1", asn })).toBe(
      false,
    );
  });

  it("EARS-14: a breaker that is already open (budget 0) refuses the first send", () => {
    const open = new SmsBudgetService(
      { ...thresholds, globalPerDay: 0 },
      () => now,
    );
    expect(open.tryConsume({ phone, ip, asn })).toBe(false);
  });

  it("EARS-14: the per-ASN window is only enforced when the edge supplies an ASN", () => {
    const perAsn = new SmsBudgetService(
      { ...thresholds, perAsnPerHour: 1, perPhonePerHour: 100, perIpPerHour: 100 },
      () => now,
    );
    expect(perAsn.tryConsume({ phone: "+7100", ip: "1.1.1.1", asn })).toBe(true);
    // Second send from the same ASN is over the 1/h ASN cap.
    expect(perAsn.tryConsume({ phone: "+7101", ip: "1.1.1.2", asn })).toBe(false);
    // Without an ASN, the per-ASN window cannot bucket the request, so it is
    // skipped (degrades to phone/IP/global) rather than refusing blindly.
    expect(perAsn.tryConsume({ phone: "+7102", ip: "1.1.1.3" })).toBe(true);
    expect(perAsn.tryConsume({ phone: "+7103", ip: "1.1.1.4" })).toBe(true);
  });

  it("EARS-14: a refused send consumes no budget (the SMS never went out)", () => {
    const tiny = new SmsBudgetService(
      { ...thresholds, perPhonePerHour: 1 },
      () => now,
    );
    expect(tiny.tryConsume({ phone, ip, asn })).toBe(true);
    expect(tiny.tryConsume({ phone, ip, asn })).toBe(false); // refused
    // The refusal did not spend the per-IP / global budget: a different phone on
    // the same IP still sends, proving only allowed sends are counted.
    expect(tiny.tryConsume({ phone: "+79990000001", ip, asn })).toBe(true);
  });

  it("EARS-14: a window resets once its duration elapses", () => {
    const perPhone = new SmsBudgetService(
      { ...thresholds, perPhonePerHour: 1 },
      () => now,
    );
    expect(perPhone.tryConsume({ phone, ip, asn })).toBe(true);
    expect(perPhone.tryConsume({ phone, ip, asn })).toBe(false);
    now += 60 * 60 * 1000 + 1; // advance just past the hourly window
    expect(perPhone.tryConsume({ phone, ip, asn })).toBe(true);
  });
});
