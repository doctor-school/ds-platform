import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DOCTOR_CONSUMPTION_CI_PORT ?? 3211);
// The spec addresses the app and its cookies as `localhost` (a secure
// context for its `__Host-` cookies); the app binds every interface.
const BASE = `http://localhost:${PORT}`;
const API_PORT = Number(process.env.DOCTOR_FAKE_API_PORT ?? 3212);
const API = `http://127.0.0.1:${API_PORT}`;

// #3172 — the sign-in entries (`/login`, `/register`, `/reset`, `/verify`)
// answer a 303 built by the API's internal transaction endpoint; the tier
// boots the shared double of that endpoint
// (`packages/e2e/doubles/storefront-internal-api.mjs`), whose authorize URL
// points back at itself so a followed entry lands on a real answer.
const DOUBLE_PORT = Number(process.env.STOREFRONT_DOUBLE_PORT ?? 3217);
const DOUBLE = `http://127.0.0.1:${DOUBLE_PORT}`;
const DOUBLE_TOKEN = "storefront-double-token";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "specialty-consumption.spec.ts",
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
      command: "node ../../packages/e2e/doubles/storefront-internal-api.mjs",
      url: `${DOUBLE}/health`,
      env: {
        STOREFRONT_DOUBLE_PORT: String(DOUBLE_PORT),
        STOREFRONT_DOUBLE_TOKEN: DOUBLE_TOKEN,
        STOREFRONT_DOUBLE_AUTHORIZE: `${DOUBLE}/oauth/v2/authorize`,
      },
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "node e2e/support/specialty-choice-api.mjs",
      url: `${API}/health`,
      env: { DOCTOR_FAKE_API_PORT: String(API_PORT) },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @ds/doctor build && pnpm --filter @ds/doctor exec next start -p ${PORT} --keepAliveTimeout 125000`,
      url: BASE,
      env: {
        API_PROXY_TARGET: API,
        INTERNAL_API_URL: DOUBLE,
        INTERNAL_API_TOKEN: DOUBLE_TOKEN,
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
