import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { standRunFilter } from "@ds/e2e/stand-run-filter";

/**
 * 024 (#4011) — the doctor course path / step screens LIVE tier, with the
 * 023 school screen at volume (#4017, `e2e/school-volume-live.spec.ts`) and the
 * 024 EARS-24 rule-change reason (#4012, `e2e/learning-rule-change-live.spec.ts`)
 * and the 023 «скоро» school interest (#4019, `e2e/school-interest-live.spec.ts`). Starts
 * nothing: the stand (api, doctor, sign-in host, portal) is the operator's;
 * every test skips when the env is absent, so a bare CI invocation is inert.
 * Run recipe: `e2e/learning-path-live.spec.ts` docblock.
 */
export default defineConfig({
  // `pnpm e2e:stage --grep` narrows this leg; the box-observing tests stay out (#4096).
  ...standRunFilter(),
  testDir: "./e2e",
  testMatch:
    /(learning-path(-volume)?|learning-rule-change|school-volume|school-interest)-live\.spec\.ts$/,
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
