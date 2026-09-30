#!/usr/bin/env tsx
/**
 * tools/lint/product-note-lint.ts — enforcement gate for the "Product note (RU)"
 * release-note pipeline (Issue #654).
 *
 * Why this exists: the product owner wants every merged product update to reach
 * the team as a short product-language note in a Mattermost channel, deterministic
 * with no agent in the delivery path (owner-approved design, 2026-07-08). The
 * single source of truth is a `Product note (RU)` section in the PR body; a merge
 * GitHub Action renders it to Mattermost. This guard makes that source of truth
 * non-optional: a user-facing PR (kind label `feature` / `bug`) that ships with no
 * real note — or the literal `none` — goes red, so the note is authored at the
 * decision point instead of evaporating in the owner chat.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Read the PR's labels + body. A PR is "user-facing" when it carries a kind label
 * `feature` or `bug` (or a `feature:NNN-<slug>` area label). Extract the
 * `## Product note (RU)` section (HTML comments stripped).
 *   - user-facing + a real note (2+ sentences of product Russian) → PASS
 *   - user-facing + `none`/absent/placeholder                     → FAIL
 *   - internal-only (chore / refactor / docs / tooling / deps)    → PASS always
 *     (`none` is the sanctioned value there)
 *
 * `none` is allowed only on an internal-only PR — a `feature`/`bug` PR must carry
 * the note a reader would actually notice (mirrors the session report's
 * «Для пользователя» paragraph — skill `report-task-outcome`).
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 posture — new AI/process guards land as
 * WARN, promote to BLOCK once stable). Its `guards-warn` batch step is
 * `continue-on-error`.
 *
 * Non-PR runs → exit 0 with a skip note. PR-event-gated (needs `gh pr view`), so it
 * also runs under `pnpm pr:preflight <N>`. Failures: stderr, exit 1. Success:
 * stdout summary, exit 0.
 *
 * Seam: `LINT_GH_FIXTURE_DIR` (lib/gh.ts) serves canned `gh pr view` JSON under the
 * guard-tests harness. Inert in production.
 *
 * Run: `pnpm lint:product-note` (PR_NUMBER from the Actions context).
 */
// The ONE product-note extraction seam (Issue #2489): the section boundary, the
// `product-note:` single-line marker, HTML-comment + service-line stripping and the
// real-note test are the SAME functions the merge post and the release digest use.
import { extractNote, noteIsReal } from "../ci/post-product-note.mjs";
import { ghViewJson } from "./lib/gh";

const TAG = "[product-note]";

// Kind labels that mark a PR as user-facing. `feature` / `bug` are the bare kind
// labels (repo-conventions.md); a `feature:NNN-<slug>` area label is also, by
// definition, a user-facing feature PR.
const USER_FACING_LABEL_RE = /^(feature|bug)$/i;
const FEATURE_AREA_LABEL_RE = /^feature:/i;

interface GhLabel {
  name: string;
}
interface GhPR {
  number: number;
  body: string;
  labels?: GhLabel[];
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

function isUserFacing(labels: GhLabel[]): boolean {
  return labels.some(
    (l) =>
      USER_FACING_LABEL_RE.test(l.name) || FEATURE_AREA_LABEL_RE.test(l.name),
  );
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

  const res = await ghViewJson<GhPR>("pr", prNumber, "number,body,labels");
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const pr = res.data;

  const labels = pr.labels ?? [];
  const note = extractNote(pr.body ?? "");
  const real = noteIsReal(note);

  if (!isUserFacing(labels)) {
    info(
      `PR #${pr.number} is internal-only (no feature/bug kind label) — a Product note is optional ` +
        (real ? "(a real note is present anyway, fine)" : "(`none`/absent OK)"),
    );
    process.exit(0);
  }

  info(
    `PR #${pr.number} is user-facing (labels: ${labels.map((l) => l.name).join(", ")}) — a real Product note is required`,
  );

  if (!real) {
    fail(
      `PR #${pr.number} is user-facing but carries no real \`Product note (RU)\`` +
        (note
          ? ` (found: "${note.slice(0, 40)}")`
          : " (section missing or empty)") +
        `. Add 2–4 sentences of the user-visible change in plain product Russian to the ` +
        `\`## Product note (RU)\` section — mirror the session report's «Для пользователя» ` +
        `paragraph. \`none\` is allowed only on internal-only PRs (chore/CI/refactor/deps).`,
    );
  }

  info(`Product note OK: "${note.split(/\r?\n/)[0].slice(0, 100)}"`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
