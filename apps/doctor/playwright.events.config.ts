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
 * `API_PROXY_TARGET` is set on `next start` for the SERVER-side reads, and it must
 * ALSO be present at BUILD time: `rewrites()` is evaluated when the routes manifest
 * is emitted, so the `/v1/:path*` destination is frozen into the build (#1647) and a
 * start-time-only value is ignored. The 019 EARS-6 live block polls
 * `GET /v1/storefront/doctor/events/live` from the BROWSER, so a build baked with the
 * config default answers 404 and the block never clears itself.
 *
 * Run locally — the build carries the same upstream as the tier:
 *   API_PROXY_TARGET=http://127.0.0.1:3214 pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.events.config.ts
 *
 * Overriding `DOCTOR_EVENTS_FAKE_API_PORT` therefore means rebuilding with the
 * matching `API_PROXY_TARGET`.
 */
const PORT = Number(process.env.DOCTOR_EVENTS_CI_PORT ?? 3213);
const BASE = `http://127.0.0.1:${PORT}`;
const API_PORT = Number(process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214);
const API = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /events-(feed|url-state|month-beside-feed|guest|live)\.spec\.ts/,
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
