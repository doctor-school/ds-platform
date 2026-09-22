import { describe, expect, it } from "vitest";

import {
  CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS,
  CONGRESS_SIGN_UP_WINDOW_CLOSES_AT,
  CONGRESS_SIGN_UP_WINDOW_OPENS_AT,
  resolveCongressSignUpSettings,
  resolveCongressSignUpTimingFloorMs,
  readCongressSignUpTimingFloorMs,
  resolveCongressSignUpWindow,
} from "./congress-signup.config.js";

const EVENT_ID = "6f1c0a2e-6a7b-4d2f-9b1e-0c3d4e5f6a7b";
const CONSENT_VERSION = `2026-09-20.sha256-${"a1b2c3d4".repeat(8)}`;
const VENUE = "Москва, Крокус Экспо, зал 3";

describe("044 congress sign-up — server configuration", () => {
  it("EARS-5: when the intake is configured, system shall take the congress event from server configuration and never from the submission", () => {
    const resolved = resolveCongressSignUpSettings({
      CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
      CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
      CONGRESS_SIGNUP_EVENT_VENUE: VENUE,
    });

    expect(resolved).toEqual({
      ok: true,
      settings: {
        eventId: EVENT_ID,
        consentVersion: CONSENT_VERSION,
        eventVenue: VENUE,
      },
    });
  });

  it("EARS-5: when the configured event identifier is absent or not a uuid, system shall report the configuration unusable", () => {
    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
        CONGRESS_SIGNUP_EVENT_VENUE: VENUE,
      }),
    ).toEqual({ ok: false, reason: "event-id-unset" });

    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_EVENT_ID: "the-congress",
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
        CONGRESS_SIGNUP_EVENT_VENUE: VENUE,
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

  it("EARS-13: when the congress venue is unset or blank, system shall report the configuration unusable rather than send a confirmation that names no place", () => {
    // The venue is read at MAIL time, long after the registration has
    // committed, so a deployment that forgot the key would otherwise accept
    // submissions for weeks and only then discover it cannot tell anyone where
    // to come. Failing closed at configuration time is what keeps "accepted"
    // meaning "and you will be told where to come".
    for (const missing of [undefined, "", "   "]) {
      expect(
        resolveCongressSignUpSettings({
          CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
          CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
          ...(missing === undefined
            ? {}
            : { CONGRESS_SIGNUP_EVENT_VENUE: missing }),
        }),
      ).toEqual({ ok: false, reason: "event-venue-unset" });
    }
  });

  it("EARS-13: when the configured venue carries surrounding whitespace, system shall resolve it trimmed", () => {
    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
        CONGRESS_SIGNUP_EVENT_VENUE: `  ${VENUE}  `,
      }),
    ).toEqual({
      ok: true,
      settings: {
        eventId: EVENT_ID,
        consentVersion: CONSENT_VERSION,
        eventVenue: VENUE,
      },
    });
  });

  it("EARS-7: when no route timing floor is configured, system shall resolve the conservative default so every runtime boots unchanged", () => {
    // The default is asserted by value, not merely by identity with the
    // constant: an accidental drop to a floor below the new-account branch
    // would reopen the existence oracle EARS-7 closes, and that regression must
    // fail here rather than only under a prod latency measurement.
    expect(CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS).toBe(1000);

    expect(resolveCongressSignUpTimingFloorMs({})).toEqual({
      ok: true,
      floorMs: CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS,
    });
    expect(
      resolveCongressSignUpTimingFloorMs({
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "",
      }),
    ).toEqual({ ok: true, floorMs: CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS });
  });

  it("EARS-7: when a route timing floor is configured as whole milliseconds, system shall resolve exactly that floor", () => {
    expect(
      resolveCongressSignUpTimingFloorMs({
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "2500",
      }),
    ).toEqual({ ok: true, floorMs: 2500 });

    // Zero is a legitimate operator choice (a test runtime that does not want
    // the pad), so it must resolve rather than read as «unset».
    expect(
      resolveCongressSignUpTimingFloorMs({
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "0",
      }),
    ).toEqual({ ok: true, floorMs: 0 });
  });

  it("EARS-7: when the configured route timing floor is not whole milliseconds, system shall report the configuration unusable instead of defaulting silently", () => {
    for (const bad of [
      "1s",
      "-5",
      "1.5",
      " 1000",
      "1e3",
      "1_000",
      "9007199254740993",
    ]) {
      expect(
        resolveCongressSignUpTimingFloorMs({
          CONGRESS_SIGNUP_TIMING_FLOOR_MS: bad,
        }),
      ).toEqual({ ok: false, reason: "timing-floor-malformed" });
    }
  });

  it("EARS-7: when the route timing floor is unusable, system shall refuse the whole intake configuration before any side effect", () => {
    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
        CONGRESS_SIGNUP_EVENT_VENUE: VENUE,
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "1s",
      }),
    ).toEqual({ ok: false, reason: "timing-floor-malformed" });

    // A usable floor changes nothing the intake writes: it is an interceptor
    // concern, so it deliberately does NOT appear in the settings the service
    // reads.
    expect(
      resolveCongressSignUpSettings({
        CONGRESS_SIGNUP_EVENT_ID: EVENT_ID,
        CONGRESS_SIGNUP_CONSENT_VERSION: CONSENT_VERSION,
        CONGRESS_SIGNUP_EVENT_VENUE: VENUE,
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "2500",
      }),
    ).toEqual({
      ok: true,
      settings: {
        eventId: EVENT_ID,
        consentVersion: CONSENT_VERSION,
        eventVenue: VENUE,
      },
    });
  });

  it("EARS-7: when the route floor is read per request, system shall read the one key it needs and not revalidate the whole environment", () => {
    // The floor is read on EVERY intake request (an operator raising it after a
    // live measurement must not need a redeploy), so it reads ONE key rather
    // than re-parsing the whole process environment through the api env schema.
    // Proved by an environment that carries nothing BUT that key: a full-schema
    // parse would throw on the missing required keys and silently hand back the
    // default, which is exactly the floor the operator did not configure.
    const original = process.env;
    try {
      process.env = {
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "2500",
      } as NodeJS.ProcessEnv;
      expect(readCongressSignUpTimingFloorMs()).toBe(2500);

      // Changed between two requests — read again, not cached at module init.
      process.env = {
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "1500",
      } as NodeJS.ProcessEnv;
      expect(readCongressSignUpTimingFloorMs()).toBe(1500);

      // Unusable or unset — the conservative default, the safe direction.
      process.env = {
        CONGRESS_SIGNUP_TIMING_FLOOR_MS: "1s",
      } as NodeJS.ProcessEnv;
      expect(readCongressSignUpTimingFloorMs()).toBe(
        CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS,
      );
      process.env = {} as NodeJS.ProcessEnv;
      expect(readCongressSignUpTimingFloorMs()).toBe(
        CONGRESS_SIGN_UP_DEFAULT_TIMING_FLOOR_MS,
      );
    } finally {
      process.env = original;
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
    expect(CONGRESS_SIGN_UP_WINDOW_OPENS_AT).toBe(
      "2026-10-01T00:00:00.000+03:00",
    );
    expect(Date.parse(CONGRESS_SIGN_UP_WINDOW_CLOSES_AT)).toBeGreaterThan(
      Date.parse(CONGRESS_SIGN_UP_WINDOW_OPENS_AT),
    );
  });
});
