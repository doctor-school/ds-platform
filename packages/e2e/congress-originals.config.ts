import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/044-congress-signup/044-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["steps/congress-originals.steps.ts"],
  outputDir: ".features-gen/congress-originals",
  tags: "@congress-window-names",
  missingSteps: "fail-on-gen",
});
export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60000,
  projects: [{ name: "admin" }],
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.E2E_CONGRESS_REPORT }],
  ],
});
