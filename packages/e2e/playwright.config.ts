import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { HOSTS } from "./hosts.js";
import { tagExpressionFor } from "./lib/host-tags.js";

/**
 * The C6 REGRESSION SUITE — staging/regression-contour tech spec §6 (Issue #2067).
 *
 * §6.1: «the spec's feature file is the suite». The features are the spec
 * triplet's own `NNN-scenarios.feature` files under
 * `apps/docs/content/specs/features/`, not a parallel copy in a test folder, so a
 * scenario cannot exist without the requirement it verifies and `author-ears-spec`
 * step 7 already produces one for every new feature.
 *
 * ── Host selection ───────────────────────────────────────────────────────────
 * One project per storefront, named by its host id, which is what the `host`
 * fixture reads (`steps/support/fixtures.ts`). Every spec feature file declares
 * ONE Feature-level `@host:academy | @host:doctor | @host:both | @host:admin`
 * tag, and each project selects POSITIVELY: its own tag OR `@host:both`
 * (`lib/host-tags.ts` builds the expression). `@host:admin` is selected by no
 * storefront project — admin journeys belong to the admin suite in `apps/admin`,
 * and running them here would only report false reds.
 * Positive selection means an UNTAGGED feature runs on neither storefront, so
 * the `bddgen` script runs `bin/check-host-tags.ts` first: an untagged file
 * fails generation and names itself, rather than silently vanishing from both
 * suites.
 *
 * ── Missing steps ────────────────────────────────────────────────────────────
 * `missingSteps: "skip-scenario"`. The three alternatives playwright-bdd 9.2
 * offers are the wrong trade here: `fail-on-gen` makes `bddgen` exit non-zero for
 * every scenario whose step text is still the pre-contract prose of the §8
 * backfill, which would put the generation step permanently red and teach the
 * team to skip it; `fail-on-run` reports the same scenarios as FAILURES, which
 * makes a red suite the normal state and destroys the signal of a real
 * regression. `skip-scenario` keeps generation green AND lists every
 * unimplemented scenario in the run output as skipped — visible and countable,
 * never silently dropped, which is precisely how the §6.4 coverage lint can tell
 * «not yet written» from «gone».
 *
 * ── Retries ──────────────────────────────────────────────────────────────────
 * `retries: 0` (§6.5): a retry turns a flake into a pass and a real regression
 * into a slow pass. A scenario that needs a retry to go green is a defect in the
 * scenario or in the product, and this suite reports it as one.
 *
 * Run against a raised slot:
 *   E2E_PORTAL_URL=https://pr-123.stage.doctor.school \
 *   E2E_DOCTOR_URL=https://d-pr-123.stage.doctor.school \
 *   DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED=… pnpm --filter @ds/e2e test:e2e
 * No `webServer`: the slot's topology belongs to `tools/staging`, never to a
 * test config.
 */
/**
 * ── Where the reports land ───────────────────────────────────────────────────
 * `pnpm e2e:stage <slot>` (tools/staging/e2e-stage.mjs) exports `E2E_REPORT_DIR`
 * pointing at one per-run directory under `packages/e2e/playwright-report/`, so a
 * regression run over a slot keeps its HTML + JSON side by side and a second run
 * cannot overwrite the evidence the operator is about to paste. Unset — a bare
 * `pnpm --filter @ds/e2e test:e2e` — keeps the plain `test-results/` default.
 *
 * ── The scenario filter ──────────────────────────────────────────────────────
 * `E2E_GREP` rather than `playwright test --grep <re>`: `e2e-stage.mjs` runs `pnpm`
 * through a shell (the `.cmd` shims on the Windows operator box), and a perfectly
 * ordinary alternation — `"вход|выход"` — would be parsed as a pipeline on the way.
 * An env var is not parsed by anything.
 *
 * ── Basic auth ───────────────────────────────────────────────────────────────
 * Every staging hostname sits behind ONE basic-auth pair (`tools/staging/README.md`).
 * The pair arrives as `E2E_HTTP_USER` / `E2E_HTTP_PASS` and becomes Playwright
 * `httpCredentials` — never a hand-built `authorization` header in a step, which
 * would have to be re-added on every new request the journey makes.
 */
const reportDir = process.env.E2E_REPORT_DIR;
const jsonReport = reportDir
  ? path.join(reportDir, "results.json")
  : "test-results/results.json";
const grep = process.env.E2E_GREP
  ? new RegExp(process.env.E2E_GREP)
  : undefined;
const httpCredentials =
  process.env.E2E_HTTP_USER && process.env.E2E_HTTP_PASS
    ? {
        username: process.env.E2E_HTTP_USER,
        password: process.env.E2E_HTTP_PASS,
      }
    : undefined;

const FEATURES = "../../apps/docs/content/specs/features/*/*-scenarios.feature";
const STEPS = ["steps/**/*.ts"];

/** One generated test dir per host — the tag filter differs, so the output must. */
const testDirFor = (hostId: keyof typeof HOSTS, tags: string) =>
  defineBddConfig({
    features: FEATURES,
    // `featuresRoot` anchors the generated paths at the spec tree, so a generated
    // file's path names the feature it came from.
    featuresRoot: "../../apps/docs/content/specs/features",
    steps: STEPS,
    outputDir: `.features-gen/${hostId}`,
    tags,
    missingSteps: "skip-scenario",
  });

const academyTestDir = testDirFor("academy", tagExpressionFor("academy"));
const doctorTestDir = testDirFor("doctor", tagExpressionFor("doctor"));

export default defineConfig({
  // Serial: the scenarios sign in as SHARED golden accounts on a shared slot, so
  // parallel workers would race on one session.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  ...(grep ? { grep } : {}),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: jsonReport }],
    ...(reportDir
      ? [
          [
            "html",
            { outputFolder: path.join(reportDir, "html"), open: "never" },
          ],
        ]
      : []),
  ] as NonNullable<Parameters<typeof defineConfig>[0]["reporter"]>,
  outputDir: "test-results/artifacts",
  use: {
    locale: "ru-RU",
    trace: "retain-on-failure",
    httpCredentials,
  },
  // The project NAMES below are hand-kept in a second place: `PROJECTS` /
  // `HOST_PROJECTS` in `tools/staging/e2e-stage.mjs`, which validates `--project`
  // before ever launching Playwright. Rename one here and you must rename it
  // there, or the selection fails at run time instead of at selection time.
  projects: [
    {
      name: "academy",
      testDir: academyTestDir,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env[HOSTS.academy.baseUrlEnv],
      },
    },
    {
      name: "doctor",
      testDir: doctorTestDir,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env[HOSTS.doctor.baseUrlEnv],
      },
    },
    // ── The two derived walks (§6.3) ──────────────────────────────────────────
    // One project, not one per host. The Gherkin projects above exist per host
    // because `bddgen` writes a different generated DIRECTORY per host tag
    // filter; the walks have no such artifact — they read the host from `HOSTS`
    // and address it absolutely via `baseUrlFor`, so a single project drives both
    // and every test title names the host it walked. `testMatch` keeps the
    // directory open for the walks' own support files without turning them into
    // tests.
    {
      name: "walks",
      testDir: "./derived",
      testMatch: /.*\.walk\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
