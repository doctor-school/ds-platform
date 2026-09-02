import { defineConfig, devices } from "@playwright/test";

/**
 * Doctor-storefront CI Playwright config — the BACKEND-FREE tier, the sibling of
 * `apps/portal/playwright.ci.config.ts` (which CI runs as `playwright-axe-portal`).
 *
 * It owns a `webServer` that boots the already-BUILT app with `next start`, so
 * the CI job must run the build first. No api / Postgres / Zitadel / Mailpit and
 * no special build env: the `/v1/*` BFF is reached through a rewrite at REQUEST
 * time, and every server-side api read on these routes is written to DEGRADE
 * rather than throw when there is nothing to read from.
 *
 * Unlike the portal's, the readiness probe IS `/`. The root now does server-side
 * reads (`lib/shell-auth.ts` for the header, `lib/specialty-choice.ts` for the
 * remembered specialty, #1482), but both resolve «unknown» on an unreachable api
 * instead of failing the render, so the route still answers 200 with no backend
 * and the storefront falls back to its client-side read. A future route that
 * CANNOT degrade that way is what would change the probe — not this one.
 *
 * Run locally (after `pnpm --filter @ds/doctor build`):
 *   pnpm --filter @ds/doctor test:e2e:ci
 */
const PORT = Number(process.env.DOCTOR_CI_PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Every backend-REQUIRING spec lives in its own tier: the specialty
  // consumption flow, the 021 EARS-2 return context and the 019 EARS-3
  // day-grouped events feed each boot the app against their own upstream
  // double (this tier boots no api at all).
  testIgnore: [
    "specialty-consumption.spec.ts",
    "register-return-context.spec.ts",
    "events-feed.spec.ts",
  ],
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
