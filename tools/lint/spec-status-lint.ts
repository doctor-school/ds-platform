#!/usr/bin/env tsx
/**
 * tools/lint/spec-status-lint.ts — WARN v1 (job `spec-status-fresh`) for the
 * ADR-0007 design §5.2 "Spec status freshness" row ("Merged PR with spec:NNN but
 * spec status='Draft'. Custom lint: at merge — check `status: In dev` minimum").
 *
 * Was a `[stub]` exit-0 (never failed → vacuous green history, not promotable).
 * Implemented per Issue #438. Lands as a REAL WARN v1: exits non-zero on
 * findings; the CI job keeps `continue-on-error: true` until its ADR-0007 §2.6
 * promotion window matures. PR-event-gated (like spec-link) and run by
 * `pnpm pr:preflight` — so it MUST exit 0 cleanly outside a PR context.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * For each `feature:NNN-<slug>` area label on the PR, resolve the bound spec
 * `apps/docs/content/specs/features/NNN-<slug>/NNN-requirements.md` (or the
 * bilingual `-en.md`) and read its frontmatter `status:`. If the status is at or
 * below the `Draft` floor, FAIL — a feature PR must not merge while its spec is
 * still Draft (the design's "`status: In dev` minimum").
 *
 * ── Edge cases ────────────────────────────────────────────────────────────────
 * - **Authoring-PR exemption.** If the PR's own changed files include the spec's
 *   requirements file, the check is SKIPPED for that spec: that PR is the
 *   spec-authoring / status-bump PR, which legitimately holds `Draft` (new specs
 *   land as `status: Draft` per author-ears-spec) — it is the very PR that flips
 *   Draft → In dev. The floor is enforced on *consuming* (implementation) PRs.
 * - **Below-floor vocabulary.** The current status ladder's only below-`In dev`
 *   value is `Draft` (existing specs are `In dev` / `Shipped`). The guard fails
 *   ONLY on an explicit `Draft` (case-insensitive) to stay low-false-positive; a
 *   missing/other status passes (v1 does not invent a wider ladder).
 * - **Missing spec folder / requirements file** is spec-link's job (a BLOCK
 *   guard) — this guard info-skips it rather than double-reporting.
 * - Non-PR run, or a PR with no `feature:*` label → exit 0.
 *
 * Seams: `LINT_GH_FIXTURE_DIR` (gh pr view) + `LINT_FIXTURE_ROOT` (spec tree).
 * Run: `pnpm lint:spec-status` (PR_NUMBER from Actions). Findings: stderr + exit
 * 1. Clean / skip: stdout + exit 0.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[spec-status]";

const FEATURE_AREA_RE = /^feature:(\d{3}-[a-z0-9][a-z0-9-]*)$/i;
// Below-`In dev` floor. `Draft` is the only sub-minimum value in the current
// status vocabulary (design §5.2 names `Draft` explicitly).
const BELOW_FLOOR = new Set(["draft"]);

interface GhLabel {
  name: string;
}
interface GhPR {
  number: number;
  labels: GhLabel[];
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

/** Read the `status:` value from a requirements file's YAML frontmatter. */
async function readStatus(absPath: string): Promise<string | null | undefined> {
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch {
    return undefined; // file not present
  }
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const scope = fm ? fm[1] : text;
  const m = scope.match(/^status:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }

  const res = await ghViewJson<GhPR>("pr", prNumber, "number,labels,files", REPO_ROOT);
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const pr = res.data;

  const featureSlugs = (pr.labels ?? [])
    .map((l) => l.name.match(FEATURE_AREA_RE)?.[1])
    .filter((s): s is string => Boolean(s));
  if (featureSlugs.length === 0) {
    info(`PR #${pr.number} has no feature:NNN-<slug> label, rule does not apply`);
    process.exit(0);
  }

  const changed = new Set((pr.files ?? []).map((f) => f.path.replace(/\\/g, "/")));
  const failures: string[] = [];

  for (const slug of featureSlugs) {
    const nnn = slug.slice(0, 3);
    const candidates = [
      `apps/docs/content/specs/features/${slug}/${nnn}-requirements.md`,
      `apps/docs/content/specs/features/${slug}/${nnn}-requirements-en.md`,
    ];
    // Authoring-PR exemption: the PR that touches the requirements file owns the
    // Draft → In dev transition.
    if (candidates.some((c) => changed.has(c))) {
      info(`spec ${slug}: PR edits its requirements file (authoring/status-bump PR) → exempt`);
      continue;
    }
    let checkedAny = false;
    for (const rel of candidates) {
      const status = await readStatus(resolve(REPO_ROOT, rel));
      if (status === undefined) continue; // this variant absent
      checkedAny = true;
      if (status === null) {
        info(`spec ${slug} (${rel}): no status frontmatter → pass (v1 does not invent a floor)`);
        continue;
      }
      if (BELOW_FLOOR.has(status.toLowerCase())) {
        failures.push(
          `spec \`${slug}\` is \`status: ${status}\` but PR #${pr.number} implements it — a feature PR must not merge below the \`In dev\` floor (${rel}).`,
        );
      } else {
        info(`spec ${slug}: status \`${status}\` ≥ In dev floor OK`);
      }
    }
    if (!checkedAny) {
      info(`spec ${slug}: no requirements file found (spec-link's BLOCK guard covers existence), skipping`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.stderr.write(
      `${TAG} FAIL — advance the spec status to at least \`In dev\` before merging its implementation (design §5.2).\n`,
    );
    process.exit(1);
  }

  info(`all ${featureSlugs.length} feature spec(s) at/above the In-dev floor`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
