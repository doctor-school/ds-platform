#!/usr/bin/env tsx
/**
 * tools/lint/asset-format-lint.ts — enforcement gate for the asset-format policy
 * (ADR-0013 §8; epic #270 layer 5, child #275).
 *
 * Why this exists: the auth slice (#237) shipped a heavy 1511×496 **PNG**
 * wordmark and worked around the missing white logo variant with a `bg-card`
 * white-chip — both asset-hygiene defects (ADR-0013 §8). The policy is now
 * recorded (vector-first: SVG for logos/icons; WEBP-minimum for raster; PNG/JPG
 * disallowed for product assets), but a recorded policy with no enforcement is
 * exactly what regressed once already. This gate makes it fire at commit time
 * by flagging committed PNG / JPG / JPEG files under the two trees the ADR
 * names: each app's `public` dir and the design system.
 *
 * Allowed raster: WEBP (the raster floor) and `.ico` / `.svg` are not matched —
 * only PNG/JPG, the disallowed pair, are. Vector and WEBP pass freely.
 *
 * Scope: `apps/<app>/public` (recursive) and `packages/design-system`. Next.js
 * app-dir metadata icons (a `favicon.ico` / `icon.*` / `apple-icon.*` under
 * `apps/<app>/src/app`) are a framework convention living OUTSIDE `public` and
 * are deliberately out of scope, matching the ADR's named trees.
 *
 * Suppression: a genuinely-required raster (e.g. a PWA / Apple-touch icon a
 * browser or web-manifest demands as PNG) is added to ALLOW below with a reason.
 * There is no inline-comment escape hatch — these are binary files — so the
 * allowlist is the single, auditable exception channel. It is empty today: SVG
 * covers every current asset.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; a new guard lands WARN, promote to
 * BLOCK once stable). The CI job uses `continue-on-error` and is excluded from
 * the `ci` meta-job needs-list while WARN.
 *
 * Run: `pnpm lint:asset-format`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree (tools/lint/guard-tests). Inert in production — when unset the root
// resolves to the repo root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[asset-format]";

// Only the disallowed pair. WEBP (raster floor), SVG (vector), and .ico
// (favicons) are intentionally absent — they pass.
// Extensions are matched case-insensitively (`caseSensitiveMatch: false`
// below), so `.PNG` / `.JPG` are caught without separate uppercase entries.
const GLOBS = [
  "apps/*/public/**/*.{png,jpg,jpeg}",
  "packages/design-system/**/*.{png,jpg,jpeg}",
];
const IGNORE = ["**/node_modules/**"];

// Allowlist of genuinely-required rasters. Key = repo-root-relative POSIX path,
// value = the reason it must stay PNG/JPG. Empty today (SVG covers everything).
// Add an entry only when a browser / web-manifest spec genuinely demands the
// raster — never to wave through a wordmark or icon that should be SVG/WEBP.
const ALLOW: Record<string, string> = {};

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

async function main(): Promise<void> {
  const matches = await fg(GLOBS, {
    cwd: REPO_ROOT,
    ignore: IGNORE,
    absolute: true,
    caseSensitiveMatch: false,
  });

  const findings: string[] = [];
  for (const file of matches) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (rel in ALLOW) continue;
    findings.push(rel);
  }

  info(`scanned ${matches.length} raster asset(s) under apps/*/public + @ds/design-system`);

  if (findings.length === 0) {
    info("PASS — no disallowed PNG/JPG product assets (SVG-first, WEBP-minimum).");
    process.exit(0);
  }

  for (const rel of findings) {
    process.stderr.write(`${TAG} disallowed raster  ${rel}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} disallowed PNG/JPG asset(s). ` +
      `Per ADR-0013 §8 product assets are vector-first: logos/icons ship as SVG, ` +
      `raster (photography/screenshots) as WEBP minimum; PNG/JPG are disallowed. ` +
      `Re-export as SVG (vector) or convert to WEBP (raster), or — if a browser / ` +
      `web-manifest genuinely demands the raster — add the path to ALLOW in ` +
      `tools/lint/asset-format-lint.ts with a reason.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
