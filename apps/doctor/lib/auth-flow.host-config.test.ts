import { describe, expect, it } from "vitest";

import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";

import {
  DEFAULT_AUTH_FLOW_COPY,
  consentStatementOf,
  resolveAuthFlowCopy,
} from "@ds/auth-flow/copy";

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
    expect(DOCTOR_AUTH_FLOW.verify.deepLinkEntry).toBe(false);
    expect(resolveAuthFlowCopy(DOCTOR_AUTH_FLOW).verify.title).toBe(
      "Проверьте почту",
    );
  });

  it("#2027: the brand panel keeps the package's doctor copy (owner 2026-09-24)", () => {
    expect(resolveAuthFlowCopy(DOCTOR_AUTH_FLOW).brand).toEqual({
      eyebrow: "Врачи учат врачей",
      headline: "Медицинское образование для врачей",
      subcopy:
        "Учебные программы и сертификация от ведущих экспертов отрасли — в едином пространстве Doctor.School.",
      footer:
        "© Doctor.School. Платформа непрерывного медицинского образования.",
    });
  });

  it("#2027: the host restates no auth wording — every sentence is the package's", () => {
    expect(DOCTOR_AUTH_FLOW.copy).toBeUndefined();
    expect(resolveAuthFlowCopy(DOCTOR_AUTH_FLOW)).toBe(DEFAULT_AUTH_FLOW_COPY);
  });

  it("021 EARS-7: every recorded statement is the sentence the door renders for that row", () => {
    const copy = resolveAuthFlowCopy(DOCTOR_AUTH_FLOW).consents;
    const tiers = DOCTOR_AUTH_FLOW.consents?.tiers ?? [];
    const access = tiers.find((tier) => tier.tier === "access-conditions");
    const marketing = tiers.find((tier) => tier.tier === "marketing");

    expect(access?.items[0]?.purpose).toBe(PARTNER_DATA_SHARING_PURPOSE);
    expect(access?.items[0]?.required).toBe(true);
    expect(access?.items[0]?.statement).toBe(
      consentStatementOf(copy.partnerDataItem),
    );

    expect(marketing?.items[0]?.purpose).toBe(MARKETING_COMMUNICATIONS_PURPOSE);
    expect(marketing?.items[0]?.statement).toBe(
      consentStatementOf(copy.marketingOptIn),
    );
  });

  it("021 EARS-5: the partner-data item states the exchange and enumerates no data composition", () => {
    const access = DOCTOR_AUTH_FLOW.consents?.tiers.find(
      (tier) => tier.tier === "access-conditions",
    );

    // Owner decision 2026-09-22: the composition of the shared data is
    // disclosed in the policy text and by the platform manager, not inside the
    // consent row the doctor ticks.
    expect(access?.items[0]?.statement).toContain(
      "Согласие на передачу данных партнёрам платформы",
    );
    for (const field of ["ФИО", "специальность", "город", "место работы"]) {
      expect(access?.items[0]?.statement).not.toContain(field);
    }
  });

  it("021 EARS-7: the host names the version of the wording it renders today", () => {
    // The partner-data and marketing rows were re-worded to the canvas on this
    // head (#2027), so a record written now may not claim the old version.
    expect(DOCTOR_AUTH_FLOW.consents?.wordingVersion).toBe("2026-09-22");
  });

  it("021 EARS-5: the marketing opt-in is stated as the second, OPTIONAL tier", () => {
    const tiers = DOCTOR_AUTH_FLOW.consents?.tiers ?? [];

    expect(tiers.map((tier) => tier.tier)).toEqual([
      "access-conditions",
      "marketing",
    ]);
    expect(tiers[1]?.items[0]?.required).toBe(false);
  });

  it("#2331: the door names its way back to the sign-in door", () => {
    expect(resolveAuthFlowCopy(DOCTOR_AUTH_FLOW).register.haveAccount).toBe(
      "Уже есть аккаунт? Войти",
    );
  });
});
