import { describe, expect, it } from "vitest";

import {
  ACADEMY_PARTNERSHIP_ROLES,
  AcademyPartnershipSubmissionSchema,
} from "./academy-partnership-schema";

const validSubmission = {
  idempotencyKey: "46f5190b-93c4-47af-89de-17d5030e9cad",
  name: "  Анна Соколова  ",
  companyOrClinic: "  Клиника  ",
  contact: "  partner@example.ru  ",
  role: "Эксперт",
  consent: true,
};

describe("Feature 013 Academy partnership schema", () => {
  it("EARS-5: shared client/server schema shall trim values and accept only email or the approved Telegram handle", () => {
    expect(ACADEMY_PARTNERSHIP_ROLES).toEqual([
      "Эксперт",
      "Партнёр",
      "Участник подкаста",
      "Соавтор направления",
      "Компания",
    ]);

    expect(AcademyPartnershipSubmissionSchema.parse(validSubmission)).toMatchObject({
      name: "Анна Соколова",
      companyOrClinic: "Клиника",
      contact: "partner@example.ru",
      consent: true,
    });
    expect(
      AcademyPartnershipSubmissionSchema.parse({
        ...validSubmission,
        contact: "  @partner_name  ",
      }).contact,
    ).toBe("@partner_name");
    const { companyOrClinic: _omitted, ...withoutOptionalCompany } =
      validSubmission;
    expect(
      AcademyPartnershipSubmissionSchema.parse(withoutOptionalCompany)
        .companyOrClinic,
    ).toBe("");

    for (const contact of ["name@", "username", "@abcd", "@bad-name"]) {
      expect(
        AcademyPartnershipSubmissionSchema.safeParse({
          ...validSubmission,
          contact,
        }).success,
        contact,
      ).toBe(false);
    }
  });
});
