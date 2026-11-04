import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { publicLogEnabled, reportersFor } from "./lib/reporters.js";

const testDir = defineBddConfig({
  features: [
    "../../apps/docs/content/specs/features/001-api-bootstrap-health/001-scenarios.feature",
    "../../apps/docs/content/specs/features/002-api-postgres-readiness/002-scenarios.feature",
  ],
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["api-probes/steps.ts"],
  outputDir: ".features-gen/api-probes",
  tags: "@host:academy",
  missingSteps: "skip-scenario",
});

export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  ...(process.env.E2E_GREP ? { grep: new RegExp(process.env.E2E_GREP) } : {}),
  reporter: reportersFor({
    publicLog: publicLogEnabled(process.env),
    reportDir: process.env.E2E_REPORT_DIR,
  }) as NonNullable<Parameters<typeof defineConfig>[0]["reporter"]>,
});
