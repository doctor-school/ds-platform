import { AuthorApplicationIntakeSchema } from "@ds/schemas";

import { applicationsCopy } from "../copy";
import {
  type AuthorFormValues,
  emptyAuthorForm,
  fieldErrorsFromRefusal,
  SPECIALTY_OTHER,
  validateAuthorForm,
} from "./form";

const CONSENT = "2026-11-01.sha256-" + "a".repeat(64);

const filled = (over: Partial<AuthorFormValues> = {}): AuthorFormValues => ({
  ...emptyAuthorForm(),
  topic: "Ортобиология в амбулаторной практике",
  format: "course_series",
  consent: true,
  ...over,
});

describe("033 author form", () => {
  it("EARS-4: the empty form has no value chosen and the consent unticked", () => {
    expect(emptyAuthorForm()).toEqual({
      topic: "",
      specialty: "",
      specialtyOther: "",
      format: "",
      about: "",
      consent: false,
    });
    expect(applicationsCopy.form.formats).toEqual({
      course_series: "курс-сериал",
      single_lesson: "отдельный урок",
      podcast: "подкаст",
      talk: "выступление",
    });
  });

  it("EARS-4: a valid form becomes the intake body the api accepts — trimmed, optional fields left out, «Другое» as its text", () => {
    const minimal = validateAuthorForm(filled({ topic: "  Тема  " }), CONSENT);
    expect(minimal).toEqual({
      ok: true,
      body: {
        topic: "Тема",
        format: "course_series",
        consentVersion: CONSENT,
      },
    });

    const full = validateAuthorForm(
      filled({
        specialty: SPECIALTY_OTHER,
        specialtyOther: " Спортивная медицина ",
        about: " Практикующий ортопед ",
      }),
      CONSENT,
    );
    expect(full.ok && full.body).toEqual({
      topic: "Ортобиология в амбулаторной практике",
      specialtyOther: "Спортивная медицина",
      format: "course_series",
      about: "Практикующий ортопед",
      consentVersion: CONSENT,
    });
    const coded = validateAuthorForm(
      filled({ specialty: "31.08.66" }),
      CONSENT,
    );
    expect(coded.ok && coded.body.specialtyCode).toBe("31.08.66");

    for (const r of [minimal, full, coded])
      expect(
        r.ok && AuthorApplicationIntakeSchema.safeParse(r.body).success,
      ).toBe(true);
  });

  it("EARS-5: an empty required field, an out-of-bounds value or an unticked consent sends nothing and names each field with what to fix, the first one first", () => {
    const r = validateAuthorForm(
      {
        topic: "   ",
        specialty: SPECIALTY_OTHER,
        specialtyOther: "",
        format: "",
        about: "x".repeat(2001),
        consent: false,
      },
      CONSENT,
    );
    expect(r).toEqual({
      ok: false,
      firstInvalid: "topic",
      errors: {
        topic: applicationsCopy.errors.topicRequired,
        specialtyOther: applicationsCopy.errors.specialtyOtherRequired,
        format: applicationsCopy.errors.formatRequired,
        about: applicationsCopy.errors.aboutTooLong,
        consent: "Отметьте согласие — без него заявку не отправить.",
      },
    });

    const long = validateAuthorForm(
      filled({
        topic: "x".repeat(201),
        specialty: SPECIALTY_OTHER,
        specialtyOther: "x".repeat(121),
      }),
      CONSENT,
    );
    expect(long).toEqual({
      ok: false,
      firstInvalid: "topic",
      errors: {
        topic: applicationsCopy.errors.topicTooLong,
        specialtyOther: applicationsCopy.errors.specialtyOtherTooLong,
      },
    });

    const onlyConsent = validateAuthorForm(filled({ consent: false }), CONSENT);
    expect(onlyConsent).toEqual({
      ok: false,
      firstInvalid: "consent",
      errors: { consent: applicationsCopy.errors.consentRequired },
    });
  });

  it("EARS-5: the bounds count the trimmed value — 200 / 120 / 2000 characters pass", () => {
    const r = validateAuthorForm(
      filled({
        topic: ` ${"т".repeat(200)} `,
        specialty: SPECIALTY_OTHER,
        specialtyOther: "с".repeat(120),
        about: "о".repeat(2000),
      }),
      CONSENT,
    );
    expect(r.ok).toBe(true);
  });

  it("EARS-5: a 400 refusal with field errors maps onto the same fields with the same rule — the consent and the specialty", () => {
    expect(
      fieldErrorsFromRefusal([
        { code: "SPECIALTY_UNKNOWN", field: "specialtyCode" },
        { code: "CONSENT_VERSION_NOT_CURRENT", field: "consent" },
      ]),
    ).toEqual({
      ok: false,
      firstInvalid: "specialty",
      errors: {
        specialty: applicationsCopy.errors.specialtyUnknown,
        consent: applicationsCopy.errors.consentStale,
      },
    });
    expect(
      fieldErrorsFromRefusal([{ code: "IDEMPOTENCY_KEY_REUSED" }]),
    ).toBeNull();
  });
});
