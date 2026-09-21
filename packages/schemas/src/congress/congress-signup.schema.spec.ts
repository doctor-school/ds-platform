import { describe, expect, it } from "vitest";

import {
  CONGRESS_SIGN_UP_ANSWER_MAX,
  CongressSignUpAnswersSchema,
  CongressSignUpRequestSchema,
  toCongressSignUpAnswers,
} from "./congress-signup.schema.js";

/**
 * 044 EARS-3 / EARS-5 / EARS-29 — the intake contract and the stored answers
 * shape (044 requirements EARS-3, 044 design §«Data model»).
 *
 * This file is the schema-level half of V-5 and V-17. It pins what the contract
 * itself decides: which fields a submission must carry, that specialty is an
 * identifier and never free text, and that the stored shape keeps the phone
 * twice. The endpoint behaviour on top of it — the refusal status, the captcha,
 * the window, the row actually written — is V-1/V-5/V-17 in `apps/api`, landing
 * with the intake endpoint slice.
 */

/** The «Другое / не медицинский работник» row is an ordinary row: an id. */
const OTHER_SPECIALTY_ID = "5f0a1c6e-6a1d-4c3a-9f2b-0d1b4e8c7a11";

const valid = {
  surname: "Иванов",
  firstName: "Пётр",
  patronymic: "Сергеевич",
  contactPhone: "+7 (999) 123-45-67",
  email: "petr@example.org",
  specialtyId: "3b9f2d54-7c1e-4a8b-bb0f-2c6d5e4a9f10",
  workplace: "ГКБ №1",
  city: "Москва",
  region: "Москва",
  personalDataConsent: true as const,
};

