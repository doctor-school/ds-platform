import { defineConfig, devices } from "@playwright/test";

/**
 * 019 EARS-3 (#1518) + EARS-4 (#1519) — the `/events` route tier.
 *
 * A third tier rather than a case in `playwright.ci.config.ts`, because that one
 * is BACKEND-FREE by contract and `/events` cannot degrade into the assertions
 * this tier makes: day groups and the horizon only exist when something answers
 * `GET /v1/storefront/doctor/events`. So this tier boots a fixed upstream
 * stand-in beside the already-BUILT app (CI builds `@ds/doctor` before running
 * `test:e2e:ci`) and points the server-side reads at it via `API_PROXY_TARGET`.
 *
 * Run locally (after `pnpm --filter @ds/doctor build`):
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.events.config.ts
 */
const PORT = Number(process.env.DOCTOR_EVENTS_CI_PORT ?? 3213);
const BASE = `http://127.0.0.1:${PORT}`;
const API_PORT = Number(process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214);
const API = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /events-(feed|url-state|month-beside-feed|guest)\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/doctor-events-api.mjs",
      url: `${API}/health`,
      env: { DOCTOR_EVENTS_FAKE_API_PORT: String(API_PORT) },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @ds/doctor exec next start -p ${PORT}`,
      url: BASE,
      env: { API_PROXY_TARGET: API },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
