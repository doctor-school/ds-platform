#!/usr/bin/env tsx
/**
 * tools/lint/module-readme-lint.ts — WARN v1 for the ADR-0006 §7 module-README
 * contract ("Every `src/modules/<m>/` has a README; export symbols mentioned").
 *
 * Was a `[stub]` exit-0 (never failed → 6-week green history vacuous, not
 * promotable). Implemented per Issue #438 (the #427 WARN→BLOCK sweep found the
 * four stubs). Lands as a REAL WARN v1: exits non-zero on findings; the CI job
 * keeps `continue-on-error: true` until its own ADR-0007 §2.6 promotion window
 * matures.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Every **top-level NestJS module directory** under an app's `src/` must contain
 * a `README.md`. A *module directory* is a **direct child directory of
 * `apps/<app>/src/`** that holds at least one `*.module.ts` file.
 *
 * ── Reading of ADR-0006 §7 (documented-path drift) ────────────────────────────
 * ADR-0006 §7 names the location literally as `apps/<app>/src/modules/<m>/README.md`.
 * The repo never adopted a `modules/` wrapper directory — NestJS modules sit
 * directly under `src/` (`apps/api/src/auth/`, `.../authz/`, …). The literal
 * `src/modules/*` glob therefore matches nothing, which would make the guard
 * vacuously green — the exact stub pathology #438 exists to remove. So the guard
 * keys on the technically-precise definition of "a module" (a dir carrying a
 * `*.module.ts`) at the same single glob depth §7 uses (`src/modules/*` = one
 * level below `src/`, so here `src/<module>/` = one level below `src/`). This is
 * the narrowest reading that faithfully realises the contract's INTENT. (The
 * stale §7 path is decision-debt tracked in #457 (adr-revision), not fixed here.)
 *
 * ── Edge cases ────────────────────────────────────────────────────────────────
 * - **App-root composition module excluded.** `app.module.ts` sitting *directly*
 *   in `apps/<app>/src/` (no `<module>/` subdir) is the bootstrap composition,
 *   not a feature module — out of scope (matches §7's `src/modules/<m>/` requiring
 *   a subdirectory).
 * - **Nested sub-modules are covered by their parent.** A `*.module.ts` deeper
 *   than one level (`src/<module>/<sub>/x.module.ts`) does NOT independently
 *   require its own README — the single-level depth mirrors §7's `src/modules/*`.
 *   Only the top-level `src/<module>/` dir is required to be documented.
 * - **Non-Nest apps are naturally out of scope.** Next.js / Expo apps carry no
 *   `*.module.ts`, so nothing under `apps/portal`, `apps/mobile`, … is required.
 * - **v1 = presence only.** ADR-0006 §7's "export symbols mentioned" is the v2
 *   tightening ("warn-only v1, block in v2"); the export ↔ README cross-check is
 *   deliberately NOT in v1. v1 asserts a `README.md` exists, nothing more.
 *
 * ── Allowlist (pre-existing gaps) ─────────────────────────────────────────────
 * Six api modules predate this guard and lack a README (`database`,
 * `delivery-reconcile`, `feature-flags`, `health`, `mailer`, `readiness`).
 * Authoring six real export-documenting READMEs is not a mechanical in-scope fix,
 * so they are grandfathered in `MODULE_README_ALLOW` below — each entry references
 * the tracked backfill Issue #456. This mirrors the `BUILTIN_DEFERRALS`
 * precedent in ears-test-lint.ts: an allowlist entry is tracked debt, not a silent
 * bypass. The `LINT_MODULE_README_ALLOW` env seam replaces the map for tests.
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness). Inert in production.
 * Run: `pnpm lint:module-readme`. Findings: stderr + exit 1. Clean: exit 0.
 */
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[module-readme]";

/**
 * Grandfathered module dirs (repo-root-relative POSIX paths) that predate the
 * guard and lack an ADR-0006 §7 README. Value = the reason + tracking Issue.
 * Keep SHORT; prune each entry when its module grows a real README. Every entry
 * MUST reference an OPEN backfill Issue (#456 — the module-README backfill
 * tracker, filed off #438).
 */
