import { defineConfig, devices } from "@playwright/test";

/**
 * Doctor-storefront LIVE-STAND shell tier (#2180) — the sibling of the portal's
 * `playwright.config.ts` `e2e` project.
 *
 * The shared storefront chrome (`@ds/storefront-shell`) is driven mostly by the
 * backend-free tier (`playwright.ci.config.ts` → `e2e/shell.spec.ts`). Two of
 * its behaviours cannot live there, because they need a real api behind the
 * app: the SIGNED-IN auth cluster (resolved server-side from the session
 * cookie) and the header search actually NARROWING the events feed. They live
 * in `e2e/shell-live.spec.ts` and run here.
 *
 * Like the portal's live tier, this config boots NO server: the dev-stand
 * topology is the operator's, and `E2E_DOCTOR_URL` says where it is. The spec
 * is inert-green on a bare CI runner and fails loudly on a half-exported env
 * (`e2e/support/live-stand-env.ts`), so it is safe to invoke anywhere but only
 * proves anything against a stand.
 *
 * Run against a provisioned dev-stand with, e.g.:
 *   E2E_DOCTOR_URL=http://localhost:3004 IDP_ISSUER=… MAILPIT_URL=… \
 *   E2E_DOCTOR_EMAIL=… E2E_DOCTOR_PASSWORD=… \
 *   pnpm --filter @ds/doctor test:e2e:shell
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|[/\\])shell-live\.spec\.ts$/,
  // One live account, one shared upstream feed: do not race them.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL ?? "http://localhost:3004",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
