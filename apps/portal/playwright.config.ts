import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

/**
 * Portal browser-E2E config (#131 / #574). This is the REAL-Zitadel tier of the
 * repo's two-tier auth test pattern (mirroring `apps/api/test/auth/zitadel-otp-
 * login.e2e-spec.ts`): it drives a real browser against a RUNNING portal that
 * proxies `/v1/*` to a running api + Postgres + Zitadel + Mailpit dev-stand. It is
 * a manual, dev-stand-gated gate — NOT part of CI and NOT in the default `pnpm
 * test` / turbo `test` pipeline. Every spec `test.skip`s (or its BDD steps no-op)
 * when the dev-stand env is absent, so a stray CI invocation is inert.
 *
 * Two projects:
 *   • `e2e`  — the hand-written plain-`@playwright/test` specs under `./e2e`
 *     (the per-EARS pins: `event-page-registered.spec.ts`, `my-events.spec.ts`,
 *     `auth-journeys.e2e.spec.ts`, …). Unchanged tier.
 *   • `bdd`  — the 005 all-states registration JOURNEY (#574, the requirements
 *     Verification `all` row), translated from `e2e/features/*.feature` via
 *     `playwright-bdd` (`bddgen` generates the runnable specs into `.features-gen`
 *     before `playwright test`). This project pins a DELIBERATELY non-Moscow
 *     `timezoneId` so the МСК-no-drift assertion (EARS-11) proves no viewer-local
 *     drift for the whole journey, and a `ru-RU` locale so the browser-provisioned
 *     003 accounts bind + read a consistent fingerprint surface (ADR-0001 §6).
 *
 * The `bdd` locale/timezone overrides live on the project (NOT top-level `use`) so
 * they never change the fingerprint surface the `e2e` project's seeded-cookie
 * spec (`my-events.spec.ts`) bound at login.
 *
 * Run against a provisioned dev-stand with, e.g.:
 *   IDP_ISSUER=… IDP_CLIENT_ID=… IDP_SERVICE_TOKEN=… IDP_REDIRECT_URI=… \
 *   MAILPIT_URL=http://truenas.local:8025 E2E_PORTAL_URL=http://localhost:3001 \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming E2E_ONE_TAP_SLUG=seed-005-upcoming-2 \
 *   E2E_WEBINAR_SLUG_ENDED=seed-005-ended E2E_WEBINAR_SLUG_ARCHIVED=seed-005-archived \
 *   pnpm --filter @ds/portal test:e2e --project=bdd
 * `E2E_PORTAL_URL` must point at a portal whose `/v1/*` rewrite reaches the api
 * (set `API_PROXY_TARGET` when starting that portal). We do NOT start the portal
 * here (no `webServer`): the dev-stand topology is the operator's.
 */
const bddTestDir = defineBddConfig({
  features: "e2e/features/*.feature",
  // The custom `test` instance (base.extend for the journey World) lives in the
  // fixtures file, so it must be in the steps set for bddgen to bind it.
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen",
});

export default defineConfig({
  // Serial: the journeys create live Zitadel users and read a shared Mailpit
  // inbox; parallel runs would race on the catch-all mailbox.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testDir: "./e2e",
      testMatch: /\.spec\.ts$/,
      // The a11y/axe scans are separate gates: the dev-stand-gated manual pass
      // (`test:axe` → `playwright.axe.config.ts`, under `e2e/a11y/`) and the
      // hermetic CI page-level scan (`test:e2e:ci` → `playwright.ci.config.ts`,
      // `a11y-axe.e2e.spec.ts`, #400). Keep both out of the default `test:e2e`.
      testIgnore: [/a11y\//, /a11y-axe\.e2e\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "bdd",
      testDir: bddTestDir,
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        // A deliberately non-МСК timezone: the МСК labels must not drift (EARS-11).
        timezoneId: "America/New_York",
      },
    },
  ],
});
