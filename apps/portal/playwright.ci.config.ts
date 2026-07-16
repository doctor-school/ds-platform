import { defineConfig, devices } from "@playwright/test";

/**
 * Portal CI Playwright config — the BACKEND-FREE tier (#400, resurrecting the
 * #274 tier that the #351 showcase retarget retired).
 *
 * This is the OTHER half of the repo's two-tier portal-E2E pattern. The sibling
 * `playwright.config.ts` is the operator-driven, dev-stand-gated LIVE tier (real
 * api + Zitadel + Mailpit, NOT in CI, no `webServer` — the operator owns the
 * topology). THIS config is the one CI runs (`playwright-axe-portal` job): it
 * owns a `webServer` that boots the already-built portal with `next start`, and
 * `testMatch` pins it to the single thin page-level a11y spec that needs NO
 * backend — the auth pages render their forms client-side, and the spec mocks
 * the one mount-time BFF read (the `/v1/auth/session` guard probe, which never
 * settles on a dead upstream — #1034) via `page.route`, then runs an axe scan
 * + page-shell assertions on landing. So this tier is hermetic: build the portal,
 * `next start`, drive the browser, assert. No Postgres / Zitadel / Mailpit, no
 * env gate. The showcase `playwright-axe` gate covers the DS primitives; this
 * tier covers the COMPOSED product pages (page shell, landmark structure,
 * heading hierarchy) that no primitive catalogue can assert.
 *
 * Run locally (after `pnpm --filter @ds/portal build`):
 *   pnpm --filter @ds/portal test:e2e:ci
 */

const PORT = Number(process.env.PORTAL_CI_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
// Readiness probe: NOT `/` — the portal home server-renders an api fetch, so
// with no backend it 500s and Playwright's webServer check (2xx–4xx) would
// never pass. `/login` is one of the backend-free pages this tier scans.
const READY_URL = `${BASE}/login`;

export default defineConfig({
  testDir: "./e2e",
  // ONLY the thin page-level axe spec runs in CI — the live-Zitadel journeys and
  // the dev-stand-gated `e2e/a11y/` suite (`test:axe`) stay out. Anchored regex,
  // not a bare-basename glob: `e2e/a11y/a11y-axe.e2e.spec.ts` (the dev-stand
  // tier) shares the basename and a glob would drag its env-skipped tests in.
  testMatch: /[\\/]e2e[\\/]a11y-axe\.e2e\.spec\.ts$/,
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
  // build, so the CI job must run the portal build first. No backend env is
  // needed: the auth pages render client-side and the spec never submits.
  // `reuseExistingServer` lets a local run reuse a portal already up on PORT.
  webServer: {
    command: `pnpm --filter @ds/portal exec next start -p ${PORT}`,
    url: READY_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
