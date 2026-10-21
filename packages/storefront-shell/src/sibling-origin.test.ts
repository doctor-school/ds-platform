import { describe, expect, it } from "vitest";

import { SIBLING_ORIGIN_ENV, readSiblingOrigin } from "./sibling-origin";

describe("017 EARS-12 / LD-4: the sibling storefront origin is per-environment configuration", () => {
  it("names one variable per host: the doctor storefront reads the Academy origin, the Academy reads the doctor one", () => {
    expect(SIBLING_ORIGIN_ENV).toEqual({
      doctor: "ACADEMY_PUBLIC_ORIGIN",
      academy: "DOCTOR_PUBLIC_ORIGIN",
    });
  });

  it("resolves each host's sibling from its own variable, normalising a trailing slash", () => {
    const env = {
      ACADEMY_PUBLIC_ORIGIN: "https://academy-pr-7.stage.doctor.school/",
      DOCTOR_PUBLIC_ORIGIN: "  https://doctor-pr-7.stage.doctor.school  ",
    };
    expect(readSiblingOrigin(env, "doctor")).toBe(
      "https://academy-pr-7.stage.doctor.school",
    );
    expect(readSiblingOrigin(env, "academy")).toBe(
      "https://doctor-pr-7.stage.doctor.school",
    );
  });

  it("keeps a local http origin with its port", () => {
    expect(
      readSiblingOrigin(
        { DOCTOR_PUBLIC_ORIGIN: "http://localhost:3004" },
        "academy",
      ),
    ).toBe("http://localhost:3004");
  });

  it("refuses by name when the variable is unset or blank — no production fallback", () => {
    expect(() => readSiblingOrigin({}, "doctor")).toThrow(
      /ACADEMY_PUBLIC_ORIGIN/,
    );
    expect(() =>
      readSiblingOrigin({ DOCTOR_PUBLIC_ORIGIN: "   " }, "academy"),
    ).toThrow(/DOCTOR_PUBLIC_ORIGIN is not set/);
  });

  it("refuses a value that is not a bare http(s) origin", () => {
    for (const raw of [
      "academy.doctor.school",
      "ftp://academy.doctor.school",
      "https://academy.doctor.school/events",
      "https://academy.doctor.school/?x=1",
      "https://academy.doctor.school/#top",
      "https://user:pass@academy.doctor.school",
    ]) {
      expect(() =>
        readSiblingOrigin({ ACADEMY_PUBLIC_ORIGIN: raw }, "doctor"),
      ).toThrow(/ACADEMY_PUBLIC_ORIGIN/);
    }
  });
});
