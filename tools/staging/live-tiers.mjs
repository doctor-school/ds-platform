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
 * `seededEnv` is what a slot CAN give beyond its URLs: the golden slugs carrying
 * the event shapes a tier's specs read ({@link GOLDEN_SLUGS}). `e2e:stage` hands
 * them to that tier's leg only, and an operator-exported value of the same name
 * wins. A tier whose specs share a variable with unrelated specs gets its own
 * config, so a seeded slug never switches on a spec nobody pointed at it.
 *
 * `configRequires` is the same, one level up: a config that THROWS at load without
 * its env (`playwright.events-live.config.ts`) is not launched at all.
 *
 * Paths are relative to the app directory; `rootDir` is the config's top-level
 * `testDir` (Playwright's `rootDir`, the base `--test-list-invert` lines resolve
 * against).
 */

/**
 * #2996 — the golden events (`seed:golden`, the ONLY seed a slot runs) carrying
 * each shape the event-page specs assert, handed to a tier as `seededEnv`.
 * Mirrored from `packages/db/src/seed/golden/` like `idp.mjs` mirrors its
 * accounts: `apps/api/test/scripts/stage-event-page-slugs.spec.ts` builds the
 * golden dataset and fails when a slug here stops carrying its shape. Named
 * fixtures where one has the shape; otherwise a volume event picked because it
 * keeps that shape at ANY seed instant (a slot seeds at its own `now`, and an
 * event starting near it flips to ended) — the spec checks several instants.
 */
export const GOLDEN_SLUGS = Object.freeze({
  /** `golden.events.upcoming` — published, online, `experts`, one speaker. */
  academyUpcoming: "golden-event-upcoming",
  /** `golden.events.pastWithRecording` — ended, one published montage, one speaker. */
  academyEndedRecorded: "golden-event-past-recorded",
  /** Ended, nothing published, `recording_expected_by` set, speakers. */
  academyPreparingDated: "golden-volume-event-148",
  /** Published offline `experts` event with seats left. */
  academyOffline: "golden-volume-event-425",
  /** Published offline `experts` event with `seats_left = 0`. */
  academyOfflineSoldOut: "golden-volume-event-485",
  /** Published hybrid `experts` event with seats left. */
  academyHybrid: "golden-volume-event-420",
  /** Published hybrid `experts` event with `seats_left = 0`. */
  academyHybridSoldOut: "golden-volume-event-540",
  /** Published online `doctors` event with speakers (the doctor storefront reads only `doctors`). */
  doctorUpcoming: "golden-volume-event-418",
});

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
      {
        // #3151: the shared `@ds/e2e/account-auth-paths` body. Its reset request
        // is captcha-gated, so a slot needs the bot-protection test token.
        file: "e2e/account-auth-paths-live.spec.ts",
        requires: [URL_DOCTOR, "MAILPIT_URL", "E2E_CAPTCHA_TEST_TOKEN"],
      },
    ],
  },
  {
    name: "live/academy/account-live",
    host: "academy",
    app: "apps/portal",
    pkg: "@ds/portal",
    config: "playwright.account-live.config.ts",
    rootDir: "e2e",
    gated: [
      {
        // #3151: the same shared body the doctor register-live tier runs.
        file: "e2e/account-auth-paths-live.spec.ts",
        requires: [URL_ACADEMY, "MAILPIT_URL", "E2E_CAPTCHA_TEST_TOKEN"],
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
    // #2996: a `published` online doctors-audience event with speakers.
    seededEnv: { E2E_WEBINAR_SLUG: GOLDEN_SLUGS.doctorUpcoming },
  },
  {
    // #2996: the Academy event-page specs (020 EARS-1/8/9/19, 014 EARS-4/7/21),
    // their own config so the golden slugs below reach exactly these two specs
    // and not every default-tier spec that also reads `E2E_WEBINAR_SLUG`.
    name: "live/academy/event-page",
    host: "academy",
    app: "apps/portal",
    pkg: "@ds/portal",
    config: "playwright.event-page.config.ts",
    rootDir: "e2e",
    gated: [],
    seededEnv: {
      E2E_WEBINAR_SLUG: GOLDEN_SLUGS.academyUpcoming,
      E2E_WEBINAR_SLUG_ENDED: GOLDEN_SLUGS.academyEndedRecorded,
      E2E_ENDED_WEBINAR_SLUG: GOLDEN_SLUGS.academyEndedRecorded,
      E2E_PREPARING_WEBINAR_SLUG: GOLDEN_SLUGS.academyPreparingDated,
      E2E_HYBRID_SLUG: GOLDEN_SLUGS.academyHybrid,
      E2E_HYBRID_SOLDOUT_SLUG: GOLDEN_SLUGS.academyHybridSoldOut,
      E2E_OFFLINE_SOLDOUT_SLUG: GOLDEN_SLUGS.academyOfflineSoldOut,
      E2E_SWEEP_SLUGS: [
        GOLDEN_SLUGS.academyUpcoming,
        GOLDEN_SLUGS.academyEndedRecorded,
        GOLDEN_SLUGS.academyOffline,
        GOLDEN_SLUGS.academyOfflineSoldOut,
        GOLDEN_SLUGS.academyHybrid,
        GOLDEN_SLUGS.academyHybridSoldOut,
      ].join(","),
    },
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