type Allow = { issue: number; reason: string };
const MODULE_README_ALLOW: Record<string, Allow> = {
  "apps/api/src/database": { issue: 456, reason: "infra module, README backfill pending" },
  "apps/api/src/delivery-reconcile": { issue: 456, reason: "README backfill pending" },
  "apps/api/src/feature-flags": { issue: 456, reason: "README backfill pending" },
  "apps/api/src/health": { issue: 456, reason: "README backfill pending" },
  "apps/api/src/mailer": { issue: 456, reason: "README backfill pending" },
  "apps/api/src/readiness": { issue: 456, reason: "README backfill pending" },
};

function loadAllow(): Record<string, Allow> {
  const raw = process.env.LINT_MODULE_README_ALLOW;
  if (!raw) return MODULE_README_ALLOW;
  try {
    return JSON.parse(raw) as Record<string, Allow>;
  } catch (e) {
    process.stdout.write(
      `${TAG} WARN: ignoring malformed LINT_MODULE_README_ALLOW: ${(e as Error).message.split("\n")[0]}\n`,
    );
    return MODULE_README_ALLOW;
  }
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Top-level module dir (repo-root-relative POSIX) for a `*.module.ts`, or null
 * when the file is the app-root composition module (directly under `src/`).
 * `apps/api/src/auth/idp/idp.module.ts` → `apps/api/src/auth` (folded to the
 * single top-level module — the nested sub-module rides its parent's README).
 */
function topLevelModuleDir(moduleFileRel: string): string | null {
  const fileDir = dirname(moduleFileRel);
  // App-root module (`apps/<app>/src/app.module.ts`) sits directly in `src/` —
  // its dir is `apps/<app>/src`, which carries no `<module>/` segment → excluded.
  if (/^apps\/[^/]+\/src$/.test(fileDir)) return null;
  // Otherwise fold to the first directory segment below `src/`.
  const m = fileDir.match(/^(apps\/[^/]+\/src\/[^/]+)/);
  return m ? m[1] : null;
}

async function main(): Promise<void> {
  const allow = loadAllow();
  const moduleFiles = await fg("apps/*/src/**/*.module.ts", {
    cwd: REPO_ROOT,
    ignore: ["**/node_modules/**"],
  });

  // Unique top-level module dirs (fold nested sub-modules into their parent).
  const moduleDirs = new Set<string>();
  for (const f of moduleFiles) {
    const rel = f.replace(/\\/g, "/");
    const dir = topLevelModuleDir(rel);
    if (dir) moduleDirs.add(dir);
  }

  info(
    `found ${moduleDirs.size} top-level NestJS module dir(s) under apps/*/src (from ${moduleFiles.length} *.module.ts)`,
  );

  const findings: string[] = [];
  let allowed = 0;
  for (const dir of [...moduleDirs].sort()) {
    if (await exists(resolve(REPO_ROOT, dir, "README.md"))) continue;
    if (dir in allow) {
      allowed++;
      info(`allowlisted (README backfill #${allow[dir].issue}): ${dir} — ${allow[dir].reason}`);
      continue;
    }
    findings.push(dir);
  }

  if (findings.length === 0) {
    info(
      `PASS — every module dir has a README (${allowed} grandfathered gap(s) tracked in the allowlist).`,
    );
    process.exit(0);
  }

  for (const dir of findings) {
    process.stderr.write(`${TAG} missing README  ${dir}/README.md\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} NestJS module dir(s) without a README. ` +
      `Per ADR-0006 §7 every module documents itself: add \`${findings[0]}/README.md\` ` +
      `describing the module's purpose + exported symbols. If a gap is genuine ` +
      `pre-existing debt, add it to MODULE_README_ALLOW in tools/lint/module-readme-lint.ts ` +
      `with a tracking Issue.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
