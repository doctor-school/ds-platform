import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

/**
 * Academy LIVE-STAND `/account` auth-path tier (#3151).
 *
 * `e2e/account-auth-paths-live.spec.ts` binds the shared body
 * `@ds/e2e/account-auth-paths` — the same body the doctor storefront runs on
 * `apps/doctor/playwright.register-live.config.ts`: an expired session on
 * `/account` bounces to login carrying `returnTo=/account` and returns, and the
 * «Сменить пароль» hand-off carries `returnTo=%2Faccount` through the reset.
 *
 * Its own config because the default `playwright.config.ts` runs `bddgen`
 * first and boots its own server; like the doctor live tiers this one boots NO
 * server — the stand topology is the operator's and `E2E_PORTAL_URL` says where
 * it is. Unset, the spec is inert; half-set, it fails loudly by variable name
 * (`e2e/support/live-stand-env.ts`) — it never guesses a host.
 *
 *   E2E_PORTAL_URL=… IDP_ISSUER=… MAILPIT_URL=… \
 *   pnpm --filter @ds/portal test:e2e:account-live
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|[/\\])account-auth-paths-live\.spec\.ts$/,
  // Live accounts and one shared Mailpit inbox: do not race them.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL,
    httpCredentials: standHttpCredentials(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
