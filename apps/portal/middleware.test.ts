import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

/**
 * 014 EARS-6 — the Academy wiring of the shared `@ds/auth-flow` parking rule:
 * which doors run it. The rule itself is pinned in the package
 * (`return-target-parking.test.ts`); these cases pin that this host's doors
 * reach it, the same doors the doctor storefront's proxy wires.
 */
const PARKED = "ds_return_to=%2Fwebinars%2Fahilles-042";

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

describe("014 EARS-6 (#2495): the Academy binds the parked target to the flow that carried it", () => {
  it("014 EARS-6.10: the middleware runs on every auth door, the reset door included", () => {
    expect([...config.matcher].sort()).toEqual(
      ["/login", "/register", "/reset", "/verify"].sort(),
    );
  });

  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: %s with a guard-clean returnTo parks it",
    (path) => {
      const response = middleware(
        new NextRequest(
          `https://academy.doctor.school${path}?returnTo=%2Fwebinars%2Fahilles-042`,
        ),
      );
      expect(
        setCookies(response).some((h) =>
          h.startsWith("ds_return_to=%2Fwebinars%2Fahilles-042;"),
        ),
      ).toBe(true);
    },
  );

  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: a guest opening %s with no returnTo drops the parked target",
    (path) => {
      const response = middleware(
        new NextRequest(`https://academy.doctor.school${path}`, {
          headers: { cookie: PARKED },
        }),
      );
      expect(
        setCookies(response).some(
          (h) => h.startsWith("ds_return_to=;") && /Max-Age=0/i.test(h),
        ),
      ).toBe(true);
    },
  );

  it("014 EARS-6.10: a signed-in visitor's parked value is left alone", () => {
    const response = middleware(
      new NextRequest("https://academy.doctor.school/login", {
        headers: { cookie: `__Host-ds_session=abc; ${PARKED}` },
      }),
    );
    expect(setCookies(response)).toEqual([]);
  });
});
