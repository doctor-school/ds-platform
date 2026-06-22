import { defineConfig, devices } from "@playwright/test";

/**
 * Portal CI Playwright config — the BACKEND-FREE tier (ADR-0013 §7 layer 4, #274).
 *
 * This is the OTHER half of the repo's two-tier portal-E2E pattern. The sibling
 * `playwright.config.ts` is the operator-driven, dev-stand-gated LIVE tier (real
 * api + Zitadel + Mailpit, NOT in CI, no `webServer` — the operator owns the
 * topology). THIS config is the one CI runs: it owns a `webServer` that boots the
 * already-built portal with `next start`, and `testMatch` scopes it to the
 * render-time-only specs (interaction smoke + axe scan) that need NO backend —
 * the auth pages render their forms client-side and only hit the BFF on submit,
 * which these specs never do (they read computed styles + run an axe scan on
 * landing). So this tier is hermetic: build the portal, `next start`, drive the
 * browser, assert. No Postgres / Zitadel / Mailpit, no env gate.
 *
 * Run locally (after `pnpm --filter @ds/portal build`):
 *   pnpm --filter @ds/portal test:e2e:ci
 */

const PORT = Number(process.env.PORTAL_CI_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Only the backend-free render-time specs run in CI — the live-Zitadel
  // journeys (`auth-journeys`) and the client-side validation suite
  // (`identifier-validation`, which the live tier already covers) stay out.
  testMatch: ["interaction-states.e2e.spec.ts", "a11y-axe.e2e.spec.ts"],
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
  // Boot the already-built portal. `next start` serves the `.next` production
  // build, so the CI job must run `pnpm --filter @ds/portal build` first. No
  // backend env is needed: the auth pages render client-side and these specs
  // never submit. `reuseExistingServer` lets a local run reuse a portal that is
  // already up on PORT.
  webServer: {
    command: `pnpm --filter @ds/portal exec next start -p ${PORT}`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
