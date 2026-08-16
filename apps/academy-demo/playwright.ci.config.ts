import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.ACADEMY_DEMO_CI_PORT ?? 3230);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["academy-home.e2e.spec.ts", "a11y-axe.e2e.spec.ts"],
  fullyParallel: true,
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
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
