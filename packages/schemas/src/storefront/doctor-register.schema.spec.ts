import { describe, expect, it } from "vitest";

import {
  ConsentTierSchema,
  DOCTOR_REGISTER_CONSENT_PURPOSES,
  DOCTOR_REGISTER_CONSENT_REFUSAL_CODES,
  DoctorRegisterConsentAcceptanceSchema,
  DoctorRegisterRequestSchema,
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

/**
 * 021 EARS-7 (#1543) — the contract half of "one versioned record per granted
 * purpose".
 *
 * The row-level half (one row each, server-stamped version, `captured_at` at
 * write time) is proven against real Postgres in
 * `apps/api/test/storefront/doctor-register-consents.e2e-spec.ts`. What belongs
 * HERE is the boundary rule that makes those rows meaningful: the command
 * records only purposes this surface actually renders.
 */
describe("021 EARS-7: the closed consent-purpose list", () => {
  it("021 EARS-7.1: the declared purposes are exactly the three 021 renders", () => {
    expect(DOCTOR_REGISTER_CONSENT_PURPOSES).toEqual([
      MEDICAL_WORKER_DECLARATION_PURPOSE,
      PARTNER_DATA_SHARING_PURPOSE,
      MARKETING_COMMUNICATIONS_PURPOSE,
    ]);
  });

  it("021 EARS-7.2: each declared purpose parses as a command consent item", () => {
    for (const purpose of DOCTOR_REGISTER_CONSENT_PURPOSES) {
      expect(
        DoctorRegisterConsentAcceptanceSchema.safeParse({
          purpose,
          version: "2026-09",
        }).success,
      ).toBe(true);
    }
  });

  it("021 EARS-7.3: an undeclared purpose is refused at the I/O boundary", () => {
    // 003's engine schema takes any non-empty string — it serves every surface.
    // 021 renders three purposes, so a fourth one reaching `consent_records`
    // would be a consent record of wording no doctor ever saw.
    expect(
      DoctorRegisterConsentAcceptanceSchema.safeParse({
        purpose: "analytics-profiling",
        version: "2026-09",
      }).success,
    ).toBe(false);
    expect(
      DoctorRegisterRequestSchema.safeParse({
        email: "doctor@example.test",
        password: "Str0ng-passw0rd!",
        medicalWorkerDeclaration: true,
        consent: [
          { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
          { purpose: "analytics-profiling", version: "2026-09" },
        ],
      }).success,
    ).toBe(false);
  });

  it("021 EARS-7.4: a version is still mandatory on every declared purpose", () => {
    // ADR-0009: a bare boolean is not a consent record. Narrowing the purpose
    // must not have loosened the versioning rule inherited from 003.
    expect(
      DoctorRegisterConsentAcceptanceSchema.safeParse({
        purpose: MARKETING_COMMUNICATIONS_PURPOSE,
        version: "",
      }).success,
    ).toBe(false);
    expect(
      DoctorRegisterConsentAcceptanceSchema.safeParse({
        purpose: MARKETING_COMMUNICATIONS_PURPOSE,
      }).success,
    ).toBe(false);
  });

  it("021 EARS-6: the marketing opt-in is expressible and omissible alike", () => {
    const base = {
      email: "doctor@example.test",
      password: "Str0ng-passw0rd!",
      medicalWorkerDeclaration: true,
    };
    // Withheld: simply absent. There is no `granted: false` shape to store, so
    // "no row at all when withheld" holds at the contract layer already.
    const withheld = DoctorRegisterRequestSchema.safeParse({
      ...base,
      consent: [{ purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" }],
    });
    expect(withheld.success).toBe(true);
    expect(withheld.success && withheld.data.consent).toEqual([
      { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
    ]);

    const granted = DoctorRegisterRequestSchema.safeParse({
      ...base,
      consent: [
        { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
        { purpose: MARKETING_COMMUNICATIONS_PURPOSE, version: "2026-09" },
      ],
    });
    expect(granted.success).toBe(true);
  });
});
