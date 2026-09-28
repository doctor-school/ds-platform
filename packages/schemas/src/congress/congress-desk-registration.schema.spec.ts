import { describe, expect, it } from "vitest";

import {
  CongressDeskRegistrationRequestSchema,
  CongressDeskRegistrationResponseSchema,
} from "./congress-desk-registration.schema.js";

/**
 * 044 EARS-35 — the schema half of V-26: the desk entry is the intake's answer
 * set plus the paper-consent attestation, without the online acceptance and
 * without a captcha token. The endpoint behaviour is V-26 in `apps/api`.
 */
const valid = {
  surname: "Иванов",
  firstName: "Пётр",
  contactPhone: "+7 (999) 123-45-67",
  email: "walkin@example.org",
  specialtyId: "3b9f2d54-7c1e-4a8b-bb0f-2c6d5e4a9f10",
  workplace: "ГКБ №1",
  city: "Москва",
  region: "Москва",
  paperConsent: true as const,
};

describe("044 EARS-35: the desk registration contract", () => {
  it("044 EARS-35.1: a complete desk entry with the paper-consent tick is accepted", () => {
    expect(CongressDeskRegistrationRequestSchema.parse(valid)).toMatchObject({
      email: "walkin@example.org",
      paperConsent: true,
    });
  });

  it("044 EARS-35.2: a desk entry without the paper-consent tick is refused", () => {
    const { paperConsent: _omit, ...withoutTick } = valid;
    void _omit;
    expect(
      CongressDeskRegistrationRequestSchema.safeParse(withoutTick).success,
    ).toBe(false);
    expect(
      CongressDeskRegistrationRequestSchema.safeParse({
        ...valid,
        paperConsent: false,
      }).success,
    ).toBe(false);
  });

  it("044 EARS-35.3: the online acceptance cannot stand in for the paper tick, and no captcha token is carried", () => {
    const { paperConsent: _omit, ...withoutTick } = valid;
    void _omit;
    expect(
      CongressDeskRegistrationRequestSchema.safeParse({
        ...withoutTick,
        personalDataConsent: true,
      }).success,
    ).toBe(false);
    const parsed = CongressDeskRegistrationRequestSchema.parse({
      ...valid,
      captchaToken: "t",
      personalDataConsent: true,
    });
    expect(parsed).not.toHaveProperty("captchaToken");
    expect(parsed).not.toHaveProperty("personalDataConsent");
  });

  it("044 EARS-35.4: the desk response names the registration and carries no account-path field", () => {
    const id = "0b8f6a3e-2d4c-4e5f-9a1b-3c7d8e9f0a12";
    expect(
      CongressDeskRegistrationResponseSchema.parse({
        status: "existing",
        registrationId: id,
      }),
    ).toEqual({ status: "existing", registrationId: id });
    expect(
      CongressDeskRegistrationResponseSchema.safeParse({
        status: "accepted",
        registrationId: id,
        accountCreatedByIntake: true,
      }).success,
    ).toBe(false);
  });
});
