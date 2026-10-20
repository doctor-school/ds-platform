import path from "node:path";

import { defineConfig } from "@playwright/test";

import { publicLogEnabled, reportersFor } from "../../lib/reporters.js";

// The fixture run's config: the SAME reporter selection the suite config uses,
// with no other console reporter added.
const reportDir = process.env.E2E_REPORT_DIR;
export default defineConfig({
  testDir: ".",
  testMatch: /leaky\.fixture\.ts$/,
  retries: 0,
  workers: 1,
  outputDir: path.join(reportDir ?? "test-results", "artifacts"),
  reporter: reportersFor({
    publicLog: publicLogEnabled(process.env),
    reportDir,
  }) as NonNullable<Parameters<typeof defineConfig>[0]["reporter"]>,
});
