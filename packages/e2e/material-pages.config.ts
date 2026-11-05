import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { publicLogEnabled, reportersFor } from "./lib/reporters.js";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/048-materials-feed/048-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["material-pages/steps.ts"],
  outputDir: ".features-gen/material-pages",
  tags: "@material-reading-pages",
  missingSteps: "fail-on-gen",
});

export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { locale: "ru-RU", trace: "retain-on-failure" },
  outputDir: resolve(
    process.env.E2E_MATERIAL_ARTIFACT_DIR ??
      resolve(tmpdir(), "material-pages-3702"),
    "browser-artifacts",
  ),
  reporter: reportersFor({
    publicLog: publicLogEnabled(process.env),
    reportDir: process.env.E2E_REPORT_DIR,
  }) as NonNullable<Parameters<typeof defineConfig>[0]["reporter"]>,
});
