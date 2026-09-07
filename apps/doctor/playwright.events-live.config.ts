import { defineConfig, devices } from "@playwright/test";

// This explicit config never silently falls back to the CI upstream double.
// See events-mobile.spec.ts ENV SET and run both real lifecycle phases.
const required = [
  "E2E_DOCTOR_URL",
  "E2E_EVENTS_LOADED_PATH",
  "E2E_EVENTS_EMPTY_PATH",
  "E2E_EVENTS_EXPECT_LIVE",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length)
  throw new Error(`019 live matrix: missing env: ${missing.join(", ")}`);
if (!["present", "absent"].includes(process.env.E2E_EVENTS_EXPECT_LIVE!)) {
  throw new Error("E2E_EVENTS_EXPECT_LIVE must be present or absent");
}
for (const name of ["E2E_EVENTS_LOADED_PATH", "E2E_EVENTS_EMPTY_PATH"]) {
  if (!/^\/events(?:\?|$)/.test(process.env[name]!)) {
    throw new Error(`${name} must be a relative /events route`);
  }
}
process.env.E2E_EVENTS_REAL_STAND = "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "events-mobile.spec.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: process.env.E2E_DOCTOR_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
