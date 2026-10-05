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

/**
 * #2605 — `BOT_PROTECTION_TEST_TOKEN` substitutes the Yandex validation on
 * non-production stands only. The api refuses to boot with it set unless
 * `SENTRY_ENVIRONMENT` positively names a non-production environment; an unset
 * `SENTRY_ENVIRONMENT` defaults to `production` and is refused (fail-safe).
 */
describe("api env — bot-protection test token is non-production only", () => {
  const complete = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    MAILER_DOCTOR_BASE_URL: "https://new.doctor.school",
  };
  const token = "a".repeat(64);

  it("boots with the test token on the stage environment", () => {
    const env = loadEnv({
      ...complete,
      SENTRY_ENVIRONMENT: "stage",
      BOT_PROTECTION_TEST_TOKEN: token,
    });
    expect(env.BOT_PROTECTION_TEST_TOKEN).toBe(token);
  });

  it("boots without a test token in production (the token is optional)", () => {
    expect(loadEnv(complete).BOT_PROTECTION_TEST_TOKEN).toBeUndefined();
  });

  it("treats an empty test token (the template line left blank) as unset, also in production", () => {
    expect(
      loadEnv({ ...complete, BOT_PROTECTION_TEST_TOKEN: "" })
        .BOT_PROTECTION_TEST_TOKEN,
    ).toBeUndefined();
  });

  it("refuses to boot with the test token in production", () => {
    expect(() =>
      loadEnv({
        ...complete,
        SENTRY_ENVIRONMENT: "production",
        BOT_PROTECTION_TEST_TOKEN: token,
      }),
    ).toThrow(/BOT_PROTECTION_TEST_TOKEN/);
  });

  it("refuses to boot with the test token when SENTRY_ENVIRONMENT is unset (defaults to production)", () => {
    expect(() =>
      loadEnv({ ...complete, BOT_PROTECTION_TEST_TOKEN: token }),
    ).toThrow(/BOT_PROTECTION_TEST_TOKEN/);
  });

  it("refuses to boot with the test token in an environment not on the non-production allowlist", () => {
    expect(() =>
      loadEnv({
        ...complete,
        SENTRY_ENVIRONMENT: "prod",
        BOT_PROTECTION_TEST_TOKEN: token,
      }),
    ).toThrow(/BOT_PROTECTION_TEST_TOKEN/);
  });

  it("refuses to boot with a test token shorter than 32 characters", () => {
    expect(() =>
      loadEnv({
        ...complete,
        SENTRY_ENVIRONMENT: "stage",
        BOT_PROTECTION_TEST_TOKEN: "short",
      }),
    ).toThrow(/BOT_PROTECTION_TEST_TOKEN/);
  });
});
