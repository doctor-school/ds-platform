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

function requestFor(url: string): NextRequest {
  return new NextRequest(new Request(url));
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
