import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { resolve } from "node:path";

const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/007-event-admin-minimal/007-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["steps/event-authoring-originals.steps.ts"],
  outputDir: ".features-gen/event-authoring-originals",
  tags: "@event-authoring-originals",
  missingSteps: "fail-on-gen",
  examplesTitleFormat:
    "The stream is configured from an explicit provider enum [<provider>]",
});
const directory = process.env.E2E_EVENT_COUNT_DIR;
export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120000,
  expect: { timeout: 20000 },
  outputDir: directory
    ? resolve(directory, "browser-private")
    : "test-results/event-authoring-private",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: directory
          ? resolve(directory, "results.private.json")
          : "test-results/event-authoring-results.private.json",
      },
    ],
  ],
  use: {
    locale: "ru-RU",
    userAgent: "EventCount4061/1.0",
    timezoneId: "America/New_York",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "admin" }],
});
