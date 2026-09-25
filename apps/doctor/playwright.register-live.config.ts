import { defineConfig, devices } from "@playwright/test";

/**
 * Doctor-storefront LIVE-STAND registration tier (#2027 wave 1, rows 73 + 77).
 *
 * `e2e/register-existing.spec.ts` proves that a duplicate registration is
 * existence-agnostic end to end: the account-exists notice is an email the real
 * api sends through Mailpit, so no upstream double can stand in for it.
 *
 * Like `playwright.shell.config.ts` this config boots NO server: the dev-stand
 * topology is the operator's, and `E2E_DOCTOR_URL` says where it is. The spec is
 * inert-green on a bare CI runner and fails loudly on a half-exported env
 * (`e2e/support/live-stand-env.ts`).
 *
 * Run against a provisioned stand, the endpoints taken from
 * `~/.ds-platform/.env.local` (dev-stand) or the slot (`tools/staging/README.md`):
 *   E2E_DOCTOR_URL=… IDP_ISSUER=… MAILPIT_URL=… \
 *   pnpm --filter @ds/doctor test:e2e:register-live
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|[/\\])register-existing\.spec\.ts$/,
  // One registrant's mailbox and one per-IP rate budget: do not race them.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // No literal fallback: the endpoint comes from the stand env
    // (`~/.ds-platform/.env.local`). Unset, the spec is inert; half-set, it fails
    // loudly (`e2e/support/live-stand-env.ts`) — it never guesses a host.
    baseURL: process.env.E2E_DOCTOR_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
