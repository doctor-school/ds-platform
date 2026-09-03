import { defineConfig, devices } from "@playwright/test";

/**
 * 020 EARS-1 (#1764, slice 3) — the doctor event-page LIVE tier.
 *
 * A fourth tier, and a dev-stand-gated one, because `020 EARS-1`'s contract is
 * that BOTH storefronts answer from the ONE core: the cross-host identity row
 * compares the two real API bodies, which no fixed upstream stand-in can prove.
 * So this config starts nothing — the dev-stand topology (api + Postgres + the
 * built doctor app) is the operator's, exactly as the portal's live tier
 * (`apps/portal/playwright.config.ts`) works. Every test `test.skip`s when the
 * env is absent, so a stray CI invocation is inert.
 *
 * Run against a provisioned stand (after `pnpm --filter @ds/doctor build`):
 *   E2E_DOCTOR_URL=http://localhost:3004 E2E_API_URL=http://localhost:3000 \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.event-page.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /event-page\.spec\.ts$/,
  fullyParallel: false,
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
