/**
 * The storefront LIVE-TIER Playwright configs `pnpm e2e:stage` runs as legs (#3168).
 *
 * ── Classification rule ──────────────────────────────────────────────────────
 * Every `apps/{portal,doctor}/playwright*.config.ts` is one of two kinds:
 *
 * - **hermetic** — the config owns a `webServer` that boots the built app (and,
 *   where it needs one, an upstream double). CI runs it; a stand adds nothing.
 * - **live** — the config owns NO `webServer`: it drives a storefront the operator
 *   names with `E2E_PORTAL_URL` / `E2E_DOCTOR_URL`, backed by a real api, IdP and
 *   Mailpit. A bare CI runner can only skip it, so before #3168 these tiers were
 *   «green» without ever running (#3150: `register-live` selected by no workflow
 *   and no slot leg). A staging slot is where they run.
 *
 * `e2e-stage.test.mjs` holds the classification against the tree: a config that is
 * in neither list, a live config with a `webServer`, or a hermetic one without it
 * fails `pnpm test:tools` — a new live tier cannot be added and silently omitted.
 *
 * ── Env gating ───────────────────────────────────────────────────────────────
 * The storefront specs gate their env with `requireLiveStandEnv` (`@ds/e2e/
 * live-stand-env`): bare env ⇒ skip, partly-set env ⇒ a loud `beforeAll` failure.
 * A slot run always sets the storefront URL, so a spec whose remaining variables
 * the slot cannot provide (operator keys, a branch DATABASE_URL, a seeded slug
 * nobody exported) would read as a FAILURE that is really missing env. Each such
 * spec is declared here with the variables it requires; `e2e:stage` keeps it out of
 * the run (`--test-list-invert`) and prints it as «not run — missing <names>».
 * The test asserts every `requireLiveStandEnv` call in the configs' test dirs is
 * declared here with at least the names it passes, so this list cannot rot.
 *
 * `configRequires` is the same, one level up: a config that THROWS at load without
 * its env (`playwright.events-live.config.ts`) is not launched at all.
 *
 * Paths are relative to the app directory; `rootDir` is the config's top-level
 * `testDir` (Playwright's `rootDir`, the base `--test-list-invert` lines resolve
 * against).
 */

const URL_DOCTOR = "E2E_DOCTOR_URL";
const URL_ACADEMY = "E2E_PORTAL_URL";
const ACCOUNT = ["E2E_DOCTOR_EMAIL", "E2E_DOCTOR_PASSWORD"];
const ACCOUNT_2 = ["E2E_DOCTOR2_EMAIL", "E2E_DOCTOR2_PASSWORD"];
const IDP_MAIL = ["IDP_ISSUER", "MAILPIT_URL"];

