import { defineConfig, devices } from "@playwright/test";

/**
 * 021 EARS-2 (#1538) — the return-context tier.
 *
 * A THIRD doctor-storefront Playwright tier, alongside the backend-free
 * `playwright.ci.config.ts` and the specialty `playwright.consumption.config.ts`,
 * for the same reason the second one exists: `/register?returnTo=…` resolves the
 * event on the SERVER before the first byte of HTML, so the read cannot be
 * intercepted from the browser and the backend-free tier can only ever observe
 * the absent-context branch. The app is booted against `return-context-api.mjs`
 * — a double of the upstream api, not a stub in product code — with
 * `API_PROXY_TARGET` pointing at it, which is exactly how the server-side read
 * addresses the api in production.
 *
 * Its own port and its own fake-api port, so the tier can run beside the other
 * two without either binding a listener the other owns.
 *
 * Run locally:
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.return-context.config.ts
 */
const PORT = Number(process.env.DOCTOR_RETURN_CONTEXT_PORT ?? 3213);
const BASE = `http://localhost:${PORT}`;
const API_PORT = Number(process.env.DOCTOR_RETURN_CONTEXT_API_PORT ?? 3214);
const API = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "register-return-context.spec.ts",
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
      command: "node e2e/support/return-context-api.mjs",
      url: `${API}/health`,
      env: { DOCTOR_FAKE_API_PORT: String(API_PORT) },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @ds/doctor build && pnpm --filter @ds/doctor exec next start -p ${PORT}`,
      url: BASE,
      env: { API_PROXY_TARGET: API },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
