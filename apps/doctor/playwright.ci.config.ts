import { defineConfig, devices } from "@playwright/test";

/**
 * Doctor-storefront CI Playwright config — the BACKEND-FREE tier, the sibling of
 * `apps/portal/playwright.ci.config.ts` (which CI runs as `playwright-axe-portal`).
 *
 * It owns a `webServer` that boots the already-BUILT app with `next start`, so
 * the CI job must run the build first. No api / Postgres / Zitadel / Mailpit and
 * no special build env: the storefront shell renders no server-side api fetch,
 * and the `/v1/*` BFF is reached through a rewrite at REQUEST time.
 *
 * Unlike the portal's, the readiness probe IS `/`: this app's root does not
 * server-render an api fetch, so it answers 200 with no backend. When a future
 * route here does SSR an api read, that route — not the probe — is what changes.
 *
 * Run locally (after `pnpm --filter @ds/doctor build`):
 *   pnpm --filter @ds/doctor test:e2e:ci
 */
const PORT = Number(process.env.DOCTOR_CI_PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
    command: `pnpm --filter @ds/doctor exec next start -p ${PORT}`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