export const LIVE_TIERS = Object.freeze([
  {
    name: "live/academy/default",
    host: "academy",
    app: "apps/portal",
    pkg: "@ds/portal",
    config: "playwright.config.ts",
    rootDir: ".",
    // The `bdd` project's specs are generated; the `test:e2e` script runs this first.
    prepare: ["exec", "bddgen"],
    gated: [
      {
        file: "e2e/room.spec.ts",
        requires: [
          URL_ACADEMY,
          ...ACCOUNT,
          "E2E_ROOM_SLUG_YOUTUBE",
          "E2E_ROOM_SLUG_RUTUBE",
          "E2E_ROOM_SLUG_UNAVAILABLE",
          "E2E_ROOM_SLUG_LIVE",
          "E2E_ROOM_HEARTBEAT_SECONDS",
        ],
      },
      {
        file: "e2e/room-access-branches.spec.ts",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
          "E2E_ROOM_SLUG_LIVE",
          "E2E_WEBINAR_SLUG_NOT_LIVE",
        ],
      },
      {
        file: "e2e/room-chat.spec.ts",
        requires: [URL_ACADEMY, ...ACCOUNT, ...ACCOUNT_2, "E2E_ROOM_CHAT_SLUG"],
      },
      {
        file: "e2e/room-close.spec.ts",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
          "E2E_ROOM_SLUG_LIVE",
          "E2E_ROOM_SLUG_ENDED",
        ],
      },
      {
        file: "e2e/room-display-name.spec.ts",
        requires: [URL_ACADEMY, ...IDP_MAIL, "E2E_ROOM_SLUG_LIVE"],
      },
      {
        file: "e2e/room-player-false-positive.spec.ts",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
          "E2E_ROOM_SLUG_VK",
          "E2E_ROOM_SLUG_CDNVIDEO",
        ],
      },
      {
        file: "e2e/room-presence-count.spec.ts",
        requires: [
          URL_ACADEMY,
          ...ACCOUNT,
          ...ACCOUNT_2,
          "E2E_ROOM_CHAT_SLUG",
          "E2E_ROOM_HEARTBEAT_SECONDS",
        ],
      },
    ],
  },
  {
    name: "live/doctor/register-live",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.register-live.config.ts",
    rootDir: "e2e",
    gated: [
      {
        file: "e2e/register-existing.spec.ts",
        requires: [URL_DOCTOR, "MAILPIT_URL"],
      },
      {
        file: "e2e/signed-in-landing-live.spec.ts",
        requires: [
          URL_DOCTOR,
          ...IDP_MAIL,
          "IDP_SERVICE_TOKEN",
          "IDP_PROJECT_ID",
          "E2E_LANDING_EVENT_SLUG",
        ],
      },
    ],
  },
  {
    name: "live/doctor/congress",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.congress.config.ts",
    rootDir: "e2e",
    gated: [
      {
        file: "e2e/congress-submissions.spec.ts",
        requires: [URL_DOCTOR, ...IDP_MAIL, "DATABASE_URL"],
      },
      {
        file: "e2e/a11y/congress-axe.e2e.spec.ts",
        requires: [URL_DOCTOR, ...IDP_MAIL, "DATABASE_URL"],
      },
      {
        file: "e2e/login-handoff-live.spec.ts",
        requires: [URL_DOCTOR, ...IDP_MAIL],
      },
    ],
  },
  {
    name: "live/doctor/event-page",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.event-page.config.ts",
    rootDir: "e2e",
    // Both specs `test.skip` with a reason when their slug / api URL is absent.
    gated: [],
  },
  {
    name: "live/doctor/event-register",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.event-register.config.ts",
    rootDir: "e2e",
    gated: [
      {
        file: "e2e/event-register-one-tap.spec.ts",
        requires: [
          URL_DOCTOR,
          ...ACCOUNT,
          "E2E_EVENT_SLUG_ONE_TAP",
          "E2E_EVENT_SLUG_RETURN",
          ...IDP_MAIL,
        ],
      },
      { file: "e2e/my-events.spec.ts", requires: [URL_DOCTOR, ...ACCOUNT] },
      {
        file: "e2e/a11y/account-axe.e2e.spec.ts",
        requires: [URL_DOCTOR, ...ACCOUNT],
      },
      {
        file: "e2e/account-mobile.spec.ts",
        requires: [URL_DOCTOR, ...ACCOUNT],
      },
    ],
  },
  {
    name: "live/doctor/events-live",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.events-live.config.ts",
    rootDir: "e2e",
    // The config throws at load without these (its `required` list).
    configRequires: [
      URL_DOCTOR,
      "E2E_EVENTS_LOADED_PATH",
      "E2E_EVENTS_EMPTY_PATH",
      "E2E_EVENTS_EXPECT_LIVE",
    ],
    gated: [],
  },
  {
    name: "live/doctor/room",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.room.config.ts",
    rootDir: "e2e",
    // The room a11y twin is the `axe/doctor` leg's (gated on #1692), never run twice.
    exclude: ["e2e/a11y/room-axe.e2e.spec.ts"],
    gated: [
      {
        file: "e2e/room.spec.ts",
        requires: [
          URL_DOCTOR,
          ...ACCOUNT,
          "E2E_ROOM_SLUG_YOUTUBE",
          "E2E_ROOM_SLUG_RUTUBE",
          "E2E_ROOM_SLUG_UNAVAILABLE",
          "E2E_ROOM_SLUG_NOT_LIVE",
          "E2E_ROOM_HEARTBEAT_SECONDS",
          ...IDP_MAIL,
        ],
      },
    ],
  },
  {
    name: "live/doctor/shell",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.shell.config.ts",
    rootDir: "e2e",
    gated: [
      { file: "e2e/shell-live.spec.ts", requires: [URL_DOCTOR, ...ACCOUNT] },
    ],
  },
]);

/**
 * Live configs a leg OTHER than a `live/*` one already runs: the two storefront
 * a11y suites are the `axe/*` legs, gated on #1692 (`axeDecision`).
 */
export const AXE_LEG_CONFIGS = Object.freeze({
  "apps/portal/playwright.axe.config.ts": "axe/academy",
});

/** Hermetic configs (own `webServer`): CI's, never a slot leg. */
export const HERMETIC_CONFIGS = Object.freeze([
  "apps/portal/playwright.ci.config.ts",
  "apps/doctor/playwright.ci.config.ts",
  "apps/doctor/playwright.consumption.config.ts",
  "apps/doctor/playwright.events.config.ts",
  "apps/doctor/playwright.return-context.config.ts",
]);
