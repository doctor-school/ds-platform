import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DOCTOR_CONSUMPTION_CI_PORT ?? 3211);
const BASE = `http://localhost:${PORT}`;
const API_PORT = Number(process.env.DOCTOR_FAKE_API_PORT ?? 3212);
const API = `http://127.0.0.1:${API_PORT}`;

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
      command: "node e2e/support/specialty-choice-api.mjs",
      url: `${API}/health`,
      env: { DOCTOR_FAKE_API_PORT: String(API_PORT) },
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
