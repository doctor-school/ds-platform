import { defineConfig, devices } from "@playwright/test";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";

// 018 EARS-8 (#1503) — the adjacent-areas spec against a real stand: a
// production build of the doctor app, the real api and Postgres with managed
// direction rows. It never falls back to the route tier's upstream double.
// See the ENV SET of `e2e/feed-adjacent.spec.ts`.
const required = [
  "E2E_DOCTOR_URL",
  "E2E_FEED_ADJACENT_CODE",
  "E2E_FEED_ADJACENT_EXPECT",
  "E2E_FEED_ADJACENT_EMPTY_CODE",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length)
  throw new Error(`018 adjacent live run: missing env: ${missing.join(", ")}`);
process.env.E2E_FEED_ADJACENT_REAL = "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "feed-adjacent.spec.ts",
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_DOCTOR_URL,
    // A staging slot's basic-auth pair (#3168); undefined on a local stand.
    httpCredentials: standHttpCredentials(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
