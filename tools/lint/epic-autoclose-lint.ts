#!/usr/bin/env tsx
/**
 * tools/lint/epic-autoclose-lint.ts — WARN v1 (job `epic-autoclose`) guarding
 * against a child PR silently auto-closing an EPIC/parent issue on merge.
 *
 * Why this exists (real incident, Issue #964): a child PR wrote `Closes #927`,
 * and merging it auto-closed the release-cycle EPIC #927 even though #927 still
 * had OPEN sub-issues. GitHub's closing-keyword automation reads the PR body but
 * NOTHING read the native sub-issue graph at PR time — so an author who closes
 * the epic instead of the specific child sub-issue is never warned.
 *
 * What it checks: for each `Closes #N` / `Fixes #N` / `Resolves #N` reference
 * (case-insensitive, all the GitHub-recognized closing keywords) in the PR body,
 * resolve #N's native sub-issue graph. If #N is a parent/epic with ≥1 OPEN
 * sub-issue, the PR would auto-close a live epic → FAIL, naming the open children
 * and telling the author to link the specific child sub-issue instead of the
 * epic. A PR closing a leaf issue, or an epic whose sub-issues are all closed,
 * passes.
 *
 * ── Seam design (Issue #964 acceptance) ──────────────────────────────────────
 * The rule is a PURE function `evaluateEpicAutoclose(prBody, graphLookup)` where
 * `graphLookup(epic#) -> { openChildren: number[] } | undefined` is an
 * already-resolved view of the sub-issue graph. It returns a pass/fail verdict +
 * message and is platform-agnostic (no owner/repo, no network). The thin I/O
 * wrapper `main()` fetches the PR body (via lib/gh, honoring the #651 `PR_BODY`
 * event-payload seam) and resolves each referenced issue's OPEN children via
 * `gh api repos/{owner}/{repo}/issues/{N}/sub_issues` (gh substitutes owner/repo
 * from the repo context). Unit tests exercise the PURE seam with fixture graph
 * data — no network.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 posture: new AI/process guards land
 * as WARN, promote to BLOCK once the promotion window matures). The CI job uses
 * `continue-on-error: true`. SEVERITY below is the single clearly-marked
 * constant; flipping the guard to BLOCK is a one-line change here PLUS dropping
 * `continue-on-error` from the `epic-autoclose` job in pr-body-guards.yml.
 *
 * Non-PR runs, and PRs whose body has no closing keyword → exit 0 with a skip
 * note. Findings: stderr, exit 1. Clean: stdout summary, exit 0.
 *
 * Run: `pnpm lint:epic-autoclose` (PR_NUMBER from the Actions context).
 */
import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";

const TAG = "[epic-autoclose]";

/**
 * ── SEVERITY ──────────────────────────────────────────────────────────────
 * WARN v1 (ADR-0007 §2.6). To promote to BLOCK: change this to "BLOCK" AND
 * remove `continue-on-error: true` from the `epic-autoclose` job in
 * `.github/workflows/pr-body-guards.yml`. Both edits are required — this
 * constant is documentation/intent; the CI `continue-on-error` is what actually
 * gates the merge.
 */
export const SEVERITY: "WARN" | "BLOCK" = "WARN";

// GitHub-recognized closing keywords (case-insensitive): close/closes/closed,
// fix/fixes/fixed, resolve/resolves/resolved — each followed by `#<N>`. A colon
// and/or whitespace between the keyword and the ref is tolerated
// (`Closes #5`, `Closes: #5`, `Closes:#5`).
const CLOSING_REF_RE =
  /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)[:\s]+#(\d+)/gi;

/**
 * Strip Markdown fenced code blocks (```…``` / ~~~…~~~) from a body, line by
 * line, blanking the fence lines and everything between them. GitHub's
 * closing-keyword automation ignores keywords inside code, so a `Closes #N`
 * sitting in a fenced block is not a directive and must NOT count. Pure.
 */
