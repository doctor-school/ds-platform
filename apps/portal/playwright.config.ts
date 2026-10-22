import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

/**
 * Portal browser-E2E config (#131 / #574). This is the REAL-Zitadel tier of the
 * repo's two-tier auth test pattern (mirroring `apps/api/test/auth/zitadel-otp-
 * login.e2e-spec.ts`): it drives a real browser against a RUNNING portal that
 * proxies `/v1/*` to a running api + Postgres + Zitadel + Mailpit dev-stand. It is
 * a manual, dev-stand-gated gate — NOT part of CI and NOT in the default `pnpm
 * test` / turbo `test` pipeline. Every spec `test.skip`s (or its BDD steps no-op)
 * when the dev-stand env is absent, so a stray CI invocation is inert.
 *
 * Two projects:
 *   • `e2e`  — the hand-written plain-`@playwright/test` specs under `./e2e`
 *     (the per-EARS pins: `event-page-registered.spec.ts`, `my-events.spec.ts`,
 *     `auth-journeys.e2e.spec.ts`, …). Unchanged tier.
 *   • `bdd`  — the 005 all-states registration JOURNEY (#574, the requirements
 *     Verification `all` row), translated from `e2e/features/*.feature` via
 *     `playwright-bdd` (`bddgen` generates the runnable specs into `.features-gen`
 *     before `playwright test`). This project pins a DELIBERATELY non-Moscow
 *     `timezoneId` so the МСК-no-drift assertion (EARS-11) proves no viewer-local
 *     drift for the whole journey, and a `ru-RU` locale so the browser-provisioned
 *     003 accounts bind + read a consistent fingerprint surface (ADR-0001 §6).
 *
 * The `bdd` locale/timezone overrides live on the project (NOT top-level `use`) so
 * they never change the fingerprint surface the `e2e` project's seeded-cookie
 * spec (`my-events.spec.ts`) bound at login.
 *
 * Run against a provisioned dev-stand with, e.g.:
 *   IDP_ISSUER=… IDP_CLIENT_ID=… IDP_SERVICE_TOKEN=… IDP_REDIRECT_URI=… \
 *   MAILPIT_URL=http://truenas.local:8025 E2E_PORTAL_URL=http://localhost:3001 \
 *   E2E_WEBINAR_SLUG=seed-005-upcoming E2E_ONE_TAP_SLUG=seed-005-upcoming-2 \
 *   E2E_WEBINAR_SLUG_ENDED=seed-005-ended E2E_WEBINAR_SLUG_HIDDEN=seed-005-hidden \
 *   pnpm --filter @ds/portal test:e2e --project=bdd
 * The event-page specs (`event-page-020.e2e.spec.ts`, `webinar-archive.spec.ts`)
 * run on their own tier, `playwright.event-page.config.ts`, whose header lists
 * the `seed:events` slug for each of their env vars (#2996).
 * `E2E_PORTAL_URL` must point at a portal whose `/v1/*` rewrite reaches the api
 * (set `API_PROXY_TARGET` when starting that portal). We do NOT start the portal
 * here (no `webServer`): the dev-stand topology is the operator's.
 */
/**
 * Staging slots sit behind ONE basic-auth pair (`tools/staging/README.md`), so a
 * run pointed at `https://academy-pr-<N>.stage.doctor.school` needs credentials on
 * EVERY request, not only the first navigation: the app's own same-origin `/v1/*`
 * fetches are challenged too, and URL-embedded credentials in `E2E_PORTAL_URL` do
 * not reach them. The pair arrives as `E2E_HTTP_USER` / `E2E_HTTP_PASS` — the same
 * names `packages/e2e` reads — and becomes Playwright `httpCredentials`. Absent
 * (the local dev stand), it stays `undefined` and nothing changes.
 */
