import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Portal CI Playwright config — the BACKEND-FREE tier (#400, resurrecting the
 * #274 tier that the #351 showcase retarget retired).
 *
 * This is the OTHER half of the repo's two-tier portal-E2E pattern. The sibling
 * `playwright.config.ts` is the operator-driven, dev-stand-gated LIVE tier (real
 * api + Zitadel + Mailpit, NOT in CI, no `webServer` — the operator owns the
 * topology). THIS config is the one CI runs (`playwright-axe-portal` job): it
 * owns a `webServer` that boots the already-built portal with `next start`.
 * `testMatch` pins it to the backend-free auth-page axe scan and the Academy
 * home journey. The Academy form writes only into a guarded, CI-created private
 * temp directory, including accept/retry and real write-failure coverage. The
 * auth spec mocks its mount-time BFF read. So this tier remains hermetic: no
 * Postgres / Zitadel / Mailpit / API, and no submitted value leaves the process.
 * The showcase `playwright-axe` gate covers DS primitives; this tier covers the
 * composed product pages and persistence boundary that primitives cannot assert.
 *
 * Run locally (after `pnpm --filter @ds/portal build`):
 *   pnpm --filter @ds/portal test:e2e:ci
 */

const PORT = Number(process.env.PORTAL_CI_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
// Readiness probe: NOT `/` — the portal home server-renders an api fetch, so
// with no backend it 500s and Playwright's webServer check (2xx–4xx) would
// never pass. `/login` is one of the backend-free pages this tier scans.
const READY_URL = `${BASE}/login`;
const ACADEMY_E2E_SAFE_MARKER = "ACADEMY_PARTNERSHIP_E2E_SAFE";

function normalized(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validateInheritedSafeDirectory(directory: string): string {
  const resolvedDirectory = resolve(directory);
  const realDirectory = realpathSync(resolvedDirectory);
  const realTemporaryRoot = realpathSync(tmpdir());
  if (
    !statSync(resolvedDirectory).isDirectory() ||
    normalized(realDirectory) !== normalized(resolvedDirectory) ||
    normalized(dirname(realDirectory)) !== normalized(realTemporaryRoot) ||
    !basename(realDirectory).startsWith("academy-partnership-e2e-")
  ) {
    throw new Error("Refusing an unsafe inherited Academy E2E directory");
  }
  return realDirectory;
}

const inheritedSafeDirectory =
  process.env[ACADEMY_E2E_SAFE_MARKER] === "1"
    ? process.env.ACADEMY_SUBMISSIONS_DIR
    : undefined;
const ACADEMY_SUBMISSIONS_DIR =
  (inheritedSafeDirectory
    ? validateInheritedSafeDirectory(inheritedSafeDirectory)
    : undefined) ??
  mkdtempSync(join(tmpdir(), "academy-partnership-e2e-"));
if (!inheritedSafeDirectory) chmodSync(ACADEMY_SUBMISSIONS_DIR, 0o700);
process.env[ACADEMY_E2E_SAFE_MARKER] = "1";
process.env.ACADEMY_SUBMISSIONS_DIR = ACADEMY_SUBMISSIONS_DIR;

export default defineConfig({
  testDir: "./e2e",
  // Only the backend-free axe and Academy specs run in CI; live-Zitadel journeys
  // and the dev-stand-gated `e2e/a11y/` suite (`test:axe`) stay out. Anchored regex,
  // not a bare-basename glob: `e2e/a11y/a11y-axe.e2e.spec.ts` (the dev-stand
  // tier) shares the basename and a glob would drag its env-skipped tests in.
  testMatch: [
    /[\\/]e2e[\\/]a11y-axe\.e2e\.spec\.ts$/,
    /[\\/]e2e[\\/]academy-home\.e2e\.spec\.ts$/,
  ],
  globalTeardown: "./e2e/support/academy-submissions-global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Boot the already-built portal. `next start` serves the `.next` production
  // build, so the CI job must run the portal build first. No backend env is
  // needed; Academy persistence receives only the guarded temp directory below.
  webServer: {
    command: `pnpm --filter @ds/portal exec next start -p ${PORT}`,
    url: READY_URL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      [ACADEMY_E2E_SAFE_MARKER]: "1",
      ACADEMY_SUBMISSIONS_DIR,
    },
  },
});
