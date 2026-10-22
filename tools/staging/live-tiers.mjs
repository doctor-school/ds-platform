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
  /** `golden.events.hidden` — an `experts` event in the `hidden` state. */
  academyHidden: "golden-event-hidden",
  /** Published online `experts` event with speakers — the 005 one-tap journey's second event. */
  academyUpcomingOneTap: "golden-volume-event-412",
  /** Published online `experts` event with speakers — the 004 EARS-8 marker spec's own event. */
  academyUpcomingMarker: "golden-volume-event-424",
});

const URL_DOCTOR = "E2E_DOCTOR_URL";
const URL_ACADEMY = "E2E_PORTAL_URL";
const ACCOUNT = ["E2E_DOCTOR_EMAIL", "E2E_DOCTOR_PASSWORD"];
const ACCOUNT_2 = ["E2E_DOCTOR2_EMAIL", "E2E_DOCTOR2_PASSWORD"];
const IDP_MAIL = ["IDP_ISSUER", "MAILPIT_URL"];
const CONGRESS_SIGNUP = [
  "CONGRESS_SIGNUP_EVENT_ID",
  "CONGRESS_SIGNUP_CONSENT_VERSION",
  "CONGRESS_SIGNUP_WINDOW_OPENS_AT",
  "CONGRESS_SIGNUP_WINDOW_CLOSES_AT",
  "CONGRESS_SIGNUP_EVENT_DAYS",
];

/**
 * `releaseCheck: { excluded: "<reason>" }` keeps a tier out of the release check
 * (`e2e-stage.mjs --expect-sha`), which prints «live: <tier> not in the release
 * check — <reason>» instead of running it; a plain slot run still runs it. The
 * reason is mandatory (`releaseCheckExclusion` refuses an entry without one).
 *
 * The Academy default leg after the #3229 triage: one product deviation (008
 * EARS-14 — no storefront footer on `/`, `apps/portal/lib/shell-config.ts`
 * deferring to epic #2020), and three specs whose precondition the golden
 * dataset does not hold: a day with 4+ Academy эфиры (month-fidelity «+N ещё»),
 * fewer than 10 upcoming эфиры and the local seed's named past эфиры
 * (webinars-feed-view gate rows 31–32).
 */
const ACADEMY_DEFAULT_RED_3229 =
  "red on slot — #3229: 008 EARS-14 footer absent on / (product, epic #2020); month-fidelity «+N ещё» pill cap waits for a slot golden re-seed carrying the dense Academy day";