function stripFencedBlocks(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let fenceChar: string | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*([`~]{3,})/);
    if (fenceChar === null) {
      if (m) {
        fenceChar = m[1][0];
        out.push(""); // opening fence line → blank
      } else {
        out.push(line);
      }
    } else {
      if (m && m[1][0] === fenceChar) fenceChar = null; // closing fence
      out.push(""); // fenced content (and the closing fence line) → blank
    }
  }
  return out.join("\n");
}

/**
 * Strip Markdown inline code spans (`` `…` ``, `` ``…`` ``) from a body: a run of
 * N backticks opens a span that the next run of N backticks closes. Mirrors
 * GitHub, which never auto-closes a keyword inside a code span (the #986
 * incident: this PR's own Summary quotes `` `Closes #927` ``). Pure.
 */
function stripInlineCode(body: string): string {
  return body.replace(/(`+)[\s\S]*?\1/g, " ");
}

/**
 * Remove code — fenced blocks then inline spans — before the closing-keyword
 * regex runs, so a keyword that lives inside code is not read as a directive
 * (mirrors GitHub's own parser). Pure, deterministic, no network.
 */
function stripCode(body: string): string {
  return stripInlineCode(stripFencedBlocks(body));
}

/** A resolved sub-issue-graph view for a single issue number. */
export interface EpicGraph {
  /**
   * OPEN sub-issue numbers of this issue. Empty (or the issue being absent from
   * the lookup) means "leaf, or all children closed" — i.e. safe to close.
   */
  openChildren: number[];
}

/**
 * Resolve an issue number to its sub-issue graph. Returns `undefined` when the
 * issue is a leaf / has no known open children (treated the same as an empty
 * `openChildren`). Platform-agnostic: no owner/repo baked in.
 */
export type GraphLookup = (issueNumber: number) => EpicGraph | undefined;

export interface Offender {
  /** The epic/parent issue a closing keyword targets. */
  epic: number;
  /** Its OPEN sub-issue numbers. */
  openChildren: number[];
}

export interface Verdict {
  ok: boolean;
  /** Deduped closing-keyword refs parsed from the body, in first-seen order. */
  closingRefs: number[];
  /** Refs that are epics with ≥1 open sub-issue. */
  offenders: Offender[];
  message: string;
}

/**
 * Parse the deduped `#N` targets of GitHub closing keywords from a PR body, in
 * first-seen order. A keyword inside a fenced code block or an inline code span
 * is stripped first and does NOT count — mirroring GitHub, which never
 * auto-closes a keyword that sits in code (#986). Pure.
 */
export function parseClosingRefs(body: string): number[] {
  if (!body) return [];
  const scanned = stripCode(body);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of scanned.matchAll(CLOSING_REF_RE)) {
    const n = Number(m[1]);
    if (!Number.isNaN(n) && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * PURE rule seam (Issue #964 acceptance). Given a PR body and an
 * already-resolved sub-issue-graph lookup, return a pass/fail verdict. FAILS
 * when any closing-keyword ref targets an epic with ≥1 OPEN sub-issue. No
 * network, no owner/repo, deterministic.
 */
export function evaluateEpicAutoclose(
  prBody: string,
  graphLookup: GraphLookup,
): Verdict {
  const closingRefs = parseClosingRefs(prBody);
  const offenders: Offender[] = [];
  for (const ref of closingRefs) {
    const graph = graphLookup(ref);
    const openChildren = graph?.openChildren ?? [];
    if (openChildren.length > 0) {
      offenders.push({ epic: ref, openChildren });
    }
  }

  if (offenders.length === 0) {
    const summary =
      closingRefs.length === 0
        ? "no closing-keyword reference in the PR body"
        : `all ${closingRefs.length} closing ref(s) target leaf issues or fully-closed epics`;
    return { ok: true, closingRefs, offenders, message: summary };
  }

  const lines = offenders.map((o) => {
    const kids = o.openChildren.map((n) => `#${n}`).join(", ");
    return (
      `Closes #${o.epic} would auto-close epic #${o.epic}, which still has ` +
      `${o.openChildren.length} OPEN sub-issue(s): ${kids}. ` +
      `Link the specific child sub-issue you are closing (e.g. \`Closes ${o.openChildren.map((n) => `#${n}`)[0]}\`), not the epic.`
    );
  });
  return {
    ok: false,
    closingRefs,
    offenders,
    message: lines.join("\n"),
  };
}

// ── I/O wrapper (thin) ───────────────────────────────────────────────────────

interface GhPR {
  number: number;
  body: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function failExit(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

interface SubIssue {
  number: number;
  state: string;
}

/**
 * Fetch an issue's OPEN sub-issue numbers via the native sub-issues API. Test
 * seam `LINT_SUBISSUES_FIXTURE_DIR`: when set, reads `sub-issues-<n>.json` (an
 * array of `{ number, state }`) instead of spawning `gh`, mirroring lib/gh.ts.
 * A fetch error resolves to `[]` (fail-open: a WARN guard must never crash CI on
 * a transient API hiccup or a repo without the sub-issues feature).
 */
async function fetchOpenChildren(issueNumber: number): Promise<number[]> {
  const fixtureDir = process.env.LINT_SUBISSUES_FIXTURE_DIR;
  let subIssues: SubIssue[];
  if (fixtureDir) {
    const file = resolve(fixtureDir, `sub-issues-${issueNumber}.json`);
    try {
      subIssues = JSON.parse(readFileSync(file, "utf8")) as SubIssue[];
    } catch {
      return [];
    }
  } else {
    try {
      const { stdout } = await execa("gh", [
        "api",
        `repos/{owner}/{repo}/issues/${issueNumber}/sub_issues`,
        "--jq",
        "[.[] | {number, state}]",
      ]);
      subIssues = JSON.parse(stdout) as SubIssue[];
    } catch {
      return [];
    }
  }
  return subIssues
    .filter((s) => String(s.state).toLowerCase() === "open")
    .map((s) => s.number);
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

  const res = await ghViewJson<GhPR>("pr", prNumber, "number,body");
  if (!res.ok)
    failExit(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  const body = res.data.body ?? "";

  const closingRefs = parseClosingRefs(body);
  if (closingRefs.length === 0) {
    info(
      `PR #${prNumber} body has no closing-keyword reference, rule does not apply`,
    );
    process.exit(0);
  }
  info(`PR #${prNumber} closes: ${closingRefs.map((n) => `#${n}`).join(", ")}`);

  // Resolve the sub-issue graph for every referenced issue, then run the PURE
  // rule over the resolved lookup.
  const graph = new Map<number, EpicGraph>();
  for (const ref of closingRefs) {
    graph.set(ref, { openChildren: await fetchOpenChildren(ref) });
  }
  const verdict = evaluateEpicAutoclose(body, (n) => graph.get(n));

  if (!verdict.ok) {
    failExit(
      `${verdict.message}\n${TAG} FAIL (${SEVERITY}) — closing an epic with open sub-issues ` +
        `orphans its children on the board and prematurely closes the parent (Issue #964).`,
    );
  }

  info(`OK — ${verdict.message}`);
  process.exit(0);
}

// Run only as the entry point — importing the pure seams
// (`evaluateEpicAutoclose`, `parseClosingRefs`) into a unit test must NOT fire
// `main()`'s `gh` calls (mirrors tools/backlog-triage.ts).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const IS_ENTRY = INVOKED === fileURLToPath(import.meta.url);
if (IS_ENTRY) {
  main().catch((e) => {
    process.stderr.write(
      `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
    );
    process.exit(1);
  });
}
