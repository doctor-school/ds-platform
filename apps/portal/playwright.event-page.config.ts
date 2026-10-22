import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

/**
 * Academy event-page LIVE tier (#2996) — the twin of the doctor host's
 * `apps/doctor/playwright.event-page.config.ts`.
 *
 * `e2e/event-page-020.e2e.spec.ts` (020 EARS-1/8/9/19) and
 * `e2e/webinar-archive.spec.ts` (014 EARS-4/5/7/8/21) read event slugs whose
 * shape they assert: an upcoming event with speakers, an ended one with a
 * published montage, an ended one awaiting a dated recording, hybrid / offline
 * events with seats and sold out. Their own config so a staging slot can hand
 * them the golden slugs (`tools/staging/live-tiers.mjs` → `seededEnv`) without
 * switching on every default-tier spec that also reads `E2E_WEBINAR_SLUG`. Like
 * the other live tiers it boots NO server; every test `test.skip`s when its env
 * is absent, so a stray CI invocation is inert.
 *
 * Local run against a branch DB seeded by `seed:events` (its stdout `eventPage`
 * block is this list):
 *   E2E_PORTAL_URL=http://localhost:3001 \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming E2E_WEBINAR_SLUG_ENDED=seed-005-ended \
 *   E2E_ENDED_WEBINAR_SLUG=seed-014-ended-month-ago \
 *   E2E_PREPARING_WEBINAR_SLUG=seed-005-ended-preparing \
 *   E2E_PREPARING_UNDATED_WEBINAR_SLUG=seed-005-ended \
 *   E2E_HYBRID_SLUG=seed-005-hybrid E2E_HYBRID_SOLDOUT_SLUG=seed-005-hybrid-sold-out \
 *   E2E_OFFLINE_SOLDOUT_SLUG=seed-005-offline-sold-out \
 *   E2E_SWEEP_SLUGS=seed-005-upcoming,seed-005-ended,seed-005-offline,seed-005-offline-sold-out,seed-005-hybrid,seed-005-hybrid-sold-out \
 *   pnpm --filter @ds/portal test:e2e:event-page
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|[/\\])(event-page-020\.e2e|webinar-archive)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL,
    httpCredentials: standHttpCredentials(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
