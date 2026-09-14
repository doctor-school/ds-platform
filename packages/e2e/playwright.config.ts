import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { HOSTS } from "./hosts.js";

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
 * fixture reads (`steps/support/fixtures.ts`). §6.1 has the projects select by
 * `@host:academy` / `@host:doctor` / `@host:both`, and the tag expressions below
 * are the exact complement of that: `not @host:doctor` on academy, `not
 * @host:academy` on doctor. A scenario tagged for one host is excluded from the
 * other, `@host:both` runs on both — and a scenario NOT YET TAGGED runs on both
 * rather than on neither. That matters today: the 18 spec feature files predate
 * this contract and carry no `@host:*` tag, and a tag expression that dropped
 * them would leave a suite that silently runs nothing until the §8 backfill
 * (#2068) rewords them.
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

const academyTestDir = testDirFor("academy", "not @host:doctor");
const doctorTestDir = testDirFor("doctor", "not @host:academy");

export default defineConfig({
  // Serial: the scenarios sign in as SHARED golden accounts on a shared slot, so
  // parallel workers would race on one session.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  outputDir: "test-results/artifacts",
  use: {
    locale: "ru-RU",
    trace: "retain-on-failure",
  },
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
  ],
});
