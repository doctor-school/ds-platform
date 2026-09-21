import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import type { AuthFlowReturnToConfig } from "../host-config";
import { parkReturnTarget } from "./return-target-parking";

/**
 * The ONE `returnTo` parking rule of the shared auth flow (wave-1 gate rows
 * 29-31, #2027 PR 1.4).
 *
 * 014 EARS-6 is the behaviour: the query carries the target through the flow,
 * but NOT through the verification mail, which lands the visitor on a cold
 * `/verify#email=...` with no query at all. So a guard-clean target is parked in
 * a short-lived same-origin cookie the moment the visitor enters the auth flow.
 *
 * Row 29 is why this is a rule and not a middleware: the doctor storefront parks
 * NOTHING - it carries the target on the canonical query param and has no cookie
 * at all. That host states no `returnTo` in its config and the same rule then
 * parks nothing, instead of the host owning a second, absent copy of the rule.
 */

const parking: AuthFlowReturnToConfig = {
  parkingCookie: { name: "ds_return_to", maxAgeSeconds: 900 },
};

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
      parking,
    );
    expect(response?.cookies.get("ds_return_to")?.value).toBe(
      "/webinars/ahilles-042",
    );
  });

  it("014 EARS-6.1: the cookie NAME is host data - a host that names it otherwise gets that name", () => {
    const response = parkReturnTarget(
      requestFor("https://academy.doctor.school/login?returnTo=%2Faccount"),
      { parkingCookie: { name: "ds_other_park", maxAgeSeconds: 60 } },
    );
    expect(response?.cookies.get("ds_other_park")?.value).toBe("/account");
    expect(response?.cookies.get("ds_return_to")).toBeUndefined();
    expect(setCookieOf(response as Response)).toMatch(/Max-Age=60/i);
  });

  it("014 EARS-6.2: the parked cookie is Lax, readable by the client consumer, and Secure only on https", () => {
    const secure = setCookieOf(
      parkReturnTarget(
        requestFor("https://academy.doctor.school/login?returnTo=%2Faccount"),
        parking,
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
        parking,
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
        parking,
      );
      expect(response, `must not park: ${evil}`).toBeUndefined();
    }
  });

  it("014 EARS-6.3: no carried target at all parks nothing", () => {
    expect(
      parkReturnTarget(
        requestFor("https://academy.doctor.school/login"),
        parking,
      ),
    ).toBeUndefined();
  });

  it("014 EARS-6.4: a host that parks nothing (row 29, the doctor storefront) parks nothing", () => {
    expect(
      parkReturnTarget(
        requestFor(
          "https://doctor.school/login?returnTo=%2Fevents%2Fahilles-042",
        ),
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("#2027 PR 1.5 returnTo without parking", () => {
  it("014 EARS-6.4: a host whose returnTo only publishes the card parks nothing", async () => {
    const { NextRequest } = await import("next/server");
    const request = new NextRequest(
      "https://doctor.test/login?returnTo=%2Fevents%2Fslug",
    );
    expect(parkReturnTarget(request, { card: true })).toBeUndefined();
  });
});
