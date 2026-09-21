import { describe, expect, it } from "vitest";

import {
  CONGRESS_SIGN_UP_WINDOW_CLOSES_AT,
  CONGRESS_SIGN_UP_WINDOW_OPENS_AT,
  resolveCongressSignUpSettings,
  resolveCongressSignUpWindow,
} from "./congress-signup.config.js";

const EVENT_ID = "6f1c0a2e-6a7b-4d2f-9b1e-0c3d4e5f6a7b";
const CONSENT_VERSION = `2026-09-20.sha256-${"a1b2c3d4".repeat(8)}`;

describe("044 congress sign-up — server configuration", () => {
  it("EARS-5: when the intake is configured, system shall take the congress event from server configuration and never from the submission", () => {
    const resolved = resolveCongressSignUpSettings({
      CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
      CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
    });

    expect(resolved).toEqual({
      ok: true,
      settings: { eventId: EVENT_ID, consentVersion: CONSENT_VERSION },
    });
  });

  it("EARS-5: when the configured event identifier is absent or not a uuid, system shall report the configuration unusable", () => {
    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
      }),
    ).toEqual({ ok: false, reason: "event-id-unset" });

    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_EVENT_ID: "the-congress",
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
      }),
    ).toEqual({ ok: false, reason: "event-id-malformed" });
  });

  it("EARS-9: when the configured consent version does not carry a publication date and a sha256 of the published text, system shall report the configuration unusable", () => {
    expect(
      resolveCongressSignUpSettings({ CONGRESS_SIGNUP_EVENT_ID: EVENT_ID }),
    ).toEqual({ ok: false, reason: "consent-version-unset" });

    for (const bad of [
      "2026-09-20",
      "2026-09-20.sha256-deadbeef",
      `20260920.sha256-${"a1b2c3d4".repeat(8)}`,
      `2026-09-20.sha256-${"A1B2C3D4".repeat(8)}`,
      `2026-09-20.md5-${"a1b2c3d4".repeat(8)}`,
      `2026-09-20.sha256-${"a1b2c3d4".repeat(8)}0`,
    ]) {
      expect(
        resolveCongressSignUpSettings({
          CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
          CONGRESS_SIGNUP_CONSENT_VERSION: bad,
        }),
      ).toEqual({ ok: false, reason: "consent-version-malformed" });
    }
  });

  it("EARS-28: when the clock is before the opening instant, system shall report the window as not yet open and carry that instant", () => {
    const before = new Date(Date.parse(CONGRESS_SIGN_UP_WINDOW_OPENS_AT) - 1);

    expect(resolveCongressSignUpWindow(before)).toEqual({
      state: "not-yet-open",
      opensAt: CONGRESS_SIGN_UP_WINDOW_OPENS_AT,
    });
  });

  it("EARS-28: when the clock is inside the window, system shall report the window as open", () => {
    const atOpen = new Date(Date.parse(CONGRESS_SIGN_UP_WINDOW_OPENS_AT));
    const justBeforeClose = new Date(
      Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT) - 1,
    );

    // The opening instant itself is inside the window; the closing instant is not.
    expect(resolveCongressSignUpWindow(atOpen)).toEqual({ state: "open" });
    expect(resolveCongressSignUpWindow(justBeforeClose)).toEqual({
      state: "open",
    });
  });

  it("EARS-28: when the clock has reached the closing instant, system shall report the window as closed", () => {
    const atClose = new Date(Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT));
    const after = new Date(Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT) + 1);

    expect(resolveCongressSignUpWindow(atClose)).toEqual({ state: "closed" });
    expect(resolveCongressSignUpWindow(after)).toEqual({ state: "closed" });
  });

  it("EARS-28: when the window instants are read, system shall place the opening at the owner-approved 2026-10-01 Moscow midnight and keep the close after it", () => {
    expect(CONGRESS_SIGN_UP_WINDOW_OPENS_AT).toBe("2026-10-01T00:00:00.000+03:00");
    expect(Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT)).toBeGreaterThan(
      Date.parse(CONGRESS_SIGN_UP_WINDOW_OPENS_AT),
    );
  });
});