export const LIVE_TIERS = Object.freeze([
  {
    name: "live/academy/default",
    host: "academy",
    app: "apps/portal",
    pkg: "@ds/portal",
    releaseCheck: { excluded: ACADEMY_DEFAULT_RED_3229 },
    config: "playwright.config.ts",
    rootDir: ".",
    // The `bdd` project's specs are generated; the `test:e2e` script runs this first.
    prepare: ["exec", "bddgen"],
    // #3229: the 004/005 journeys and the 004 EARS-8 marker spec read their events
    // under journey-only names (a local stand falls back to its `seed-005-*`
    // fixtures). Never an event-page slug name (`E2E_WEBINAR_SLUG*`): #2996 keeps
    // those on the event-page tier, so they cannot switch on this tier's
    // event-page specs. Each journey registers a FRESH doctor, so a slot's golden
    // events are never consumed.
    seededEnv: {
      E2E_JOURNEY_SLUG_UPCOMING: GOLDEN_SLUGS.academyUpcoming,
      E2E_JOURNEY_SLUG_ONE_TAP: GOLDEN_SLUGS.academyUpcomingOneTap,
      E2E_JOURNEY_SLUG_MARKER: GOLDEN_SLUGS.academyUpcomingMarker,
      E2E_JOURNEY_SLUG_ENDED: GOLDEN_SLUGS.academyEndedRecorded,
      E2E_JOURNEY_SLUG_HIDDEN: GOLDEN_SLUGS.academyHidden,
    },
    gated: [
      {
        file: "e2e/room.spec.ts",
        slotReason:
          "the golden dataset seeds only rutube streams — no YouTube, unavailable-provider, VK or CDNvideo room exists on a slot",
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
        // #3229: the 006 provider-enum journeys, split out of room-journey.feature
        // so the rest of that journey runs on a slot. `bddgen` writes the spec.
        file: ".features-gen/e2e/features/room-provider-journey.feature.spec.js",
        slotReason:
          "the golden dataset seeds only rutube streams — no YouTube, unavailable-provider, VK or CDNvideo room exists on a slot",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
          "E2E_ROOM_SLUG_YOUTUBE",
          "E2E_ROOM_SLUG_RUTUBE",
          "E2E_ROOM_SLUG_UNAVAILABLE",
        ],
      },
      {
        // #3229: the 006 EARS-4 heartbeat-cadence journeys, split out the same way.
        file: ".features-gen/e2e/features/room-heartbeat-journey.feature.spec.js",
        slotReason:
          "a slot api runs the production heartbeat cadence (60 s); the spec needs ROOM_HEARTBEAT_INTERVAL_SECONDS ≤ 10",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
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
        slotReason:
          "the golden dataset seeds only rutube streams — no YouTube, unavailable-provider, VK or CDNvideo room exists on a slot",
        requires: [
          URL_ACADEMY,
          ...IDP_MAIL,
          "E2E_ROOM_SLUG_VK",
          "E2E_ROOM_SLUG_CDNVIDEO",
        ],
      },
      {
        file: "e2e/room-presence-count.spec.ts",
        slotReason:
          "a slot api runs the production heartbeat cadence (60 s); the spec needs ROOM_HEARTBEAT_INTERVAL_SECONDS ≤ 10",
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
        slotReason:
          "permanently out of the release check: the spec narrows an account's project grant through the IdP management API, whose service token is kept out of a public repo's Actions env, and a box verb holding that token box-side cannot serve it either — the Actions release check reaches the box over https only, with no ssh",
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
        slotReason:
          "the spec writes its congress fixture rows straight into the database, which on a slot is reachable only inside the box's docker network",
        requires: [URL_DOCTOR, ...IDP_MAIL, "DATABASE_URL"],
      },
      {
        file: "e2e/a11y/congress-axe.e2e.spec.ts",
        slotReason:
          "the spec writes its congress fixture rows straight into the database, which on a slot is reachable only inside the box's docker network",
        requires: [URL_DOCTOR, ...IDP_MAIL, "DATABASE_URL"],
      },
      {
        // Its congress sign-up checks the api's `CONGRESS_SIGNUP_*` block first
        // (`congressSignUpEnvProblem`).
        file: "e2e/login-handoff-live.spec.ts",
        slotReason:
          "its congress sign-up needs the api's CONGRESS_SIGNUP_* block, which lives only in the box's stage env — the release check in Actions reads no box env, and congress intake is closed",
        requires: [URL_DOCTOR, ...IDP_MAIL, ...CONGRESS_SIGNUP],
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
        slotReason:
          "registration is append-only (005 has no cancel), so each run consumes two эфиры the account is not registered for; a slot's golden doctor is registered after the first run",
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
        slotReason:
          "the golden dataset seeds only rutube streams — no YouTube, unavailable-provider, VK or CDNvideo room exists on a slot; a slot api runs the production heartbeat cadence (60 s); the spec needs ROOM_HEARTBEAT_INTERVAL_SECONDS ≤ 10",
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

/**
 * The golden event slugs a live spec targets on a slot (#3191). Every slot is
 * cloned from `ds_golden`, so these exist on each one; `e2e-stage.test.mjs` holds
 * them against `packages/db/src/seed/golden/ids.ts` so a renamed seed fails
 * `pnpm test:tools` instead of a slot run.
 */
export const GOLDEN_EVENT_SLUGS = Object.freeze({
  /** Published, upcoming, `experts` audience — the Academy's not-live эфир. */
  upcoming: GOLDEN_SLUGS.academyUpcoming,
  /** Live, `doctors` audience — the doctor storefront's only live эфир. */
  live: "golden-event-live",
  /** Live, `experts` audience — the Academy's room. */
  academyLive: "golden-event-live-academy",
  /** Ended, with a published recording. */
  pastWithRecording: GOLDEN_SLUGS.academyEndedRecorded,
});

/**
 * The live-leg env a slot derives from the golden dataset, per storefront host;
 * a tier's own `seededEnv` (#2996) wins over it for that tier's leg.
 * Only values a spec can READ without consuming them: a spec that would consume
 * a seeded state (one-tap registration) or needs a seed the golden dataset does
 * not hold is declared with `slotReason` in its gated entry instead.
 */
export const GOLDEN_LIVE_ENV = Object.freeze({
  academy: Object.freeze({
    E2E_WEBINAR_SLUG_NOT_LIVE: GOLDEN_EVENT_SLUGS.upcoming,
    E2E_WEBINAR_SLUG_LIVE: GOLDEN_EVENT_SLUGS.academyLive,
    E2E_ROOM_SLUG_LIVE: GOLDEN_EVENT_SLUGS.academyLive,
    E2E_ROOM_CHAT_SLUG: GOLDEN_EVENT_SLUGS.academyLive,
    E2E_ROOM_SLUG_ENDED: GOLDEN_EVENT_SLUGS.pastWithRecording,
  }),
  doctor: Object.freeze({
    E2E_WEBINAR_SLUG: GOLDEN_EVENT_SLUGS.live,
    E2E_LANDING_EVENT_SLUG: GOLDEN_EVENT_SLUGS.live,
    E2E_EVENTS_LOADED_PATH: "/events",
    // A window years past the golden horizon: the feed answers with no card.
    E2E_EVENTS_EMPTY_PATH: "/events?from=2035-01-01&to=2035-01-15",
    // `golden-event-live` is the doctor storefront's live эфир on every slot.
    E2E_EVENTS_EXPECT_LIVE: "present",
  }),
});
