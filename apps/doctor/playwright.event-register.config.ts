import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

/**
 * 005 EARS-1/2/3/4 (#2005) — the DOCTOR host LIVE-STAND tier for one-tap эфир
 * registration.
 *
 * Its own config rather than a slot in `playwright.ci.config.ts` for the reason
 * the room tier has one: these specs drive the REAL
 * `POST /v1/events/:slug/registration` and the REAL per-viewer participation read
 * over a REAL `__Host-ds_session`, so they need an api + Postgres + Zitadel behind
 * the built doctor app. A backend-free run would fail against a correct product.
 *
 * Like `playwright.room.config.ts` this config starts NOTHING: the dev-stand
 * topology is the operator own. Every spec here gates on
 * `e2e/support/live-stand-env.ts`, so a stray invocation with a bare env is
 * inert-green while a HALF-exported env fails loudly by variable name.
 *
 * `fullyParallel: false` / `workers: 1`, and for a second reason beyond the room
 * tier: these tests are ORDERED — the EARS-3 idempotence test observes the roster
 * the EARS-1 test just joined, and registration has no cancel (005 has no such
 * clause, so the api exposes no `DELETE`). Parallel or reordered execution would
 * make the tier assert a state nobody established.
 *
 * Run against a provisioned stand (after building `@ds/api` + `@ds/doctor`):
 *   E2E_DOCTOR_URL=http://localhost:3204 \
 *   E2E_DOCTOR_EMAIL=… E2E_DOCTOR_PASSWORD=… \
 *   E2E_EVENT_SLUG_ONE_TAP=… E2E_EVENT_SLUG_RETURN=… \
 *   IDP_ISSUER=… MAILPIT_URL=… \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.event-register.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  // Playwright normalises the tested path to POSIX separators before matching,
  // so `/` here is correct on Windows and Linux alike (no drive letters).
  // 014 EARS-9 (#1972): «Мои события» rides here — the same signed-in doctor
  // account and stand, reading what one-tap registration writes.
  testMatch: [
    /(^|\/)event-register-one-tap\.spec\.ts$/,
    /(^|\/)my-events\.spec\.ts$/,
    // #2073 (wave-4 gate row 19): the signed-in `/account` cabinet — its axe
    // scan and its 390 px check — on the same reused doctor account.
    /(^|\/)a11y\/account-axe\.e2e\.spec\.ts$/,
    /(^|\/)account-mobile\.spec\.ts$/,
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL ?? "http://localhost:3004",
    // A staging slot's basic-auth pair (#3168); undefined on a local stand.
    httpCredentials: standHttpCredentials(),
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
