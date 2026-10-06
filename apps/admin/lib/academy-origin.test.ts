import { describe, expect, it } from "vitest";
import {
  ACADEMY_PUBLIC_ORIGIN_ENV,
  academyPublicUrl,
  readAcademyOrigin,
} from "./academy-origin";

/**
 * #2619 — admin «Публичная ссылка» links (project / partner / expert) are built
 * from the configured Academy origin, never a hardcoded production URL: a stage
 * slot links to its own `academy-<slot>.…` host, the local stand to its local
 * portal, production to `https://academy.doctor.school`.
 */
describe("readAcademyOrigin", () => {
  it("reads the configured origin from ACADEMY_PUBLIC_ORIGIN", () => {
    expect(ACADEMY_PUBLIC_ORIGIN_ENV).toBe("ACADEMY_PUBLIC_ORIGIN");
    expect(
      readAcademyOrigin({
        ACADEMY_PUBLIC_ORIGIN: "https://academy-pr-2619.stage.doctor.school",
      }),
    ).toBe("https://academy-pr-2619.stage.doctor.school");
  });

  it("keeps a local origin with a port", () => {
    expect(
      readAcademyOrigin({ ACADEMY_PUBLIC_ORIGIN: "http://localhost:3001" }),
    ).toBe("http://localhost:3001");
  });

  it("normalises a trailing slash away", () => {
    expect(
      readAcademyOrigin({
        ACADEMY_PUBLIC_ORIGIN: "https://academy.doctor.school/",
      }),
    ).toBe("https://academy.doctor.school");
  });

  it("refuses when the key is missing or blank — no production fallback", () => {
    expect(() => readAcademyOrigin({})).toThrow(/ACADEMY_PUBLIC_ORIGIN/);
    expect(() => readAcademyOrigin({ ACADEMY_PUBLIC_ORIGIN: "  " })).toThrow(
      /ACADEMY_PUBLIC_ORIGIN/,
    );
  });

  it("refuses a value that is not a bare http(s) origin", () => {
    for (const value of [
      "academy.doctor.school",
      "ftp://academy.doctor.school",
      "https://academy.doctor.school/projects",
      "https://academy.doctor.school?x=1",
    ]) {
      expect(() => readAcademyOrigin({ ACADEMY_PUBLIC_ORIGIN: value })).toThrow(
        /ACADEMY_PUBLIC_ORIGIN/,
      );
    }
  });
});

describe("academyPublicUrl", () => {
  it("joins the configured origin with the public path of the record", () => {
    const origin = "https://academy-main.stage.doctor.school";
    expect(academyPublicUrl(origin, "projects", "cardio")).toBe(
      "https://academy-main.stage.doctor.school/projects/cardio",
    );
    expect(academyPublicUrl(origin, "partners", "acme")).toBe(
      "https://academy-main.stage.doctor.school/partners/acme",
    );
    expect(academyPublicUrl(origin, "experts", "ivanov")).toBe(
      "https://academy-main.stage.doctor.school/experts/ivanov",
    );
  });

  it("encodes the slug as one path segment", () => {
    expect(academyPublicUrl("http://localhost:3001", "projects", "a b/c")).toBe(
      "http://localhost:3001/projects/a%20b%2Fc",
    );
  });
});
