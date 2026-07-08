import { defineConfig, devices } from "@playwright/test";

/**
 * 005 EARS-13 (contrast slice) — axe-core WCAG 2 A/AA scan of the touched portal
 * webinar surfaces (the registered event-page state + «мои события»), the runtime
 * twin of the CI `playwright-axe` BLOCK gate (which scans the DS primitives via the
 * showcase). It retargets the a11y/contrast scan onto the 005 portal composition,
 * in BOTH themes (light + `.dark`) — the settled token fact it guards: text on
 * `bg-card` uses card-safe AA tokens (`text-primary-action`), never `text-primary`
 * (the #270 precedent). The full canvas-fidelity eyes-on verification (EARS-13,
 * both breakpoints × both themes) is a separate verification brief.
 *
 * Dev-stand-gated like the BDD journey — it provisions a real 003 doctor + reads
 * Mailpit; the spec `test.skip`s unless the live stand env is present, so a stray
 * CI invocation is inert. Runs standalone via `pnpm --filter @ds/portal test:axe`.
 */
export default defineConfig({
  testDir: "./e2e/a11y",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
