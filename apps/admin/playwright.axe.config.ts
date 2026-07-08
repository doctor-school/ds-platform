import { defineConfig, devices } from "@playwright/test";

/**
 * 007 EARS-11 axe-core a11y scan config (#595) — the runtime a11y twin for the
 * admin surface, separate from the playwright-bdd config so it runs plain
 * `@playwright/test` specs (not bddgen output). Dev-stand-gated, like the BDD
 * suite; provisions a real platform_admin session. Run with:
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:axe
 */
export default defineConfig({
  testDir: "./e2e/a11y",
  testMatch: "**/*.e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
