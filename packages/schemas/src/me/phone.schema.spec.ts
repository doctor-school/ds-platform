import { describe, expect, it } from "vitest";
import {
  ConfirmPhoneRequestSchema,
  MyProfileSchema,
  RequestPhoneCodeRequestSchema,
  RequestPhoneCodeResponseSchema,
  normalisePhoneEntry,
} from "./me.schema.js";

// 003 EARS-47/48/50 (#2449) — the confirmed-phone contracts.
describe("003 confirmed phone contracts", () => {
  it("EARS-47: a typed phone normalises to E.164 by the sign-in mask rule (8 → +7, separators dropped)", () => {
    expect(normalisePhoneEntry("8 (999) 123-45-67")).toBe("+79991234567");
    expect(normalisePhoneEntry("+7 999 123-45-67")).toBe("+79991234567");
    expect(
      RequestPhoneCodeRequestSchema.safeParse({ phone: "+7 999 123-45-67" })
        .success,
    ).toBe(true);
  });

  it("EARS-47: a value that is not a phone is refused at the boundary", () => {
    for (const phone of ["", "   ", "abc", "12", "+0123456789"]) {
      expect(RequestPhoneCodeRequestSchema.safeParse({ phone }).success).toBe(
        false,
      );
    }
  });

  it("EARS-47: the request answers code_sent or already_confirmed", () => {
    expect(
      RequestPhoneCodeResponseSchema.parse({ status: "code_sent" }),
    ).toEqual({ status: "code_sent" });
    expect(
      RequestPhoneCodeResponseSchema.parse({ status: "already_confirmed" }),
    ).toEqual({ status: "already_confirmed" });
  });

  it("EARS-48: the confirmation carries the code as a string (the six-digit rule is applied by the server as the generic failure)", () => {
    expect(ConfirmPhoneRequestSchema.parse({ code: " 123456 " })).toEqual({
      code: " 123456 ",
    });
    expect(ConfirmPhoneRequestSchema.safeParse({}).success).toBe(false);
  });

  it("EARS-50: the profile carries suggestedPhone, always present, nullable", () => {
    const base = {
      email: "a@b.test",
      emailVerified: true,
      phone: null,
      phoneVerified: null,
      displayName: null,
    };
    expect(MyProfileSchema.safeParse(base).success).toBe(false);
    expect(
      MyProfileSchema.parse({ ...base, suggestedPhone: "8 (999) 123-45-67" })
        .suggestedPhone,
    ).toBe("8 (999) 123-45-67");
    expect(
      MyProfileSchema.parse({ ...base, suggestedPhone: null }).suggestedPhone,
    ).toBeNull();
  });
});
