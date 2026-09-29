import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #2333 — 021 EARS-3 / LD-4 re-decided ONCE THE SESSION EXISTS.
 *
 * The door's `landing` is resolved at GUEST render: no session, so the only
 * read is the guest-cookie store. A doctor whose specialty lives on the PROFILE
 * (and not in this browser's guest cookie) was therefore sent to `afterLogin`
 * after signing in, while the same doctor opening `/login` already signed in is
 * sent to the feed. The re-resolution is the SAME package rule
 * (`resolveArrivalLanding`) run on the server again, in a server action whose
 * request now carries the new session cookie.
 *
 * Mocked seams: `next/headers` (the action's own request — here WITH the session
 * the sign-in just set) and the global `fetch` the specialty read goes through.
 * The LD-4 rule and the specialty read stay the real ones.
 */
const h = vi.hoisted(() => ({
  cookie: "__Host-ds_session=fresh",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: h.cookie }),
}));

import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { signedInLandingAction } from "./signed-in-landing";

const PROFILE_CHOICE = {
  specialty: {
    id: "11111111-1111-4111-8111-111111111111",
    code: "kardiologiya",
    name: "Кардиология",
    isOther: false,
  },
  storedIn: "profile",
};

const specialtyFetch = vi.fn();

beforeEach(() => {
  h.cookie = "__Host-ds_session=fresh";
  specialtyFetch.mockReset();
  vi.stubGlobal("fetch", specialtyFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("021 EARS-3 (#2333): the landing is re-decided for the NEW session", () => {
  it("021 EARS-3: a profile specialty with no guest choice lands the signed-in doctor on the feed", async () => {
    specialtyFetch.mockResolvedValue(
      new Response(JSON.stringify(PROFILE_CHOICE), { status: 200 }),
    );

    const action = signedInLandingAction(DOCTOR_FIXTURE);

    expect(action).toBeTypeOf("function");
    expect(await action!()).toBe("/events");
    // The SIGNED-IN read, made with the session the action's request carries.
    const [url, init] = specialtyFetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/me\/specialty$/);
    expect(new Headers((init as RequestInit).headers).get("cookie")).toContain(
      "__Host-ds_session=fresh",
    );
  });

  it("021 EARS-3: nothing remembered on the profile either — the afterLogin landing stands", async () => {
    specialtyFetch.mockResolvedValue(
      new Response(JSON.stringify({ specialty: null, storedIn: "none" }), {
        status: 200,
      }),
    );

    expect(await signedInLandingAction(DOCTOR_FIXTURE)!()).toBe("/");
  });

  it("021 EARS-3: a host whose landing is not specialty-aware gets NO action — its constant landing needs no round trip", () => {
    expect(signedInLandingAction(ACADEMY_FIXTURE)).toBeUndefined();
    expect(specialtyFetch).not.toHaveBeenCalled();
  });
});
