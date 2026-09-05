import { defineConfig, devices } from "@playwright/test";

/**
 * 006 · 020 (#1912, #1722 slice 4) — the DOCTOR host's LIVE-STAND room tier.
 *
 * The doctor storefront mounts the shared `@ds/room` unit at
 * `/events/:slug/room`; slice 3 shipped that mount, and this tier is the browser
 * proof that the mount behaves on a REAL stand — the same tier the academy owns
 * in `apps/portal/e2e/room.spec.ts`, retargeted at this host's route table (D10)
 * and its own chrome.
 *
 * Like `playwright.event-page.config.ts` this config starts NOTHING: the
 * dev-stand topology (api + Postgres + Zitadel + Mailpit + the BUILT doctor app)
 * is the operator's, exactly as the portal's live tier works. Every spec here
 * gates on `e2e/support/live-stand-env.ts`, so a stray CI invocation with a bare
 * env is inert-green while a HALF-exported env fails loudly by variable name.
 *
 * `fullyParallel: false` / `workers: 1`: the tier drives one reusable doctor
 * account through real logins, and parallel workers would both multiply the
 * per-IP login rate and race the shared presence state of one seeded room.
 *
 * Run against a provisioned stand (after building `@ds/api` + `@ds/doctor`):
 *   E2E_DOCTOR_URL=http://localhost:3204 \
 *   E2E_DOCTOR_EMAIL=… E2E_DOCTOR_PASSWORD=… \
 *   E2E_ROOM_SLUG_YOUTUBE=seed-006-room-youtube \
 *   E2E_ROOM_SLUG_RUTUBE=seed-006-room-rutube \
 *   E2E_ROOM_SLUG_UNAVAILABLE=seed-006-room-unavailable \
 *   E2E_ROOM_SLUG_NOT_LIVE=seed-005-upcoming \
 *   E2E_ROOM_HEARTBEAT_SECONDS=2 IDP_ISSUER=… MAILPIT_URL=… \
 *   pnpm --filter @ds/doctor exec playwright test --config=playwright.room.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  // The two files of this tier: the behaviour spec and its a11y twin. Playwright
  // normalises the tested path to POSIX separators before matching, so `/` here is
  // correct on Windows and Linux alike (no drive letters, no `\` classes).
  testMatch: [/(^|\/)room\.spec\.ts$/, /a11y\/room-axe\.e2e\.spec\.ts$/],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL ?? "http://localhost:3004",
    trace: "retain-on-failure",
    locale: "ru-RU",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