describe("044 EARS-3: the congress sign-up intake contract", () => {
  it("044 EARS-3.1: a complete submission is accepted", () => {
    expect(CongressSignUpRequestSchema.parse(valid)).toMatchObject({
      surname: "Иванов",
      specialtyId: valid.specialtyId,
    });
  });

  it("044 EARS-3.2: patronymic is the only optional answer — every other field missing is a refusal", () => {
    const required = [
      "surname",
      "firstName",
      "contactPhone",
      "email",
      "specialtyId",
      "workplace",
      "city",
      "region",
      "personalDataConsent",
    ] as const;

    for (const field of required) {
      const { [field]: _dropped, ...rest } = valid;
      expect(
        CongressSignUpRequestSchema.safeParse(rest).success,
        `${field} must be required`,
      ).toBe(false);
    }

    const { patronymic: _omitted, ...withoutPatronymic } = valid;
    expect(
      CongressSignUpRequestSchema.safeParse(withoutPatronymic).success,
    ).toBe(true);
  });

  it("044 EARS-3.3: specialty is accepted only as a specialties_minzdrav identifier, never as free text", () => {
    // The reserved «other» option is that row's id — so the identifier is the
    // ONE representation, and free text is unrepresentable rather than merely
    // discouraged.
    expect(
      CongressSignUpRequestSchema.safeParse({
        ...valid,
        specialtyId: OTHER_SPECIALTY_ID,
      }).success,
    ).toBe(true);

    for (const freeText of ["Кардиолог", "другое", "", "  "]) {
      expect(
        CongressSignUpRequestSchema.safeParse({
          ...valid,
          specialtyId: freeText,
        }).success,
        `free-text specialty ${JSON.stringify(freeText)} must be refused`,
      ).toBe(false);
    }
  });

  it("044 EARS-3.4: there is no free-text specialty field to fall back to", () => {
    const parsed = CongressSignUpRequestSchema.parse({
      ...valid,
      specialtyOther: "Ветеринар",
    } as never);
    expect(parsed).not.toHaveProperty("specialtyOther");
  });

  it("044 EARS-3.5: the personal-data consent is a literal true precondition, not a boolean", () => {
    expect(
      CongressSignUpRequestSchema.safeParse({
        ...valid,
        personalDataConsent: false,
      }).success,
    ).toBe(false);
  });

  it("044 EARS-3.6: the consent version is server-stamped — the client cannot send one", () => {
    const parsed = CongressSignUpRequestSchema.parse({
      ...valid,
      consentVersion: "2026-10-01+deadbeef",
    } as never);
    expect(parsed).not.toHaveProperty("consentVersion");
  });

  it("044 EARS-3.7: answers are trimmed and a whitespace-only answer is refused", () => {
    expect(
      CongressSignUpRequestSchema.parse({ ...valid, city: "  Тверь  " }),
    ).toMatchObject({ city: "Тверь" });
    expect(
      CongressSignUpRequestSchema.safeParse({ ...valid, city: "   " }).success,
    ).toBe(false);
  });

  it("044 EARS-3.8: an answer beyond the declared maximum length is refused", () => {
    expect(
      CongressSignUpRequestSchema.safeParse({
        ...valid,
        workplace: "г".repeat(CONGRESS_SIGN_UP_ANSWER_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("044 EARS-3.9: a malformed email is refused", () => {
    expect(
      CongressSignUpRequestSchema.safeParse({ ...valid, email: "petr@" })
        .success,
    ).toBe(false);
  });

  it("044 EARS-3.10: the captcha token rides the body optionally, exactly as the guard reads it", () => {
    // `BotProtectionGuard` takes the header first and falls back to the body
    // field `captchaToken` (`apps/api/src/bot-protection/bot-protection.guard.ts`),
    // and no-ops entirely when the provider is disabled — so the contract
    // carries the field and does not require it, as `DoctorRegisterRequestSchema`
    // has it.
    expect(
      CongressSignUpRequestSchema.parse({ ...valid, captchaToken: "tok" }),
    ).toMatchObject({ captchaToken: "tok" });
    expect(CongressSignUpRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("044 EARS-3.11: a contact phone that cannot normalise to E.164 is refused", () => {
    for (const bad of ["не телефон", "+7 999 12", "12345"]) {
      expect(
        CongressSignUpRequestSchema.safeParse({ ...valid, contactPhone: bad })
          .success,
        `${bad} must be refused`,
      ).toBe(false);
    }
  });
});

describe("044 EARS-5: the stored answers shape", () => {
  it("044 EARS-5.1: the stored shape keeps the phone twice — as typed and normalised", () => {
    const answers = toCongressSignUpAnswers(
      CongressSignUpRequestSchema.parse(valid),
    );
    expect(answers.contactPhone).toBe("+7 (999) 123-45-67");
    expect(answers.contactPhoneNormalised).toBe("+79991234567");
  });

  it("044 EARS-5.2: differently typed equal phones give one normalised value with the typed form preserved verbatim", () => {
    const typed = ["+7 (999) 123-45-67", "8 999 1234567", "+79991234567"];
    const answers = typed.map((contactPhone) =>
      toCongressSignUpAnswers(
        CongressSignUpRequestSchema.parse({ ...valid, contactPhone }),
      ),
    );

    expect(new Set(answers.map((a) => a.contactPhoneNormalised)).size).toBe(1);
    expect(answers.map((a) => a.contactPhone)).toEqual(typed);
  });

  it("044 EARS-5.3: the consent flag and the captcha token are not stored", () => {
    const answers = toCongressSignUpAnswers(
      CongressSignUpRequestSchema.parse({ ...valid, captchaToken: "tok" }),
    );
    expect(answers).not.toHaveProperty("personalDataConsent");
    expect(answers).not.toHaveProperty("captchaToken");
    // The mapper is the only assembler, so the column can never hold a shape
    // the intake contract would reject.
    expect(CongressSignUpAnswersSchema.parse(answers)).toEqual(answers);
  });

  it("044 EARS-5.4: the stored shape is strict — an unknown key is refused", () => {
    const answers = toCongressSignUpAnswers(
      CongressSignUpRequestSchema.parse(valid),
    );
    expect(
      CongressSignUpAnswersSchema.safeParse({ ...answers, extra: 1 }).success,
    ).toBe(false);
  });

  it("044 EARS-5.5: patronymic stays optional in the stored shape", () => {
    const { patronymic: _omitted, ...withoutPatronymic } = valid;
    const answers = toCongressSignUpAnswers(
      CongressSignUpRequestSchema.parse(withoutPatronymic),
    );
    expect(answers.patronymic).toBeUndefined();
    expect(CongressSignUpAnswersSchema.safeParse(answers).success).toBe(true);
  });
});
