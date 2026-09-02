#!/usr/bin/env node
/**
 * 019 EARS-8 (#1523) — the doctor-storefront Playwright tier runner.
 *
 * The storefront has four Playwright tiers because each needs a different
 * upstream: the backend-free `playwright.ci.config.ts`, plus the specialty
 * consumption, 021 return-context and 019 events tiers, which each boot their
 * own upstream double beside the built app.
 *
 * `test:e2e:ci` used to chain them with `&&`, which meant a red FIRST tier
 * short-circuited the rest: the job log then carried no evidence — pass or
 * fail — for the later tiers, and a reviewer could not tell «green» from «never
 * ran». This runner executes EVERY tier regardless of earlier failures, prints
 * a per-tier summary, and exits non-zero if ANY tier is red. The gate is not
 * weakened: one red tier still fails the job; it just no longer hides the
 * others' evidence.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Resolved from the package entry, not path-joined from the app: pnpm may hoist
// `@playwright/test` above the app, and `./cli.js` is not an exported subpath,
// so it has to be reached beside the resolved entry point.
const PLAYWRIGHT_CLI = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@playwright/test")),
  "cli.js",
);

const TIERS = [
  "playwright.ci.config.ts",
  "playwright.consumption.config.ts",
  "playwright.return-context.config.ts",
  "playwright.events.config.ts",
];

const results = [];

for (const config of TIERS) {
  console.log(`\n=== Playwright tier: ${config} ===`);
  const run = spawnSync(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", `--config=${config}`],
    { cwd: APP_ROOT, stdio: "inherit" },
  );
  const code = run.status ?? 1;
  results.push({ config, code });
  console.log(`=== ${config} -> exit ${code} ===`);
}

console.log("\n=== Playwright tier summary ===");
for (const { config, code } of results) {
  console.log(`${code === 0 ? "PASS" : "FAIL"}  ${config}`);
}

process.exit(results.some(({ code }) => code !== 0) ? 1 : 0);
