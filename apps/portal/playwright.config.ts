import { defineConfig, devices } from "@playwright/test";

/**
 * Portal browser-E2E config (#131). This is the REAL-Zitadel tier of the repo's
 * two-tier auth test pattern (mirroring `apps/api/test/auth/zitadel-otp-login.
 * e2e-spec.ts`): it drives a real browser against a RUNNING portal that proxies
 * to a running api + Postgres + Zitadel + Mailpit dev-stand. It is a manual,
 * dev-stand-gated gate — NOT part of CI and NOT in the default `pnpm test` /
 * turbo `test` pipeline. The specs themselves `test.skip` when the dev-stand env
 * is absent, so even a stray invocation is inert.
 *
 * Run it against a provisioned dev-stand with, e.g.:
 *   IDP_ISSUER=… IDP_CLIENT_ID=… IDP_SERVICE_TOKEN=… IDP_REDIRECT_URI=… \
 *   MAILPIT_URL=http://truenas.local:8025 E2E_PORTAL_URL=http://localhost:3001 \
 *   pnpm --filter @ds/portal test:e2e
 *
 * `E2E_PORTAL_URL` must point at a portal whose `/v1/*` rewrite reaches the api
 * (set `API_PROXY_TARGET` when starting that portal). We do NOT start the portal
 * here (no `webServer`): the dev-stand topology — which portal, which api, which
 * Zitadel — is the operator's, exactly like the api LIVE_OIDC specs.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial: the journeys create live Zitadel users and read a shared Mailpit
  // inbox; parallel runs would race on the catch-all mailbox.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
