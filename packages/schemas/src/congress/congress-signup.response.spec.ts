import { describe, expect, it } from "vitest";

import {
  CONGRESS_SIGN_UP_WINDOW_REFUSAL_CODES,
  CongressSignUpAcceptedSchema,
  CongressSignUpWindowRefusalSchema,
} from "./congress-signup.response.schema.js";

describe("044 congress sign-up — intake responses", () => {
  it("EARS-1: when a submission is accepted, system shall answer with one generic body that carries nothing about the submitter", () => {
    expect(CongressSignUpAcceptedSchema.parse({ status: "accepted" })).toEqual({
      status: "accepted",
    });

    // Path-independent: slice 3's existing-account branch must be able to
    // return the byte-identical body, so the shape admits no discriminator.
    expect(
      CongressSignUpAcceptedSchema.safeParse({
        status: "accepted",
        userId: "e7d4b1f0-5a2c-4a3e-9f6b-0c1d2e3f4a5b",
      }).success,
    ).toBe(false);
    expect(CongressSignUpAcceptedSchema.safeParse({ status: "created" }).success).toBe(
      false,
    );
  });

  it("EARS-28: when the submission arrives before the registration window opens, system shall refuse with a machine-readable code carrying the opening instant", () => {
    const refusal = CongressSignUpWindowRefusalSchema.parse({
      code: "not-yet-open",
      message: "Регистрация ещё не открыта.",
      opensAt: "2026-10-01T00:00:00.000+03:00",
    });

    expect(refusal.code).toBe("not-yet-open");
    expect(refusal).toHaveProperty("opensAt", "2026-10-01T00:00:00.000+03:00");

    // The opening instant is the whole point of the `not-yet-open` variant.
    expect(
      CongressSignUpWindowRefusalSchema.safeParse({
        code: "not-yet-open",
        message: "Регистрация ещё не открыта.",
      }).success,
    ).toBe(false);
  });

  it("EARS-28: when the submission arrives after the registration window closes, system shall refuse with the closed code and no opening instant", () => {
    const refusal = CongressSignUpWindowRefusalSchema.parse({
      code: "closed",
      message: "Регистрация закрыта.",
    });

    expect(refusal.code).toBe("closed");
    expect(refusal).not.toHaveProperty("opensAt");

    expect(
      CongressSignUpWindowRefusalSchema.safeParse({
        code: "closed",
        message: "Регистрация закрыта.",
        opensAt: "2026-10-01T00:00:00.000+03:00",
      }).success,
    ).toBe(false);
    expect(
      CongressSignUpWindowRefusalSchema.safeParse({
        code: "not-open-yet",
        message: "Регистрация закрыта.",
      }).success,
    ).toBe(false);
  });

  it("EARS-28: when the window refusal codes are enumerated, system shall expose exactly the two window states", () => {
    expect(CONGRESS_SIGN_UP_WINDOW_REFUSAL_CODES).toEqual([
      "not-yet-open",
      "closed",
    ]);
  });
});
