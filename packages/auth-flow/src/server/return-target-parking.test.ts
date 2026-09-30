import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { parkReturnTarget } from "./return-target-parking";

/**
 * The ONE `returnTo` parking rule of the shared auth flow (wave-1 gate rows
 * 29-31, #2027 PR 1.4).
 *
 * 014 EARS-6 is the behaviour (its consumers: 014 EARS-6, 021 EARS-10). These
 * cases pin only the parking half: a guard-clean target is parked in a
 * short-lived same-origin cookie the moment the visitor enters the auth flow.
 *
 * Row 29 (#2443): the parking is package mechanics, the same on both
 * storefronts - one cookie name, one lifetime, host-only - and neither host
 * states whether or where it parks.
 */

function requestFor(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

function setCookieOf(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

describe("014 EARS-6 shared returnTo parking rule", () => {
  it("014 EARS-6.1: parks a guard-clean carried target under the host's configured cookie name", () => {
    const response = parkReturnTarget(
      requestFor(
        "https://academy.doctor.school/login?returnTo=%2Fwebinars%2Fahilles-042",
      ),
    );
    expect(response?.cookies.get("ds_return_to")?.value).toBe(
      "/webinars/ahilles-042",
    );
  });

  it("014 EARS-6.1 (#2443): the cookie is host-only - no Domain, so the two storefronts' origins never share a parked target", () => {
    const header = setCookieOf(
      parkReturnTarget(
        requestFor("https://academy.doctor.school/login?returnTo=%2Faccount"),
      ) as Response,
    );
    expect(header).toMatch(/^ds_return_to=/);
    expect(header).not.toMatch(/Domain=/i);
  });

  it("014 EARS-6.2: the parked cookie is Lax, readable by the client consumer, and Secure only on https", () => {
    const secure = setCookieOf(
      parkReturnTarget(
        requestFor("https://academy.doctor.school/login?returnTo=%2Faccount"),
      ) as Response,
    );
    expect(secure).toMatch(/SameSite=lax/i);
    expect(secure).toMatch(/Path=\//i);
    expect(secure).toMatch(/Max-Age=900/i);
    // NOT HttpOnly: the consumption point is the client-side success handler,
    // which must both read and clear it. It holds a page path, no credential.
    expect(secure).not.toMatch(/HttpOnly/i);
    expect(secure).toMatch(/Secure/i);

    const insecure = setCookieOf(
      parkReturnTarget(
        requestFor("http://localhost:3001/login?returnTo=%2Faccount"),
      ) as Response,
    );
    expect(insecure).not.toMatch(/Secure/i);
  });

  it("014 EARS-6.3: an unsafe target is dropped here - the cookie can never hold an open redirect", () => {
    for (const evil of [
      "https://example.invalid/",
      "//example.invalid/",
      "/\\example.invalid",
      "/../etc/passwd",
    ]) {
      const response = parkReturnTarget(
        requestFor(
          `https://academy.doctor.school/login?returnTo=${encodeURIComponent(evil)}`,
        ),
      );
      expect(response, `must not park: ${evil}`).toBeUndefined();
    }
  });

  it("014 EARS-6.3: no carried target at all parks nothing", () => {
    expect(
      parkReturnTarget(requestFor("https://academy.doctor.school/login")),
    ).toBeUndefined();
  });

  it("014 EARS-6.4 (#2443): the doctor storefront parks exactly as the Academy does", () => {
    const response = parkReturnTarget(
      requestFor(
        "https://doctor.school/login?returnTo=%2Fevents%2Fahilles-042",
      ),
    );
    expect(response?.cookies.get("ds_return_to")?.value).toBe(
      "/events/ahilles-042",
    );
    expect(setCookieOf(response as Response)).toMatch(/Max-Age=900/i);
  });
});

describe("014 EARS-6 (#2443): parking onto a response the host already minted", () => {
  it("014 EARS-6.5: the cookie is written onto the host's response, keeping what that response already carries", () => {
    const hostResponse = NextResponse.next();
    hostResponse.headers.append("set-cookie", "host_cookie=kept; Path=/");

    const response = parkReturnTarget(
      requestFor(
        "https://doctor.school/verify?returnTo=%2Fevents%2Fahilles-042",
      ),
      hostResponse,
    );

    expect(response).toBe(hostResponse);
    const headers = (response as Response).headers.getSetCookie();
    expect(headers).toContain("host_cookie=kept; Path=/");
    expect(
      headers.some((header) =>
        header.startsWith("ds_return_to=%2Fevents%2Fahilles-042;"),
      ),
    ).toBe(true);
  });
});

describe("014 EARS-6 (#2443): a signed-in visitor never parks - a consumed target is never re-parked", () => {
  // The request exactly as Next 16's middleware adapter delivers it to a host
  // proxy/middleware: FLIGHT_HEADERS (`rsc`, `next-router-prefetch`,
  // `next-router-segment-prefetch`, ...) are stripped and `_rsc` is removed
  // from the URL (next/dist/server/web/adapter.js), so a router prefetch of
  // `/register?returnTo=...` is indistinguishable from a navigation here.
  const delivered = (cookie?: string) =>
    requestFor(
      "https://doctor.school/register?returnTo=%2Fevents%2Fahilles-042",
      cookie ? { cookie } : {},
    );

  it("014 EARS-6.6: with a session cookie the rule parks nothing - the post-sign-in prefetch of the «Создать аккаунт» link cannot resurrect the target", () => {
    expect(
      parkReturnTarget(delivered("__Host-ds_session=abc; other=1")),
    ).toBeUndefined();
    expect(
      parkReturnTarget(delivered("other=1; __Host-ds_session=abc")),
    ).toBeUndefined();
  });

  it("014 EARS-6.6: a guest still parks, on either storefront", () => {
    expect(
      parkReturnTarget(delivered("other=1"))?.cookies.get("ds_return_to")
        ?.value,
    ).toBe("/events/ahilles-042");
    expect(
      parkReturnTarget(delivered())?.cookies.get("ds_return_to")?.value,
    ).toBe("/events/ahilles-042");
  });

  it("014 EARS-6.6: a cookie that only resembles the session name is not a session", () => {
    expect(
      parkReturnTarget(delivered("x__Host-ds_session=abc"))?.cookies.get(
        "ds_return_to",
      )?.value,
    ).toBe("/events/ahilles-042");
  });

  it("014 EARS-6.6: a signed-in visitor's host response is handed back untouched", () => {
    const hostResponse = NextResponse.next();
    hostResponse.headers.append("set-cookie", "host_cookie=kept; Path=/");
    expect(
      parkReturnTarget(delivered("__Host-ds_session=abc"), hostResponse),
    ).toBeUndefined();
    expect(hostResponse.headers.getSetCookie()).toEqual([
      "host_cookie=kept; Path=/",
    ]);
  });
});

describe("014 EARS-6 (#2495): a door opened without a carried target starts a new flow and discards the parked one", () => {
  const PARKED = "ds_return_to=%2Fevents%2Fahilles-042";

  function deletionOf(response: Response | undefined): string | undefined {
    return response?.headers
      .getSetCookie()
      .find((header) => header.startsWith("ds_return_to=;"));
  }

  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: a guest opening %s with no returnTo drops the parked target",
    (path) => {
      const response = parkReturnTarget(
        requestFor(`https://doctor.school${path}`, { cookie: `other=1; ${PARKED}` }),
      );
      const deletion = deletionOf(response);
      expect(deletion).toBeDefined();
      expect(deletion).toMatch(/Path=\//i);
      expect(deletion).toMatch(/Max-Age=0/i);
    },
  );

  it("014 EARS-6.10: a returnTo the guard refuses is no carried target - the parked one is dropped too", () => {
    const response = parkReturnTarget(
      requestFor(
        `https://academy.doctor.school/login?returnTo=${encodeURIComponent("https://evil.example/")}`,
        { cookie: "ds_return_to=%2Fwebinars%2Fahilles-042" },
      ),
    );
    expect(deletionOf(response)).toBeDefined();
  });

  it("014 EARS-6.10: nothing parked, nothing to drop - the host response stays the host's", () => {
    expect(
      parkReturnTarget(requestFor("https://doctor.school/login", { cookie: "other=1" })),
    ).toBeUndefined();
  });

  it("014 EARS-6.10: the drop is written onto the host's own response, keeping what it carries", () => {
    const hostResponse = NextResponse.next();
    hostResponse.headers.append("set-cookie", "host_cookie=kept; Path=/");
    const response = parkReturnTarget(
      requestFor("https://doctor.school/login", { cookie: PARKED }),
      hostResponse,
    );
    expect(response).toBe(hostResponse);
    expect(response?.headers.getSetCookie()).toContain("host_cookie=kept; Path=/");
    expect(deletionOf(response)).toBeDefined();
  });

  it("014 EARS-6.10: a door that carries a target re-parks it, so a hop inside the flow keeps the intent", () => {
    const response = parkReturnTarget(
      requestFor("https://doctor.school/reset?returnTo=%2Fevents%2Fahilles-042", {
        cookie: PARKED,
      }),
    );
    expect(deletionOf(response)).toBeUndefined();
    expect(response?.cookies.get("ds_return_to")?.value).toBe("/events/ahilles-042");
  });

  it("014 EARS-6.10: a signed-in visitor is left alone - the rule belongs to the guest round-trip", () => {
    expect(
      parkReturnTarget(
        requestFor("https://doctor.school/login", {
          cookie: `__Host-ds_session=abc; ${PARKED}`,
        }),
      ),
    ).toBeUndefined();
  });
});
