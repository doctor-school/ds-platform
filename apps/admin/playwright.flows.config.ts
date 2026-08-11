import { defineConfig, devices } from "@playwright/test";

/**
 * Plain `@playwright/test` FLOW specs for the admin app — the browser half of a
 * Verification row that is a user journey rather than a BDD scenario or an axe
 * scan (today: the 011 EARS-4/5 forced-enrollment arc,
 * `e2e/mfa-enrollment.spec.ts`).
 *
 * A third config rather than a widened one, because the two existing configs each
 * gate something specific and folding a flow spec into either would blur it:
 * `playwright.config.ts` runs only bddgen output from `e2e/features/*.feature`,
 * and `playwright.axe.config.ts` is the a11y scan whose green means "no WCAG
 * violation" — a failing flow spec inside it would report as an a11y failure.
 *
 * Dev-stand-gated and MANUAL like its siblings — not in CI, not in the default
 * turbo `test` pipeline: the specs provision a real `platform_admin` against the
 * stand's Zitadel and throw when the `IDP_*` env is absent, so a stray invocation
 * fails fast rather than pretending to pass. Run against a booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3201 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:flows
 *
 * The api must be booted with bot-protection off (the dev-stand recipe), because
 * the session bootstrap registers through `/v1/auth/register` — and, since the
 * 011 MFA arc costs several auth calls per test from ONE loopback address, with
 * the #1076 ops-window ceilings raised (`RATE_LIMIT_PER_IP_15MIN=…`,
 * `RATE_LIMIT_PER_USER_15MIN=…`). Without them the run trips the production
 * per-IP ceiling mid-suite and reports `login.errorThrottled` as a broken login;
 * the ceilings themselves are proven by `abuse-limits.e2e` + `mfa-challenge.e2e`,
 * not here.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  // The a11y scan is its own gate with its own config and its own meaning of
  // "green"; picking it up here would report a WCAG failure as a flow failure.
  testIgnore: "a11y/**",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
