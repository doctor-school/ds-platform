import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import {
  feedEntryLog,
  feedEntryRoot,
  feedEntryTask,
  ownedFeedEntryDatabase,
} from "./lib/feed-entry.js";
import { publicLogEnabled, reportersFor } from "./lib/reporters.js";
import {
  publicFeedStatePattern,
  publicReadonlyPatternFor,
  publicRecordFormPattern,
  publicSpecialtyMemoryPattern,
} from "./lib/host-tags.js";

const states = process.env.E2E_PUBLIC_FEED_STATES === "1";
const readonly = process.env.E2E_PUBLIC_READONLY === "1";
const memory = process.env.E2E_PUBLIC_SPECIALTY_MEMORY === "1";
const records = process.env.E2E_PUBLIC_RECORD_FORMS === "1";
const task = feedEntryTask();

const testDir = defineBddConfig({
  features: states
    ? "../../apps/docs/content/specs/features/018-specialty-feed/018-scenarios.feature"
    : "../../apps/docs/content/specs/features/017-doctor-shell-specialties/017-scenarios.feature",
  featuresRoot: "../../apps/docs/content/specs/features",
  steps: ["steps/**/*.ts"],
  outputDir: records
    ? ".features-gen/record-forms"
    : memory
      ? ".features-gen/specialty-memory"
      : states
        ? ".features-gen/feed-states"
        : ".features-gen/feed-entry",
  tags:
    states || memory || records
      ? "@host:doctor"
      : "@host:doctor and @public-feed-entry",
  missingSteps: states || memory || records ? "skip-scenario" : "fail-on-gen",
});
const api = process.env.E2E_API_URL;
const doctor = process.env.E2E_DOCTOR_URL;
const academy = process.env.E2E_PORTAL_URL;
const admin = process.env.E2E_ADMIN_URL;
const boot = process.env.E2E_FEED_ENTRY_BOOT === "1";
const database = boot
  ? ownedFeedEntryDatabase(process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "", task)
  : undefined;
if (boot && (!api || !doctor))
  throw new Error(
    "Owned feed-entry boot requires E2E_API_URL and E2E_DOCTOR_URL",
  );
if (boot && readonly && (!academy || !admin))
  throw new Error("Read-only originals require owned Academy and Admin URLs");
if (boot && (memory || records) && !admin)
  throw new Error(
    "Specialty memory and record originals require an owned Admin URL",
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
const readonlyTestDir = (host: "doctor" | "academy") =>
  defineBddConfig({
    features: [
      "../../apps/docs/content/specs/features/004-event-page-listing/004-scenarios.feature",
      "../../apps/docs/content/specs/features/017-doctor-shell-specialties/017-scenarios.feature",
      "../../apps/docs/content/specs/features/018-specialty-feed/018-scenarios.feature",
    ],
    featuresRoot: "../../apps/docs/content/specs/features",
    steps: ["steps/**/*.ts"],
    outputDir: `.features-gen/readonly-${host}`,
    tags: `@host:${host}`,
    missingSteps: "skip-scenario",
  });

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...(states ? { grep: publicFeedStatePattern } : {}),
  ...(memory ? { grep: publicSpecialtyMemoryPattern } : {}),
  ...(records ? { grep: publicRecordFormPattern } : {}),
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
      testDir: readonly ? readonlyTestDir("doctor") : testDir,
      ...(readonly ? { grep: publicReadonlyPatternFor("doctor") } : {}),
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        baseURL: doctor,
        trace: "retain-on-failure",
      },
    },
    ...(readonly
      ? [
          {
            name: "academy",
            testDir: readonlyTestDir("academy"),
            grep: publicReadonlyPatternFor("academy"),
            use: {
              ...devices["Desktop Chrome"],
              locale: "ru-RU",
              baseURL: academy,
              timezoneId: "Europe/London",
              trace: "retain-on-failure" as const,
            },
          },
        ]
      : []),
  ],
  ...(boot
    ? {
        webServer: [
          {
            command: `node "${resolve(feedEntryRoot, "apps/api/dist/main.js")}"`,
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
                `application_name=feed-entry-${task}-api`,
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
              ACADEMY_PUBLIC_ORIGIN: readonly ? academy! : doctor!,
            },
          },
          ...(readonly || memory || records
            ? (readonly
                ? (["portal", "admin"] as const)
                : (["admin"] as const)
              ).map((app) => {
                const url = app === "portal" ? academy! : admin!;
                const appNext = createRequire(
                  resolve(feedEntryRoot, `apps/${app}/package.json`),
                ).resolve("next/dist/bin/next");
                return {
                  command: `node "${appNext}" start --hostname 127.0.0.1 --port ${new URL(url).port}`,
                  cwd: resolve(feedEntryRoot, `apps/${app}`),
                  url,
                  reuseExistingServer: false,
                  timeout: 60_000,
                  env: {
                    NODE_ENV: "production",
                    API_PROXY_TARGET: api!,
                    ACADEMY_PUBLIC_ORIGIN: academy!,
                    DOCTOR_PUBLIC_ORIGIN: doctor!,
                  },
                };
              })
            : []),
        ],
      }
    : {}),
});
