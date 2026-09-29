import { describe, expect, it } from "vitest";
import {
  CongressParticipantCardParamsSchema,
  CongressParticipantCardSchema,
} from "./congress-participant-card.schema.js";

/**
 * 044 EARS-36 — the participant card contract, asserted where it is declared:
 * every stored field, the origin, consent, mail outcome, duplicate marker and
 * per-day attendance history — and, structurally, NO field that says whether
 * the account pre-existed this registration.
 */

const CARD = {
  registrationId: "11111111-1111-4111-8111-111111111111",
  surname: "Иванова",
  firstName: "Мария",
  patronymic: "Петровна",
  fullName: "Иванова Мария Петровна",
  specialtyName: "Кардиология",
  workplace: "ГКБ №1",
  city: "Москва",
  region: "Москва",
  phone: "+7 (900) 111-22-33",
  email: "maria@example.test",
  registeredAt: "2027-03-01T10:00:00.000Z",
  intakeOrigin: "desk",
  consents: [
    {
      purpose: "congress-personal-data",
      version: "2027-01",
      capturedAt: "2027-03-01T10:00:00.000Z",
      origin: "paper",
    },
  ],
  confirmationMail: { status: "sent", at: "2027-03-01T10:00:01.000Z" },
  possibleDuplicate: false,
  attendance: [
    {
      day: "2027-04-23",
      present: false,
      history: [
        {
          present: true,
          at: "2027-04-23T08:00:00.000Z",
          actor: "Регистратор Анна",
          source: "admin-ui",
        },
        {
          present: false,
          at: "2027-04-23T08:05:00.000Z",
          actor: "Регистратор Анна",
          source: "admin-ui",
        },
      ],
    },
    { day: "2027-04-24", present: null, history: [] },
  ],
};

describe("CongressParticipantCardSchema", () => {
  it("044 EARS-36: accepts a card carrying every stored field, origin, consent, mail, duplicate and attendance history", () => {
    expect(CongressParticipantCardSchema.parse(CARD)).toEqual(CARD);
  });

  it("044 EARS-36: accepts an answer-less platform-origin card with empty fields and no mail attempt", () => {
    const card = {
      ...CARD,
      surname: null,
      firstName: null,
      patronymic: null,
      fullName: "",
      specialtyName: null,
      workplace: null,
      city: null,
      region: null,
      phone: null,
      email: null,
      intakeOrigin: "platform",
      consents: [],
      confirmationMail: { status: null, at: null },
    };
    expect(CongressParticipantCardSchema.safeParse(card).success).toBe(true);
  });

  it("044 EARS-36: refuses an origin outside site|desk|platform", () => {
    expect(
      CongressParticipantCardSchema.safeParse({ ...CARD, intakeOrigin: "import" })
        .success,
    ).toBe(false);
  });

  it("044 EARS-36: refuses a card carrying account pre-existence (strict object)", () => {
    expect(
      CongressParticipantCardSchema.safeParse({
        ...CARD,
        accountCreatedByIntake: true,
      }).success,
    ).toBe(false);
    expect(
      CongressParticipantCardSchema.safeParse({
        ...CARD,
        account_created_by_intake: false,
      }).success,
    ).toBe(false);
    expect(Object.keys(CongressParticipantCardSchema.shape)).not.toContain(
      "accountCreatedByIntake",
    );
  });

  it("044 EARS-36: the card path parameter is a uuid", () => {
    expect(
      CongressParticipantCardParamsSchema.safeParse({ registrationId: "x" })
        .success,
    ).toBe(false);
    expect(
      CongressParticipantCardParamsSchema.safeParse({
        registrationId: CARD.registrationId,
      }).success,
    ).toBe(true);
  });
});
