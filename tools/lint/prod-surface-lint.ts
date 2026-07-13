#!/usr/bin/env tsx
/**
 * tools/lint/prod-surface-lint.ts — prod-surface readiness gate (#771; F-22
 * class, memory `feedback_production_ready_no_scaffold_surfaces`).
 *
 * Why this exists: wave-1 prod smoke found the LIVE `/` still showing the
 * repo-scaffold card («Каркас приложения (ADR-0004 §3/§7)…») and `/account`
 * rendering a raw session-claims dump — both passed every existing gate
 * because no guard reasons per prod-reachable ROUTE. This gate does, in two
 * parts:
 *
 *   Part 1 — per-route inventory. Every App-Router page under
 *   `apps/{portal,admin}/app` must have exactly one entry in the committed
 *   manifest `tools/lint/prod-surface-manifest.yaml`, classified
 *   `product-ready` or `deferred` (+ a tracking `issue: "#N"`). Failures:
 *   `unclassified-route`, `stale-manifest-entry` (entry → missing file),
 *   `duplicate-manifest-entry`, `invalid-status`, `deferred-missing-issue`,
 *   and `deferred-issue-not-open`. The open-state check calls `gh issue view`
 *   and runs ONLY when `LINT_FIXTURE_ROOT` is unset AND `GH_TOKEN` is set AND
 *   `gh` resolves — otherwise it is skipped silently (fixture runs and
 *   token-less local runs never hit the network).
 *
 *   Part 2 — scaffold-tell heuristic (backstop). Page sources (comments
 *   stripped — an EARS/ADR reference in a code comment is fine; the same
 *   reference in rendered copy is the tell) plus `apps/{portal,admin}/
 *   messages/*.json` copy catalogs are scanned for scaffold tells:
 *   `ADR-\d` / `EARS-\d` / «Каркас приложения» / («собирается на» +
 *   «дизайн-систем» on one line), and the session-dump tell — BOTH
 *   `session-sub` and `session-roles` test ids in one page file. Routes
 *   classified `deferred` (tracked) are exempt; `product-ready` routes are
 *   not. There is NO inline suppression comment — the manifest is the only
 *   suppression mechanism. Messages catalogs are app-level (not per-route),
 *   so they are always scanned.
 *
 * Severity: BLOCK from day 0 — documented mandate in ADR-0007 §2.6 (Issue
 * #771, wave-1 prod-smoke retro: «no scaffold face in prod», F-22 class).
 *
 * Run: `pnpm lint:prod-surface`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import fg from "fast-glob";
import { parse } from "yaml";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at
// a fixture tree (tools/lint/guard-tests). Inert in production.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[prod-surface]";
const MANIFEST_REL = "tools/lint/prod-surface-manifest.yaml";

const PAGE_GLOBS = [
  "apps/portal/app/**/page.{tsx,ts}",
  "apps/admin/app/**/page.{tsx,ts}",
];
const MESSAGE_GLOBS = [
  "apps/portal/messages/*.json",
  "apps/admin/messages/*.json",
];
const IGNORE = ["**/node_modules/**"];

interface ManifestEntry {
  app?: string;
  route?: string;
  file?: string;
  status?: string;
  issue?: string;
}

// Scaffold tells in user-facing copy. Applied per line, AFTER comment
// stripping for page sources (raw lines for messages JSON — every value there
// is user-facing copy by definition).
const SINGLE_TELLS: { name: string; re: RegExp }[] = [
  { name: "ADR reference in copy", re: /ADR-\d/ },
  { name: "EARS reference in copy", re: /EARS-\d/ },
  { name: "scaffold self-description", re: /Каркас приложения/ },
];
// Paired tell: both halves on one line («…собирается на общей дизайн-системе»).
const PAIR_TELL_A = /собирается на/;
const PAIR_TELL_B = /дизайн-систем/;
// Session-dump tell: a page whose rendered body is a raw claims dump — v1
// signature is BOTH test ids present in one page file.
const SESSION_SUB_RE = /\bsession-sub\b/;
const SESSION_ROLES_RE = /\bsession-roles\b/;

const ISSUE_REF_RE = /^#\d{1,6}$/;

