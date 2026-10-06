import { defineConfig, devices } from "@playwright/test";

/**
 * Doctor-storefront LIVE-STAND tier for «Мои заявки на Конгресс» (046 V-15 and
 * the V-18 section/oral-form axe scan, #2433).
 *
 * `e2e/congress-submissions.spec.ts` and `e2e/a11y/congress-axe.e2e.spec.ts`
 * stand on a real api, the stand's branch database and Mailpit (the emailed-code
 * sign-in); no upstream double can decide an intake window, a registration or
 * the status machine. Like `playwright.register-live.config.ts` this config
 * boots NO server — the dev-stand topology is the operator's and
 * `E2E_DOCTOR_URL` says where it is. Both specs are inert-green on a bare CI
 * runner and fail loudly on a half-exported env (`e2e/support/live-stand-env.ts`);
 * the backend-free `playwright.ci.config.ts` ignores them.
 *
 * Run (production build of the doctor host bound to 127.0.0.1, api on :3000):
 *   E2E_DOCTOR_URL=http://127.0.0.1:3004 IDP_ISSUER=… MAILPIT_URL=… \
 *   DATABASE_URL=<branch database> pnpm --filter @ds/doctor test:e2e:congress
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    /(^|[/\\])congress-submissions\.spec\.ts$/,
    /a11y[/\\]congress-axe\.e2e\.spec\.ts$/,
    // 003 EARS-44 — the Congress hand-off: a real sign-up mints the reference.
    /(^|[/\\])login-handoff-live\.spec\.ts$/,
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL,
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
