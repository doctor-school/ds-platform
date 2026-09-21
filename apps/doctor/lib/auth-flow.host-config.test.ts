import { describe, expect, it } from "vitest";

import { DOCTOR_AUTH_FLOW } from "./auth-flow.host-config";
import { doctorNav } from "./navigation-model";

/**
 * 017 US-7 / 003 EARS-28 — the doctor host config states its auth routes as
 * LITERALS, because it is DATA a server route file hands to `@ds/auth-flow` and
 * may not read back out of `lib/`. That inversion is only safe while the
 * literals still equal the SSOT they were copied from: `lib/navigation-model.ts`
 * owns where the one guest control and the account chip point. This suite is
 * what fails when the navigation moves and the auth flow does not.
 */
describe("DOCTOR_AUTH_FLOW.routes", () => {
  it("EARS-1: the login route equals the navigation model's one guest destination", () => {
    expect(DOCTOR_AUTH_FLOW.routes.login).toBe(doctorNav.login.href);
  });

  it("EARS-1: the account route equals the navigation model's account destination", () => {
    expect(DOCTOR_AUTH_FLOW.routes.account).toBe(doctorNav.account.href);
  });
});
