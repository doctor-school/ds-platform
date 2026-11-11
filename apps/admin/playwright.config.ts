import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

/**
 * 007 admin browser-E2E config (#595) — the required `user-facing` deliverable
 * (requirements Verification `all` row), translated from `007-scenarios.feature`
 * to the Refine admin surface via playwright-bdd. Like the portal e2e config
 * (#131), this is the dev-stand-gated tier: it drives a real browser against a
 * RUNNING admin app that proxies `/v1/*` to a running api + Postgres + Zitadel +
 * MinIO. The legacy `chromium` project is a manual gate; the spec-owned 012
 * `taxonomy` journey also runs in the Admin CI job. Neither is in the default
 * turbo `test` pipeline; the session bootstrap `throw`s if the stand env (`IDP_*`) is absent,
 * so a stray invocation fails fast rather than pretending to pass.
 *
 * Run it against a provisioned dev-stand with, e.g.:
 *   E2E_ADMIN_URL=http://localhost:3200 ACADEMY_PUBLIC_ORIGIN=http://localhost:3001 \
 *   IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:e2e
 * The admin app must be booted with `API_PROXY_TARGET` pointing at an api whose
 * bot-protection is off (`BOT_PROTECTION_ENABLED=false`, and no Unleash override
 * — the live flag wins over the env default) so the 003 register/login
 * provisioning is not captcha-gated.
 *
 * The api must ALSO be booted with the #1076 ops-window ceilings raised
 * (`RATE_LIMIT_PER_IP_15MIN=…`, `RATE_LIMIT_PER_USER_15MIN=…`). The 011 MFA
 * journey costs several auth calls per scenario from one loopback address, and
 * its lockout scenario deliberately spends the whole 10-failure budget: at
 * production ceilings the per-user rate window closes FIRST, so the refusal the
 * scenario proves is the throttle rather than the soft-lock (nothing is admitted
 * either way, but only the raised ceilings make it the LOCK that is proven). The
 * ceilings themselves are proven by `abuse-limits.e2e` + `mfa-challenge.e2e`, not
 * here.
 *
 * `timezoneId` is pinned to a NON-Moscow zone for EVERY scenario, so the МСК
 * rendering assertions (EARS-10) prove no operator-local drift globally, not just
 * in one tagged scenario.
 */
const testDir = defineBddConfig({
  features: "e2e/features/*.feature",
  // The custom `test` instance (base.extend for the AdminWorld) lives in the
  // fixtures file, so it must be in the steps set for bddgen to bind it.
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen/legacy",
});

const taxonomyTestDir = defineBddConfig({
  features:
    "../docs/content/specs/features/012-content-taxonomy/012-scenarios.feature",
  featuresRoot: "../docs/content/specs/features",
  steps: ["e2e/steps/*.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen/taxonomy",
  tags: "@host:admin",
  // Only the unbound 012 prose is skipped; existing 007/011 generation stays strict.
  missingSteps: "skip-scenario",
});

const auditTestDir = defineBddConfig({
  features:
    "../docs/content/specs/features/010-universal-edit-audit/010-scenarios.feature",
  featuresRoot: "../docs/content/specs/features",
  steps: ["e2e/steps/edit-audit-contracts.steps.ts"],
  outputDir: ".features-gen/audit",
  tags: "@host:admin",
  missingSteps: "skip-scenario",
});

// 048 keeps its Academy host semantics; the selected source originals exercise
// the Admin writer and therefore have an explicit, strict Admin contour.
const materialsTestDir = defineBddConfig({
  features:
    "../docs/content/specs/features/048-materials-feed/048-scenarios.feature",
  featuresRoot: "../docs/content/specs/features",
  steps: ["e2e/steps/material-authoring.steps.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen/materials",
  tags: "@material-admin-authoring",
});

const registryContractsTestDir = defineBddConfig({
  features: [
    "../docs/content/specs/features/030-projects-catalog-and-page/030-scenarios.feature",
    "../docs/content/specs/features/032-investors-leaderboard/032-scenarios.feature",
  ],
  featuresRoot: "../docs/content/specs/features",
  steps: ["e2e/registry-contracts/steps.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen/registry-contracts",
  tags: "(@feature:030 and @EARS-3) or (@feature:032 and (@EARS-1 or @EARS-5))",
});

const recordingAttachmentTestDir = defineBddConfig({
  features:
    "../docs/content/specs/features/014-event-recordings/014-scenarios.feature",
  featuresRoot: "../docs/content/specs/features",
  steps: ["e2e/recording-attachment/steps.ts", "e2e/support/fixtures.ts"],
  outputDir: ".features-gen/recording-attachment",
  tags: "(@EARS-1 and @core) or @recording-publication-audit or @recording-legacy-transitions or @recording-command-boundaries or @recording-backfill-originals",
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_ADMIN_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
    locale: "ru-RU",
    // A deliberately non-МСК timezone: the МСК labels must not drift here (EARS-10).
    timezoneId: "America/New_York",
  },
  projects: [
    {
      name: "recording-attachment",
      testDir: recordingAttachmentTestDir,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "registry-contracts",
      testDir: registryContractsTestDir,
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "taxonomy",
      testDir: taxonomyTestDir,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "audit",
      testDir: auditTestDir,
      grep: /Deleting a row captures the full old row in the diff|An update that changes nothing leaves no trail row|A trail row cannot be rewritten or removed|A direct SQL write with no audit context still leaves an honest trail row|A new table cannot silently opt out of auditing/,
    },
    {
      name: "materials",
      testDir: materialsTestDir,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
