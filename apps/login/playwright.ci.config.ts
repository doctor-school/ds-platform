import { defineConfig, devices } from "@playwright/test";

/**
 * The sign-in host's CI tier (`playwright-axe-login`, #3170): the production
 * build behind `next start`, its api upstream a double answering only the
 * entry read (`e2e/support/sign-in-entry-api.mjs`). The build must have been
 * made with `API_PROXY_TARGET` pointing at the double (ci.yml does).
 */
const PORT = Number(process.env.LOGIN_CI_PORT ?? 3215);
const API_PORT = Number(process.env.LOGIN_FAKE_API_PORT ?? 3216);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/support/sign-in-entry-api.mjs",
      url: `${API}/health`,
      env: { LOGIN_FAKE_API_PORT: String(API_PORT) },
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @ds/login exec next start -H 0.0.0.0 -p ${PORT} --keepAliveTimeout 125000`,
      url: `${BASE}/icon.svg`,
      // 003 EARS-72 — the refusal page's way out names both storefronts,
      // read at request time from the storefronts' own origin variables.
      env: {
        API_PROXY_TARGET: API,
        ACADEMY_PUBLIC_ORIGIN: "http://localhost:3001",
        DOCTOR_PUBLIC_ORIGIN: "http://localhost:3004",
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
