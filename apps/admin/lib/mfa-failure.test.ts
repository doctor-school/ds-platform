import { describe, expect, it } from "vitest";

import ru from "../messages/ru.json";
import { mfaFailurePresentation } from "./mfa-failure";

/**
 * 011 EARS-7/EARS-12 — the one place both MFA screens decide what a refusal LOOKS
 * like, so the enrollment and challenge cards cannot drift apart (they are required
 * to be indistinguishable to a caller, and an operator who learns the outage wording
 * on one screen must meet the same wording on the other).
 *
 * The mapping is the whole product decision of #1213: an IdP outage is a WARNING
 * about the service, not a DANGER verdict on the code the operator just typed.
 */
describe("mfaFailurePresentation", () => {
  it("EARS-7: a plain refusal renders the uniform wrong-code message in danger", () => {
    expect(mfaFailurePresentation({})).toEqual({
      messageKey: "errorGeneric",
      variant: "danger",
      testId: "mfa-error",
    });
  });

  it("EARS-7: a throttled refusal renders the wait message in danger", () => {
    expect(mfaFailurePresentation({ throttled: true })).toEqual({
      messageKey: "errorThrottled",
      variant: "danger",
      testId: "mfa-error",
    });
  });

  it("EARS-7: an outage renders the service-unavailable message as a warning", () => {
    expect(mfaFailurePresentation({ outage: true })).toEqual({
      messageKey: "errorOutage",
      variant: "warn",
      testId: "mfa-outage",
    });
  });

  it("EARS-7: an outage wins over throttling — the code was never checked", () => {
    expect(
      mfaFailurePresentation({ outage: true, throttled: true }),
    ).toMatchObject({ messageKey: "errorOutage", variant: "warn" });
  });
});

/**
 * EARS-12: RU copy comes from the typed catalog, never from the TSX — and the
 * enrollment and challenge blocks must both carry every key the mapper can ask for,
 * or one screen renders a raw key while the other renders a sentence.
 */
describe("RU catalog coverage", () => {
  const keys = [
    mfaFailurePresentation({}).messageKey,
    mfaFailurePresentation({ throttled: true }).messageKey,
    mfaFailurePresentation({ outage: true }).messageKey,
  ];

  for (const block of ["mfaEnroll", "mfaChallenge"] as const) {
    it(`EARS-12: ${block} carries every failure message the screens can render`, () => {
      expect(Object.keys(ru[block])).toEqual(expect.arrayContaining(keys));
    });
  }

  it("EARS-12: both screens word the outage identically", () => {
    expect(ru.mfaEnroll.errorOutage).toBe(ru.mfaChallenge.errorOutage);
  });
});