const httpCredentials =
  process.env.E2E_HTTP_USER && process.env.E2E_HTTP_PASS
    ? {
        username: process.env.E2E_HTTP_USER,
        password: process.env.E2E_HTTP_PASS,
      }
    : undefined;

const bddTestDir = defineBddConfig({
  features: "e2e/features/*.feature",
  // The custom `test` instance (base.extend for the journey World) lives in the
  // fixtures file, so it must be in the steps set for bddgen to bind it.
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen",
});

/**
 * ── Workers (#3191) ──────────────────────────────────────────────────────────
 * Spec FILES run in parallel on `E2E_WORKERS` workers (default 1 — the manual
 * dev-stand pass keeps its serial order); the tests inside one file stay in file
 * order (`fullyParallel: false`), since several files chain their steps. What
 * once forced `workers: 1` — the shared Mailpit inbox — no longer races: every
 * journey registers its own random address and reads Mailpit by that recipient
 * (`support/mailpit.ts` searches `to:<email>`), as the main suite does
 * (`packages/e2e/lib/owned-registration.ts`). What still cannot share a worker is
 * the ONE golden doctor pair the run names (`E2E_DOCTOR_*` / `E2E_DOCTOR2_*`):
 * two files signed in as it at once would log each other out and race its
 * registrations. Those files form the `golden-account` project, held to one
 * worker; it runs alongside the parallel projects.
 */
const workers = Number(process.env.E2E_WORKERS ?? 1);
if (!Number.isInteger(workers) || workers < 1) {
  throw new Error(
    `E2E_WORKERS=${process.env.E2E_WORKERS} — expected a positive integer.`,
  );
}

/** The specs that sign in as the run's golden doctor pair (`E2E_DOCTOR*_*`). */
const GOLDEN_ACCOUNT_SPECS = [
  /[\\/]event-page-parity\.e2e\.spec\.ts$/,
  /[\\/]event-page-registered\.spec\.ts$/,
  /[\\/]my-events\.spec\.ts$/,
  /[\\/]return-to-origin\.spec\.ts$/,
  /[\\/]room-chat\.spec\.ts$/,
  /[\\/]room-presence-count\.spec\.ts$/,
  /[\\/]room\.spec\.ts$/,
  /[\\/]theme\.e2e\.spec\.ts$/,
];

/**
 * The a11y/axe scans are separate gates: the dev-stand-gated manual pass
 * (`test:axe` → `playwright.axe.config.ts`, under `e2e/a11y/`) and the hermetic
 * CI page-level scan (`test:e2e:ci` → `playwright.ci.config.ts`,
 * `a11y-axe.e2e.spec.ts`, #400). #3151: the shared /account auth-path body
 * rides its own live tier (`playwright.account-live.config.ts`), and the
 * #2996 event-page specs theirs (`playwright.event-page.config.ts`).
 */
const OWN_CONFIG_SPECS = [
  /a11y\//,
  /a11y-axe\.e2e\.spec\.ts/,
  /account-auth-paths-live\.spec\.ts/,
  /event-page-020\.e2e\.spec\.ts/,
  /webinar-archive\.spec\.ts/,
];

export default defineConfig({
  fullyParallel: false,
  workers,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_PORTAL_URL ?? "http://localhost:3001",
    httpCredentials,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "e2e",
      testDir: "./e2e",
      testMatch: /\.spec\.ts$/,
      testIgnore: [...OWN_CONFIG_SPECS, ...GOLDEN_ACCOUNT_SPECS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The files signed in as the one golden doctor pair: one worker, so no
      // two of them hold its session at once (see «Workers» above).
      name: "golden-account",
      testDir: "./e2e",
      testMatch: GOLDEN_ACCOUNT_SPECS,
      testIgnore: OWN_CONFIG_SPECS,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "bdd",
      testDir: bddTestDir,
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        // A deliberately non-МСК timezone: the МСК labels must not drift (EARS-11).
        timezoneId: "America/New_York",
      },
    },
  ],
});
