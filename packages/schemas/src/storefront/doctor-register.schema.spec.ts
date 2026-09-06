import { describe, expect, it } from "vitest";

import {
  ConsentTierSchema,
  DOCTOR_REGISTER_CONSENT_REFUSAL_CODES,
  MARKETING_COMMUNICATIONS_PURPOSE,
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  PARTNER_DATA_COMPOSITION,
  PARTNER_DATA_EXCLUDED,
  PARTNER_DATA_SHARING_PURPOSE,
  PARTNER_DATA_SHARING_REQUIRED_CODE,
  REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES,
  formatPartnerDataStatement,
} from "./doctor-register.schema.js";

/**
 * 021 EARS-5 — the contract half of the two-tier consent block (F-021-1 «Б»).
 *
 * What is pinned here is the SSOT itself: that the partner-data consent is an
 * access condition and not a preference, and that its statement is produced
 * from the declared composition rather than transcribed as a copy blob (021
 * design §4). The command's refusal behaviour is proven in
 * `apps/api/test/storefront/doctor-register-consents.e2e-spec.ts`; the rendered
 * two tiers in `apps/doctor/e2e/register-consent-tiers.spec.ts`.
 */
describe("021 EARS-5: the two-tier consent contract", () => {
  it("021 EARS-5.1: partner-data-sharing is a required access condition beside the declaration", () => {
    expect(REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES).toEqual([
      MEDICAL_WORKER_DECLARATION_PURPOSE,
      PARTNER_DATA_SHARING_PURPOSE,
    ]);
    // The marketing opt-in withholds nothing: it is never a precondition.
    expect(
      (REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES as readonly string[]).includes(
        MARKETING_COMMUNICATIONS_PURPOSE,
      ),
    ).toBe(false);
  });

  it("021 EARS-5.2: each access condition raises its own field-actionable refusal code", () => {
    expect(
      DOCTOR_REGISTER_CONSENT_REFUSAL_CODES[
        MEDICAL_WORKER_DECLARATION_PURPOSE
      ],
    ).toBe(MEDICAL_WORKER_DECLARATION_REQUIRED_CODE);
    expect(
      DOCTOR_REGISTER_CONSENT_REFUSAL_CODES[PARTNER_DATA_SHARING_PURPOSE],
    ).toBe(PARTNER_DATA_SHARING_REQUIRED_CODE);
    // Two conditions, two codes — 021 EARS-12 needs the refusal to point at the
    // field where it occurred, which one shared code cannot do.
    expect(MEDICAL_WORKER_DECLARATION_REQUIRED_CODE).not.toBe(
      PARTNER_DATA_SHARING_REQUIRED_CODE,
    );
  });

  it("021 EARS-5.3: the statement names the exact composition and states that contacts are not shared", () => {
    const statement = formatPartnerDataStatement();

    for (const field of PARTNER_DATA_COMPOSITION) {
      expect(statement).toContain(field);
    }
    expect(statement).toBe(
      "Согласен на передачу партнёрам платформы данных: ФИО, специальность, город, место работы. Контакты не передаются.",
    );
    expect(PARTNER_DATA_EXCLUDED).toEqual(["контакты"]);
  });

  it("021 EARS-5.4: the statement is derived from the composition, not a copy blob", () => {
    // Design §4: changing the shared composition changes the statement. A
    // hardcoded sentence would fail this by construction.
    const statement = formatPartnerDataStatement(
      ["ФИО", "город"],
      ["контакты", "адрес"],
    );

    expect(statement).toBe(
      "Согласен на передачу партнёрам платформы данных: ФИО, город. Контакты, адрес не передаются.",
    );
    expect(statement).not.toContain("специальность");
  });

  it("021 EARS-5.5: exactly the two F-021-1 tiers are expressible", () => {
    expect(
      ConsentTierSchema.safeParse({
        tier: "access-conditions",
        items: [
          {
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            required: true,
            statement: formatPartnerDataStatement(),
            dataComposition: [...PARTNER_DATA_COMPOSITION],
            excluded: [...PARTNER_DATA_EXCLUDED],
          },
        ],
      }).success,
    ).toBe(true);

    // No third tier: F-021-1 «Б» is two tiers, and a flat list or a disclosure
    // widget would need a shape this schema refuses to name.
    expect(
      ConsentTierSchema.safeParse({ tier: "everything", items: [] }).success,
    ).toBe(false);
    // An empty tier is not a tier — an honest-empty surface renders nothing.
    expect(
      ConsentTierSchema.safeParse({ tier: "marketing", items: [] }).success,
    ).toBe(false);
  });
});
