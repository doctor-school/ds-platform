import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  submitAcademyPartnership,
} from "./academy-partnership-action";
import { ACADEMY_PARTNERSHIP_WRITE_ERROR } from "@/lib/academy-partnership-schema";

const saveAcademyPartnershipSubmission = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-for": "198.51.100.10" }),
}));
vi.mock("@/lib/academy-partnership-store", () => ({
  saveAcademyPartnershipSubmission,
}));

const validSubmission = {
  idempotencyKey: "185808fb-4392-4452-b012-7d31647970e4",
  name: "  Анна Соколова  ",
  companyOrClinic: "  Клиника  ",
  contact: "  partner@example.ru  ",
  role: "Партнёр",
  consent: true,
};

beforeEach(() => {
  saveAcademyPartnershipSubmission.mockReset();
});

describe("Feature 013 Academy partnership Server Action", () => {
  it("EARS-5: server action shall reject invalid values with field errors and zero write", async () => {
    const result = await submitAcademyPartnership({
      ...validSubmission,
      contact: "@bad-name",
      consent: false,
    });

    expect(result).toMatchObject({
      status: "invalid",
      fieldErrors: {
        contact: expect.any(String),
        consent: expect.any(String),
      },
    });
    expect(saveAcademyPartnershipSubmission).not.toHaveBeenCalled();
  });

  it("EARS-6: server action shall pass only shared-schema-trimmed values to the private writer without raw logs", async () => {
    saveAcademyPartnershipSubmission.mockResolvedValue({
      id: validSubmission.idempotencyKey,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(submitAcademyPartnership(validSubmission)).resolves.toEqual({
      status: "success",
    });
    expect(saveAcademyPartnershipSubmission).toHaveBeenCalledWith({
      ...validSubmission,
      name: "Анна Соколова",
      companyOrClinic: "Клиника",
      contact: "partner@example.ru",
    });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
  });

  it("EARS-7: private write failure shall return only the exact generic failure without logging submitted values", async () => {
    saveAcademyPartnershipSubmission.mockRejectedValue(new Error("disk failed"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      submitAcademyPartnership({
        ...validSubmission,
        idempotencyKey: "fb261d36-dda5-4b78-a79c-e2b49f93ed58",
      }),
    ).resolves.toEqual({
      status: "error",
      message: ACADEMY_PARTNERSHIP_WRITE_ERROR,
    });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    log.mockRestore();
    error.mockRestore();
  });
});
