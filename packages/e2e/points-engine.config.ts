import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/025-attention-points-engine/025-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: [
    "steps/points-engine-originals.steps.ts",
    "steps/points-record-boundaries.steps.ts",
    "steps/points-reserve-boundaries.steps.ts",
    "steps/points-advance-boundaries.steps.ts",
    "steps/points-referral-boundaries.steps.ts",
    "steps/points-rulebook-boundaries.steps.ts",
    "steps/points-lifecycle-boundaries.steps.ts",
  ],
  outputDir: ".features-gen/points-engine",
  tags: "@points-engine-originals or @points-record-boundaries or @points-reserve-boundaries or @points-advance-boundaries or @points-referral-boundaries or @points-rulebook-boundaries or @points-lifecycle-boundaries",
  missingSteps: "fail-on-gen",
});

export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  projects: [{ name: "admin" }],
  reporter: [["list"], ["json", { outputFile: process.env.E2E_POINTS_REPORT }]],
});
