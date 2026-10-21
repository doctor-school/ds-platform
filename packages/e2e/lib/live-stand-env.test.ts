import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pw = vi.hoisted(() => ({
  skip: vi.fn(),
  beforeAll: vi.fn(),
}));
vi.mock("@playwright/test", () => ({ test: pw }));

import {
  CONGRESS_SIGNUP_STAND_VARS,
  congressSignUpEnvProblem,
  liveStandGate,
} from "./live-stand-env";

/**
 * #2073 D6 (gate row 28) — the one live-stand env gate both hosts bind. Bare
 * CI skips inert naming the host's own variable; an intended-but-incomplete
 * env fails loudly naming every missing variable; a complete env is a no-op.
 */
const TIER_VAR = /^(E2E_|IDP_ISSUER$|MAILPIT_URL$)/;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (TIER_VAR.test(key)) delete process.env[key];
  }
  pw.skip.mockReset();
  pw.beforeAll.mockReset();
});

afterEach(() => {
  process.env = saved;
});

/** Run the `beforeAll` hook the gate registered and return what it threw. */
function registeredFailure(): string {
  expect(pw.beforeAll).toHaveBeenCalledTimes(1);
  const hook = pw.beforeAll.mock.calls[0]![0] as () => void;
  try {
    hook();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("the registered beforeAll did not throw");
}

describe("live-stand env gate (#2073 D6)", () => {
  it("bare CI skips inert, naming the host's own storefront variable", () => {
    const doctor = liveStandGate({
      urlVar: "E2E_DOCTOR_URL",
      playwrightTimeout: "the Playwright timeout",
    });
    doctor.requireLiveStandEnv(["E2E_DOCTOR_URL", "IDP_ISSUER"]);

    expect(pw.skip).toHaveBeenCalledWith(
      true,
      "006 room live-stand tier inert — none of E2E_DOCTOR_URL / IDP_ISSUER / MAILPIT_URL is set (bare CI). See the env-set docblock at the head of this spec.",
    );
    expect(pw.beforeAll).not.toHaveBeenCalled();
  });

  it("an intended but incomplete env fails loudly with every missing variable named", () => {
    process.env.E2E_PORTAL_URL = "http://portal.test";
    const portal = liveStandGate({
      urlVar: "E2E_PORTAL_URL",
      playwrightTimeout: "the 120 s Playwright timeout",
    });
    portal.requireLiveStandEnv(["E2E_PORTAL_URL", "IDP_ISSUER", "MAILPIT_URL"]);

    expect(pw.skip).not.toHaveBeenCalled();
    expect(registeredFailure()).toBe(
      "006 room live-stand tier was INTENDED (some E2E_* env is exported) but is INCOMPLETE — missing env: IDP_ISSUER, MAILPIT_URL. Export the full set listed in the docblock at the head of this spec, or unset every E2E_*/IDP_ISSUER/MAILPIT_URL variable to run inert.",
    );
  });

  it("a complete env is a no-op", () => {
    process.env.E2E_DOCTOR_URL = "http://doctor.test";
    process.env.IDP_ISSUER = "http://idp.test";
    process.env.MAILPIT_URL = "http://mail.test";
    liveStandGate({
      urlVar: "E2E_DOCTOR_URL",
      playwrightTimeout: "the Playwright timeout",
    }).requireLiveStandEnv(["E2E_DOCTOR_URL", "IDP_ISSUER", "MAILPIT_URL"]);

    expect(pw.skip).not.toHaveBeenCalled();
    expect(pw.beforeAll).not.toHaveBeenCalled();
  });

  it("another host's URL variable alone does not count as this host's stand", () => {
    process.env.E2E_PORTAL_URL = "http://portal.test";
    const doctor = liveStandGate({
      urlVar: "E2E_DOCTOR_URL",
      playwrightTimeout: "the Playwright timeout",
    });
    expect(doctor.LIVE_STAND_VARS).toEqual([
      "E2E_DOCTOR_URL",
      "IDP_ISSUER",
      "MAILPIT_URL",
    ]);
    expect(doctor.liveStandTierIntended()).toBe(false);
  });

  it("an over-long heartbeat on an intended tier is refused in the host's own words", () => {
    process.env.E2E_PORTAL_URL = "http://portal.test";
    process.env.E2E_ROOM_HEARTBEAT_SECONDS = "60";
    const seconds = liveStandGate({
      urlVar: "E2E_PORTAL_URL",
      playwrightTimeout: "the 120 s Playwright timeout",
    }).requireShortHeartbeat();

    expect(seconds).toBe(60);
    expect(registeredFailure()).toBe(
      'E2E_ROOM_HEARTBEAT_SECONDS is "60" — it must be a positive number ≤ 10. The api under test must be booted with the matching ROOM_HEARTBEAT_INTERVAL_SECONDS (its default 60 makes these waits exceed the 120 s Playwright timeout).',
    );
  });

  it("an unset heartbeat keeps the historical 2 s cadence", () => {
    expect(
      liveStandGate({
        urlVar: "E2E_DOCTOR_URL",
        playwrightTimeout: "the Playwright timeout",
      }).requireShortHeartbeat(),
    ).toBe(2);
    expect(pw.skip).not.toHaveBeenCalled();
  });
});

/**
 * #3149 — the congress intake refuses every submission with one generic 422
 * while any `CONGRESS_SIGNUP_*` key the api reads is unset, so a live spec
 * that drives a real sign-up names the missing keys before it sends one.
 */
describe("congressSignUpEnvProblem (#3149)", () => {
  const complete = Object.fromEntries(
    CONGRESS_SIGNUP_STAND_VARS.map((name) => [name, "set"]),
  );

  it("is null when every key the intake reads is set", () => {
    expect(congressSignUpEnvProblem(complete)).toBeNull();
  });

  it("names every missing key, blank counted as missing", () => {
    const problem = congressSignUpEnvProblem({
      ...complete,
      CONGRESS_SIGNUP_EVENT_ID: undefined,
      CONGRESS_SIGNUP_EVENT_DAYS: "  ",
    });
    expect(problem).toContain(
      "CONGRESS_SIGNUP_EVENT_ID, CONGRESS_SIGNUP_EVENT_DAYS",
    );
    expect(problem).not.toContain("CONGRESS_SIGNUP_CONSENT_VERSION,");
    expect(problem).toContain("infra/dev-stand/.env.example");
  });

  it("covers the five keys the intake refuses without", () => {
    expect([...CONGRESS_SIGNUP_STAND_VARS]).toEqual([
      "CONGRESS_SIGNUP_EVENT_ID",
      "CONGRESS_SIGNUP_CONSENT_VERSION",
      "CONGRESS_SIGNUP_WINDOW_OPENS_AT",
      "CONGRESS_SIGNUP_WINDOW_CLOSES_AT",
      "CONGRESS_SIGNUP_EVENT_DAYS",
    ]);
  });
});