interface Finding {
  kind: string;
  where: string;
  detail: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

// Blank out block comments (multi-line, incl. the inner form of JSX comments)
// and `// …` line remainders, preserving newlines so line numbers stay
// accurate. Deliberately simple: a `//` inside a string literal (e.g. a URL)
// also blanks the rest of that line, which can only under-report, never
// false-positive.
function stripComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function scanCopyLines(
  lines: string[],
  rel: string,
  findings: Finding[],
): void {
  lines.forEach((line, i) => {
    for (const tell of SINGLE_TELLS) {
      if (tell.re.test(line)) {
        findings.push({
          kind: "scaffold-copy",
          where: `${rel}:${i + 1}`,
          detail: `${tell.name}: ${line.trim().slice(0, 120)}`,
        });
        return;
      }
    }
    if (PAIR_TELL_A.test(line) && PAIR_TELL_B.test(line)) {
      findings.push({
        kind: "scaffold-copy",
        where: `${rel}:${i + 1}`,
        detail: `scaffold self-description: ${line.trim().slice(0, 120)}`,
      });
    }
  });
}

/** `true` when the deferred-Issue OPEN check should run (real repo + gh + token). */
function ghCheckEnabled(): boolean {
  if (process.env.LINT_FIXTURE_ROOT) return false;
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) return false;
  const probe = spawnSync("gh", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}

function issueIsOpen(issueRef: string): boolean | undefined {
  const num = issueRef.replace(/^#/, "");
  const res = spawnSync(
    "gh",
    ["issue", "view", num, "--json", "state", "-q", ".state"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (res.status !== 0) return undefined; // gh hiccup — don't fail the build on it
  return res.stdout.trim() === "OPEN";
}

async function main(): Promise<void> {
  const findings: Finding[] = [];

  const manifestPath = join(REPO_ROOT, MANIFEST_REL);
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      `${TAG} missing-manifest  ${MANIFEST_REL} not found — the prod-surface manifest is required.\n`,
    );
    process.exit(1);
  }
  const manifest = parse(readFileSync(manifestPath, "utf8")) as {
    routes?: ManifestEntry[];
  };
  const entries = manifest?.routes ?? [];

  // ---- Part 1: per-route inventory --------------------------------------
  const pageFiles = (
    await fg(PAGE_GLOBS, { cwd: REPO_ROOT, ignore: IGNORE })
  ).map((p) => p.replace(/\\/g, "/"));

  const byFile = new Map<string, ManifestEntry>();
  for (const entry of entries) {
    const file = (entry.file ?? "").replace(/\\/g, "/");
    if (byFile.has(file)) {
      findings.push({
        kind: "duplicate-manifest-entry",
        where: MANIFEST_REL,
        detail: `more than one entry for ${file}`,
      });
      continue;
    }
    byFile.set(file, entry);

    if (!existsSync(join(REPO_ROOT, file))) {
      findings.push({
        kind: "stale-manifest-entry",
        where: MANIFEST_REL,
        detail: `entry ${entry.route ?? file} points at missing file ${file}`,
      });
    }
    if (entry.status !== "product-ready" && entry.status !== "deferred") {
      findings.push({
        kind: "invalid-status",
        where: MANIFEST_REL,
        detail: `${file}: status must be product-ready | deferred (got ${JSON.stringify(entry.status)})`,
      });
    }
    if (entry.status === "deferred") {
      if (!entry.issue || !ISSUE_REF_RE.test(entry.issue)) {
        findings.push({
          kind: "deferred-missing-issue",
          where: MANIFEST_REL,
          detail: `${file}: a deferred route MUST cite its tracking Issue as issue: "#N" (AGENTS.md §6 — no untracked scaffold)`,
        });
      }
    }
  }

  for (const file of pageFiles) {
    if (!byFile.has(file)) {
      findings.push({
        kind: "unclassified-route",
        where: file,
        detail: `route file has no entry in ${MANIFEST_REL} — classify it product-ready or deferred (issue: "#N")`,
      });
    }
  }

  // Deferred-Issue OPEN check (real repo + gh + token only; silent otherwise).
  if (ghCheckEnabled()) {
    for (const [file, entry] of byFile) {
      if (entry.status !== "deferred" || !entry.issue) continue;
      const open = issueIsOpen(entry.issue);
      if (open === false) {
        findings.push({
          kind: "deferred-issue-not-open",
          where: MANIFEST_REL,
          detail: `${file}: deferred tracking Issue ${entry.issue} is not OPEN — re-point it or reclassify the route`,
        });
      }
    }
  }

  // ---- Part 2: scaffold-tell heuristic (backstop) ------------------------
  for (const file of pageFiles) {
    const entry = byFile.get(file);
    if (entry?.status === "deferred") continue; // tracked — exempt

    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    const stripped = stripComments(source);
    scanCopyLines(stripped.split(/\r?\n/), file, findings);

    if (SESSION_SUB_RE.test(stripped) && SESSION_ROLES_RE.test(stripped)) {
      findings.push({
        kind: "session-dump",
        where: file,
        detail:
          "page renders a raw session-claims dump (both `session-sub` and `session-roles` test ids) — a debug body is not a product surface",
      });
    }
  }

  const messageFiles = (
    await fg(MESSAGE_GLOBS, { cwd: REPO_ROOT, ignore: IGNORE })
  ).map((p) => p.replace(/\\/g, "/"));
  for (const file of messageFiles) {
    const lines = readFileSync(join(REPO_ROOT, file), "utf8").split(/\r?\n/);
    scanCopyLines(lines, file, findings);
  }

  info(
    `scanned ${pageFiles.length} route file(s) + ${messageFiles.length} message catalog(s) against ${entries.length} manifest entr(y/ies)`,
  );

  if (findings.length === 0) {
    info("PASS — every prod-reachable route is classified and scaffold-free.");
    process.exit(0);
  }

  for (const f of findings) {
    process.stderr.write(`${TAG} ${f.kind}  ${f.where}\n    ${f.detail}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} finding(s). Every user-reachable route must be classified in ` +
      `${MANIFEST_REL} (product-ready | deferred + open issue "#N"), and a product-ready route must not ` +
      `ship scaffold copy (ADR/EARS refs, «Каркас приложения», skeleton self-description) or a raw ` +
      `session-claims dump. Classify honestly — never soften the heuristic to get green (#771, AGENTS.md §6 F-22).\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
