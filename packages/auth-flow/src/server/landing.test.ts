import { describe, expect, it, vi } from "vitest";

import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import {
  NO_SPECIALTY_CHOICE,
  resolveArrivalLanding,
  resolveDirectArrivalLanding,
  resolveRememberedSpecialty,
  type RememberedSpecialty,
} from "./landing";

const DOCTOR_LANDING = DOCTOR_FIXTURE.landing;
if (!DOCTOR_LANDING.specialtyAware) {
  throw new Error("the doctor fixture is the specialty-aware host");
}
const DOCTOR_READS = { landing: DOCTOR_LANDING };

/**
 * 021 EARS-3 (#1539) — LD-4, the direct-arrival landing, as a PACKAGE rule over
 * the host config (#2027 PR 1.5, gate §4.3 row «resolveDirectArrivalLanding»).
 *
 * A doctor who opened a door on their own carries no return target, so LD-4
 * fixes what stands in its place: the feed the config names when the platform
 * remembers a specialty (017 `SpecialtyChosen`), the config's `afterLogin`
 * otherwise. A host that is not specialty-aware lands on `afterLogin` alone.
 * The remembered specialty is read by the package from the endpoints the host
 * config NAMES — a mounted route file may not read anything.
 *
 * `choice: null` («could not resolve») lands the same way as a resolved
 * «nothing chosen»: the home page is the surface that lets a doctor choose.
 */
const CHOSEN = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "kardiologiya",
  name: "Кардиология",
  isOther: false,
} as const;

function remembered(
  choice: RememberedSpecialty["choice"],
  actor: RememberedSpecialty["actor"] = "guest",
): RememberedSpecialty {
  return { actor, choice };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("021 EARS-3 — the direct-arrival landing (LD-4)", () => {
  it("021 EARS-3: a remembered specialty lands the doctor on the 019 events feed", () => {
    expect(
      resolveDirectArrivalLanding(
        DOCTOR_FIXTURE,
        remembered({ specialty: CHOSEN, storedIn: "session" }),
      ),
    ).toBe("/events");
  });

  it("021 EARS-3: a doctor-stored remembered specialty lands on the same feed — the store is not the decision", () => {
    expect(
      resolveDirectArrivalLanding(
        DOCTOR_FIXTURE,
        remembered({ specialty: CHOSEN, storedIn: "profile" }, "doctor"),
      ),
    ).toBe("/events");
  });

  it("021 EARS-3: a resolved 'nothing chosen yet' lands on the storefront home", () => {
    expect(
      resolveDirectArrivalLanding(DOCTOR_FIXTURE, remembered(NO_SPECIALTY_CHOICE)),
    ).toBe("/");
  });

  it("021 EARS-3: an unresolved read (api unreachable) lands on the storefront home, not a feed filtered by a guess", () => {
    expect(resolveDirectArrivalLanding(DOCTOR_FIXTURE, remembered(null))).toBe("/");
    expect(
      resolveDirectArrivalLanding(DOCTOR_FIXTURE, remembered(null, "doctor")),
    ).toBe("/");
  });

  it("021 EARS-3: the account page is never a landing — the destinations are exactly the config's feed and afterLogin", () => {
    const destinations = [
      resolveDirectArrivalLanding(
        DOCTOR_FIXTURE,
        remembered({ specialty: CHOSEN, storedIn: "session" }),
      ),
      resolveDirectArrivalLanding(DOCTOR_FIXTURE, remembered(null)),
    ];
    expect(new Set(destinations)).toEqual(new Set(["/events", "/"]));
    expect(destinations).not.toContain("/account");
  });

  it("013 EARS-15: a host that is not specialty-aware lands on its afterLogin whatever is remembered", () => {
    expect(
      resolveDirectArrivalLanding(
        ACADEMY_FIXTURE,
        remembered({ specialty: CHOSEN, storedIn: "session" }),
      ),
    ).toBe("/webinars");
  });
});

describe("017 EARS-6 — the remembered specialty, read from the host-named endpoints", () => {
  it("EARS-6.25: a deferred server cascade shall not fall through to a lossy browser adoption after an API failure", async () => {
    const headers = new Headers({
      cookie: "__Host-ds_session=profile-a",
      "x-ds-specialty-consumption-deferred": "1",
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("down"));

    await expect(
      resolveRememberedSpecialty(DOCTOR_READS, headers, fetchImpl),
    ).resolves.toEqual({ actor: "doctor", choice: NO_SPECIALTY_CHOICE });
  });

  it("017 EARS-6: a signed-in visitor is read from the config's signedIn endpoint; a stale session falls through to its guest endpoint", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);
      seen.push(url);
      return Promise.resolve(
        url.endsWith("/v1/me/specialty")
          ? jsonResponse({}, 401)
          : jsonResponse({ specialty: CHOSEN, storedIn: "session" }),
      );
    });

    const result = await resolveRememberedSpecialty(
      DOCTOR_READS,
      new Headers({ cookie: "__Host-ds_session=stale" }),
      fetchImpl,
    );

    expect(result).toEqual({
      actor: "guest",
      choice: { specialty: CHOSEN, storedIn: "session" },
    });
    expect(seen.map((url) => new URL(url).pathname)).toEqual([
      "/v1/me/specialty",
      "/v1/public/specialty-choice",
    ]);
  });

  it("017 EARS-6: the endpoints are data — a renamed guest endpoint in config is the one read", async () => {
    const config = {
      landing: {
        ...DOCTOR_LANDING,
        specialtyEndpoints: {
          ...DOCTOR_LANDING.specialtyEndpoints,
          guest: "/v1/public/other-choice",
        },
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(NO_SPECIALTY_CHOICE));

    await resolveRememberedSpecialty(config, new Headers(), fetchImpl);

    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe(
      "/v1/public/other-choice",
    );
  });

  it("021 EARS-3: resolveArrivalLanding composes the read and the rule; a non-aware host reads nothing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ specialty: CHOSEN, storedIn: "session" }),
      );

    await expect(
      resolveArrivalLanding(DOCTOR_FIXTURE, new Headers(), fetchImpl),
    ).resolves.toBe("/events");
    fetchImpl.mockClear();
    await expect(
      resolveArrivalLanding(ACADEMY_FIXTURE, new Headers(), fetchImpl),
    ).resolves.toBe("/webinars");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
