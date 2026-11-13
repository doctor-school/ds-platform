import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

/**
 * 024 (#4011) — the doctor course path / step screens LIVE tier. Starts
 * nothing: the stand (api, doctor, sign-in host, portal) is the operator's;
 * every test skips when the env is absent, so a bare CI invocation is inert.
 * Run recipe: `e2e/learning-path-live.spec.ts` docblock.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /learning-path-live\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL,
    locale: "ru-RU",
    httpCredentials: standHttpCredentials(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
