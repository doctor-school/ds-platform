import { describe, expect, it } from "vitest";
import {
  AdminApplicationStatusMoveSchema,
  APPLICATION_KINDS,
  ApplicationErasedPayloadSchema,
  ApplicationOutcomeSchema,
  AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG,
  AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE,
  AuthorApplicationIntakeSchema,
  AuthorApplicationPayloadSchema,
  AuthorApplicationIntakeResultSchema,
} from "./applications.schema.js";

const body = {
  topic: "  Ведение пациентов с гонартрозом  ",
  format: "course_series",
  consentVersion: "2026-11-25.sha256-abc",
};

describe("033 EARS-6, EARS-7, EARS-20, EARS-23 — application queue contract", () => {
  it("EARS-6: the author intake carries the consent version tag of purpose author-application-personal-data", () => {
    expect(AUTHOR_APPLICATION_PERSONAL_DATA_PURPOSE).toBe(
      "author-application-personal-data",
    );
    expect(AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG).toBe(
      "consent-author-application",
    );
    expect(AuthorApplicationIntakeSchema.safeParse(body).success).toBe(true);
    const { consentVersion: _omit, ...withoutConsent } = body;
    const refused = AuthorApplicationIntakeSchema.safeParse(withoutConsent);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(["consentVersion"]);
  });

  it("EARS-7: the author payload is topic, one specialty form or none, format and about, trimmed and bounded", () => {
    const parsed = AuthorApplicationIntakeSchema.parse({
      ...body,
      specialtyCode: "kardiologiya",
      about: "  Практикующий кардиолог  ",
    });
    expect(parsed.topic).toBe("Ведение пациентов с гонартрозом");
    expect(parsed.about).toBe("Практикующий кардиолог");
    expect(APPLICATION_KINDS).toEqual(["author"]);
    for (const format of ["course_series", "single_lesson", "podcast", "talk"])
      expect(
        AuthorApplicationIntakeSchema.safeParse({ ...body, format }).success,
      ).toBe(true);
    const bad = [
      { ...body, topic: "   " },
      { ...body, topic: "т".repeat(201) },
      { ...body, format: "webinar" },
      { ...body, about: "о".repeat(2001) },
      { ...body, specialtyOther: "  " },
      { ...body, specialtyOther: "д".repeat(121) },
      { ...body, specialtyCode: "kardiologiya", specialtyOther: "Нейро" },
      { ...body, extra: 1 },
    ];
    for (const b of bad)
      expect(AuthorApplicationIntakeSchema.safeParse(b).success, b.topic).toBe(
        false,
      );
    expect(
      AuthorApplicationIntakeResultSchema.safeParse({
        id: "6f1c4c1e-8f7e-4b4a-9a43-2b9b1a7c0d11",
        submittedAt: "2026-11-25T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("EARS-20: the erasure tombstone is the only other form a payload takes", () => {
    expect(ApplicationErasedPayloadSchema.parse({ erased: true })).toEqual({
      erased: true,
    });
    expect(
      ApplicationErasedPayloadSchema.safeParse({ erased: true, topic: "x" })
        .success,
    ).toBe(false);
    expect(
      AuthorApplicationPayloadSchema.safeParse({ erased: true }).success,
    ).toBe(false);
  });

  it("EARS-23: expired is an outcome of the queue but never one an administrator can choose", () => {
    expect(ApplicationOutcomeSchema.options).toContain("expired");
    expect(
      AdminApplicationStatusMoveSchema.safeParse({
        status: "closed",
        outcome: "expired",
      }).success,
    ).toBe(false);
    expect(
      AdminApplicationStatusMoveSchema.safeParse({
        status: "closed",
        outcome: "declined",
      }).success,
    ).toBe(true);
    expect(
      AdminApplicationStatusMoveSchema.safeParse({ status: "in_review" })
        .success,
    ).toBe(true);
  });
});
