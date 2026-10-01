import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.schema.js";

/**
 * 046 «Letters» — `MAILER_DOCTOR_BASE_URL` is a REQUIRED boot key, exactly like
 * `DATABASE_URL`: the congress letters link to `{origin}/account/congress`, and
 * an api that silently fell back to some default origin would mail a link to
 * the wrong site. `loadEnv` is what every module factory boots through, so a
 * refusal here is a refusal to boot.
 */
describe("api env — boot-required keys", () => {
  const complete = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    MAILER_DOCTOR_BASE_URL: "https://new.doctor.school",
  };

  it("EARS-14: boots with the doctor storefront origin set", () => {
    expect(loadEnv(complete).MAILER_DOCTOR_BASE_URL).toBe(
      "https://new.doctor.school",
    );
  });

  it("EARS-14: refuses to boot without MAILER_DOCTOR_BASE_URL, as without DATABASE_URL", () => {
    const { MAILER_DOCTOR_BASE_URL: _origin, ...noOrigin } = complete;
    const { DATABASE_URL: _db, ...noDatabase } = complete;
    expect(() => loadEnv(noOrigin)).toThrow(/MAILER_DOCTOR_BASE_URL/);
    expect(() => loadEnv(noDatabase)).toThrow(/DATABASE_URL/);
  });

  it("EARS-14: refuses to boot with a MAILER_DOCTOR_BASE_URL that is not a URL", () => {
    expect(() =>
      loadEnv({ ...complete, MAILER_DOCTOR_BASE_URL: "new.doctor.school" }),
    ).toThrow(/MAILER_DOCTOR_BASE_URL/);
  });
});
