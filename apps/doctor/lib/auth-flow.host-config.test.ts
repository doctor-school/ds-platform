import { describe, expect, it } from "vitest";

import { PARTNER_DATA_SHARING_PURPOSE, formatPartnerDataStatement } from "@ds/schemas";

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

/**
 * #2027 wave 1, PR 1.6 — what the SIGN-UP door of `@ds/auth-flow/register`
 * reads off this host.
 *
 * The door is one composition mounted by both storefronts, so everything that
 * used to be a doctor-local constant on the route is now a STATEMENT here. The
 * door's own branches are pinned in the package against `DOCTOR_FIXTURE`; this
 * suite pins the other half — that the SHIPPED config still states what the
 * doctor storefront's sign-up surface was accepted with, so a silent drop
 * (a tier, the inline confirmation copy, the submit-first form) fails here
 * rather than on the stand.
 */
describe("DOCTOR_AUTH_FLOW: the sign-up door's host statement", () => {
  it("EARS-1: confirmation has no route of its own — this host confirms INLINE", () => {
    expect(DOCTOR_AUTH_FLOW.routes).not.toHaveProperty("verify");
    expect(DOCTOR_AUTH_FLOW.copy.register?.confirm?.title).toBe(
      "Проверьте почту",
    );
  });

  it("021 EARS-5: the partner-data statement comes from the @ds/schemas SSOT, never a literal", () => {
    const access = DOCTOR_AUTH_FLOW.consents?.tiers.find(
      (tier) => tier.tier === "access-conditions",
    );

    expect(access?.items[0]?.purpose).toBe(PARTNER_DATA_SHARING_PURPOSE);
    expect(access?.items[0]?.statement).toBe(formatPartnerDataStatement());
    expect(access?.items[0]?.required).toBe(true);
  });

  it("021 EARS-5: the marketing opt-in is stated as the second, OPTIONAL tier", () => {
    const tiers = DOCTOR_AUTH_FLOW.consents?.tiers ?? [];

    expect(tiers.map((tier) => tier.tier)).toEqual([
      "access-conditions",
      "marketing",
    ]);
    expect(tiers[1]?.items[0]?.required).toBe(false);
  });

  it("021 EARS-12: the accepted form composition — submit first, wider spacing, inert while pending", () => {
    expect(DOCTOR_AUTH_FLOW.register.form).toEqual({
      submitBlock: "submit-first",
      spacing: "md",
      pendingAffordance: "inert",
    });
  });

  it("#2331: the door names its way back to the sign-in door", () => {
    expect(DOCTOR_AUTH_FLOW.copy.register?.haveAccount).toBe(
      "Уже есть аккаунт? Войти",
    );
  });
});
