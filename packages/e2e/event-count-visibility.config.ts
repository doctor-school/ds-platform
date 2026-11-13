import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { resolve } from "node:path";

const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/007-event-admin-minimal/007-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["steps/event-count-visibility.steps.ts"],
  outputDir: ".features-gen/event-count-visibility",
  tags: "@event-count-visibility",
  missingSteps: "fail-on-gen",
});
const directory = process.env.E2E_EVENT_COUNT_DIR;
export default defineConfig({
  testDir,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: directory
    ? resolve(directory, "browser-private")
    : "test-results/event-count-private",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: directory
          ? resolve(directory, "results.private.json")
          : "test-results/event-count-results.private.json",
      },
    ],
  ],
  use: {
    baseURL: process.env.E2E_ADMIN_URL,
    locale: "ru-RU",
    userAgent: "EventCount4035/1.0",
    timezoneId: "America/New_York",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "admin" }],
});
