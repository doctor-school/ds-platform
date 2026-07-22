#!/usr/bin/env tsx
/**
 * tools/lint/assignee-milestone-lint.ts — a live PR must carry ≥1 assignee AND a
 * milestone (#1140).
 *
 * Why this exists: the DS Platform Projects v2 board shows every open PR as a
 * row, and a row with no assignee / no milestone is un-triageable at a glance —
 * you cannot tell who owns it or which release theme it belongs to. Both fields
 * are trivially settable at PR-create time (`gh pr create --assignee … --milestone …`),
 * so an unfielded open-PR row is pure avoidable board noise. The Issue side is
 * already enforced (`pnpm issue:create` fails closed on a missing milestone —
 * repo-conventions.md → Field contract); this is the PR-side mirror, run at the
 * post-create preflight so a missing field fails at the author's keyboard, not
 * as later board cleanup.
 *
 * What it checks (PR-event-gated, like spec-link / stage-b): `gh pr view <N>`
 *   - assignees: at least one, AND
 *   - milestone: present (non-null).
 * Either missing → print what's missing + the one-line fix → exit 1 (HARD FAIL).
 * The fields are trivially settable at create time, so this lands as a hard gate
 * (not WARN); demote to WARN later — via this guard's own exit code, ADR-0007
 * §2.6 — only if it proves noisy.
 *
 * Non-PR runs, or a PR number that cannot be resolved → exit 0 with a skip note
 * (nothing to check). A `gh pr view` fetch failure → exit 1 (fail-closed: a PR we
 * cannot read is not a PR we can clear).
 *
 * Run: `pnpm lint:assignee-milestone` (PR_NUMBER from the Actions context) or via
 * `pnpm pr:preflight <N>`.
 */
import { ghViewJson } from "./lib/gh";

const TAG = "[assignee-milestone]";

interface GhAssignee {
  login: string;
}
interface GhMilestone {
  title?: string;
}
interface GhPR {
  number: number;
  assignees?: GhAssignee[];
  milestone?: GhMilestone | null;
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

  const res = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,assignees,milestone",
  );
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const pr = res.data;

  const missing: string[] = [];
  if ((pr.assignees ?? []).length === 0) missing.push("assignee");
  if (!pr.milestone?.title) missing.push("milestone");

  if (missing.length > 0) {
    fail(
      `PR #${pr.number} is missing ${missing.join(" + ")} (#1140: every open-PR board row carries ≥1 assignee AND a milestone). ` +
        `Set them — both are trivially settable at create time:\n` +
        `    gh pr edit ${pr.number} --add-assignee @me --milestone "<milestone>"`,
    );
  }

  const who = (pr.assignees ?? []).map((a) => a.login).join(", ");
  info(
    `PR #${pr.number} OK — assignee(s): ${who}; milestone: "${pr.milestone?.title}".`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
