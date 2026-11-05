import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import {
  feedEntryLog,
  feedEntryRoot,
  ownedFeedEntryDatabase,
} from "./lib/feed-entry.js";
import { publicLogEnabled, reportersFor } from "./lib/reporters.js";

const testDir = defineBddConfig({
  features:
    "../../apps/docs/content/specs/features/017-doctor-shell-specialties/017-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["steps/**/*.ts"],
  outputDir: ".features-gen/feed-entry",
  tags: "@host:doctor and @public-feed-entry",
  missingSteps: "fail-on-gen",
});
const api = process.env.E2E_API_URL;
const doctor = process.env.E2E_DOCTOR_URL;
const boot = process.env.E2E_FEED_ENTRY_BOOT === "1";
const database = boot
  ? ownedFeedEntryDatabase(process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "")
  : undefined;
if (boot && (!api || !doctor))
  throw new Error(
    "Owned feed-entry boot requires E2E_API_URL and E2E_DOCTOR_URL",
  );
if (boot && process.env.REDIS_URL)
  throw new Error(
    "Feed-entry proof uses the API's isolated in-memory stores; unset REDIS_URL",
  );
if (boot)
  feedEntryLog({
    command:
      "Playwright owns compiled API and Doctor webServers; reuseExistingServer=false",
    root: feedEntryRoot,
    api,
    doctor,
  });
const next = createRequire(
  resolve(feedEntryRoot, "apps/doctor/package.json"),
).resolve("next/dist/bin/next");

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: reportersFor({
    publicLog: publicLogEnabled(process.env),
    reportDir: process.env.E2E_REPORT_DIR,
  }) as NonNullable<Parameters<typeof defineConfig>[0]["reporter"]>,
  outputDir: resolve(
    process.env.E2E_FEED_ENTRY_ARTIFACT_DIR ?? "test-results",
    "browser-artifacts",
  ),
  projects: [
    {
      name: "doctor",
      testDir,
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        baseURL: doctor,
        trace: "retain-on-failure",
      },
    },
  ],
  ...(boot
    ? {
        webServer: [
          {
            command: "node dist/main.js",
            cwd: resolve(feedEntryRoot, "apps/api"),
            url: `${api}/v1/health`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              NODE_ENV: "development",
              SENTRY_ENVIRONMENT: "test",
              DATABASE_URL:
                database! +
                (database!.includes("?") ? "&" : "?") +
                "application_name=feed-entry-3751-api",
              PORT: new URL(api!).port,
              RECONCILE_SWEEP_INTERVAL_MS: "0",
              AUDIT_IDENTIFIER_PEPPER: randomUUID(),
              LIFECYCLE_IMPACT_TOKEN_SECRET: randomUUID(),
              BOT_PROTECTION_ENABLED: "false",
            },
          },
          {
            command: `node "${next}" start --hostname 127.0.0.1 --port ${new URL(doctor!).port}`,
            cwd: resolve(feedEntryRoot, "apps/doctor"),
              url: doctor!,
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              NODE_ENV: "production",
              API_PROXY_TARGET: api!,
              DOCTOR_PUBLIC_ORIGIN: doctor!,
              ACADEMY_PUBLIC_ORIGIN: doctor!,
            },
          },
        ],
      }
    : {}),
});
