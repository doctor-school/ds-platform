import { defineConfig, devices } from "@playwright/test";

/**
 * Showcase CI Playwright config — the BACKEND-FREE runtime-check tier
 * (ADR-0013 §7 layer 4, design-system-showcase spec §5.2, #351).
 *
 * This is the surface the §5.2 retarget moves the runtime checks ONTO: the
 * interaction smoke + axe-core a11y scan that used to drive the auth surfaces
 * (`apps/portal`, #274/#285) now drive the SHOWCASE, which renders every
 * primitive/block in every state in one place — a strict superset of the
 * auth-only checks. The portal CI tier (`playwright.ci.config.ts` +
 * `interaction-states`/`a11y-axe` specs) was retired in the same change; the
 * portal keeps only its LIVE dev-stand tier (`playwright.config.ts`, real-Zitadel
 * `auth-journeys`).
 *
 * Hermetic, like the portal tier it replaces: the showcase is a pure viewer of
 * `@ds/design-system` with no BFF / api / Zitadel / Mailpit / Postgres, so this
 * config owns a `webServer` that boots the already-built showcase with
 * `next start` and the specs read computed styles + run an axe scan on landing.
 * No backend env, no dev-stand.
 *
 * Run locally (after `pnpm --filter @ds/showcase build`):
 *   pnpm --filter @ds/showcase test:e2e:ci
 */

const PORT = Number(process.env.SHOWCASE_CI_PORT ?? 3220);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
  // Boot the already-built showcase. `next start` serves the `.next` production
  // build, so the CI job runs `pnpm --filter @ds/showcase build` first. No backend
  // env is needed — the showcase has no BFF. `reuseExistingServer` lets a local
  // run reuse a showcase already up on PORT.
  webServer: {
    command: `pnpm --filter @ds/showcase exec next start -p ${PORT}`,
    url: BASE,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
