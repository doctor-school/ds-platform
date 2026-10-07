import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.schema.js";

/**
 * #2605 — `BOT_PROTECTION_TEST_TOKEN` substitutes the Yandex validation on
 * non-production stands only. The api refuses to boot with it set unless
 * `SENTRY_ENVIRONMENT` positively names a non-production environment; an unset
 * `SENTRY_ENVIRONMENT` defaults to `production` and is refused (fail-safe).
 */
describe("api env — bot-protection test token is non-production only", () => {
  const complete = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
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

  it("trims the test token exactly as the slot coherence check does (whitespace-only is unset)", () => {
    expect(
      loadEnv({ ...complete, BOT_PROTECTION_TEST_TOKEN: "   " })
        .BOT_PROTECTION_TEST_TOKEN,
    ).toBeUndefined();
    expect(
      loadEnv({
        ...complete,
        SENTRY_ENVIRONMENT: "stage",
        BOT_PROTECTION_TEST_TOKEN: ` ${token} `,
      }).BOT_PROTECTION_TEST_TOKEN,
    ).toBe(token);
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
