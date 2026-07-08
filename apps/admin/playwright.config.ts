import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

/**
 * 007 admin browser-E2E config (#595) — the required `user-facing` deliverable
 * (requirements Verification `all` row), translated from `007-scenarios.feature`
 * to the Refine admin surface via playwright-bdd. Like the portal e2e config
 * (#131), this is the dev-stand-gated tier: it drives a real browser against a
 * RUNNING admin app that proxies `/v1/*` to a running api + Postgres + Zitadel +
 * MinIO. It is a MANUAL gate — NOT part of CI and NOT in the default turbo `test`
 * pipeline; the session bootstrap `throw`s if the stand env (`IDP_*`) is absent,
 * so a stray invocation fails fast rather than pretending to pass.
 *
 * Run it against a provisioned dev-stand with, e.g.:
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:e2e
 * The admin app must be booted with `API_PROXY_TARGET` pointing at an api whose
 * bot-protection is off (dev-stand recipe) so the 003 register/login provisioning
 * is not captcha-gated.
 *
 * `timezoneId` is pinned to a NON-Moscow zone for EVERY scenario, so the МСК
 * rendering assertions (EARS-10) prove no operator-local drift globally, not just
 * in one tagged scenario.
 */
const testDir = defineBddConfig({
  features: "e2e/features/*.feature",
  // The custom `test` instance (base.extend for the AdminWorld) lives in the
  // fixtures file, so it must be in the steps set for bddgen to bind it.
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen",
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
    locale: "ru-RU",
    // A deliberately non-МСК timezone: the МСК labels must not drift here (EARS-10).
    timezoneId: "America/New_York",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
