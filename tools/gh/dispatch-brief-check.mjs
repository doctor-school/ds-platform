#!/usr/bin/env node
/**
 * tools/gh/dispatch-brief-check.mjs — AC-surface coverage gate for dispatch
 * briefs (#757).
 *
 * Why: a dispatch brief that names a different file surface than the Issue's
 * Acceptance-criteria block calls out costs a follow-up round-trip. Retro
 * e31ab7c7 F1: the #743 brief pointed at `.claude/commands/wrap.md` (from the
 * lead's own recon) while the AC named the catalog
 * `apps/docs/content/skills/run-wrap/SKILL.md` — the mismatch surfaced only
 * after the subagent returned. This script makes the check deterministic: for
 * every repo-path-like surface the Issue's `## Acceptance criteria` block
 * names, it asserts the brief text names that same path.
 *
 * Canon: memory `feedback_orchestration_brief_full_lint_before_pr` item 2e.
 * Sibling of `handoff:verify` (#743) and `dispatch:probe` (#744) — same
 * architecture: a pure, unit-tested core + an injectable `gh` runner so tests
 * never shell out.
 *
 * Usage:
 *   pnpm dispatch:brief-check <issue-N> <brief-file>
 *   <emit brief> | pnpm dispatch:brief-check <issue-N>      # stdin
 *
 * How it works:
 *   - `gh issue view <N> --json body` → the Issue body.
 *   - `extractAcSection(body)` → the text under `## Acceptance criteria`.
 *   - `extractPathTokens(text)` → the repo-path-like surfaces it names.
 *   - `checkCoverage(tokens, briefText)` → PASS/MISSING per surface, where a
 *     surface is covered iff the brief text (backtick/whitespace-normalized)
 *     contains it as a substring.
 *
 * Output: one machine-parseable row per surface — `PASS <path>` /
 * `MISSING <path>` — then a summary line.
 *
 * Exit codes: 0 = all surfaces covered (or the AC block names zero path-like
 * surfaces → nothing to check); 1 = ≥1 MISSING; 2 = usage / input error
 * (missing or non-numeric <N>, unreadable brief, or a `gh` failure).
 * Auto-editing the brief is OUT of scope — the verdict informs the lead.
 *
 * Pure node, no bash-isms — runs on Windows/PowerShell and POSIX alike. The
 * extraction/coverage logic is exported for unit tests
 * (tools/lint/guard-tests/dispatch-brief-check.spec.ts); the `gh` call goes
 * through an injectable runner so tests never shell out.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Extract the markdown text under the `## Acceptance criteria` heading, up to
 * the next `^#{1,3} ` heading (or end of document). The heading match is
 * case-insensitive on the phrase "acceptance criteria" and tolerates any of
 * `#`/`##`/`###`. Returns `""` if no such heading exists.
 * @param {string} body
 * @returns {string}
 */
export function extractAcSection(body) {
  const lines = String(body).split(/\r?\n/);
  const headingRe = /^#{1,3}\s+/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i]) && /acceptance\s+criteria/i.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return "";
  const collected = [];
  for (let i = start; i < lines.length; i++) {
    if (headingRe.test(lines[i])) break;
    collected.push(lines[i]);
  }
  return collected.join("\n");
}

/**
 * Extract deduped repo-path-like tokens from text. Candidates match
 * `(?:seg/)+seg`; each is stripped of surrounding backticks / parens / angle
 * brackets and trailing punctuation, then KEPT only if "meaningful": the final
 * segment has a file extension (`/\.[A-Za-z0-9]+$/`) OR the token contains ≥2
 * `/` separators. This keeps `apps/docs/content/skills/run-wrap/SKILL.md`,
 * `tools/gh/dispatch-probe.mjs`, and `tools/lint/guard-tests` while dropping
 * prose like `and/or` or a bare `tools/`.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathTokens(text) {
  const out = [];
  const seen = new Set();
  const candidateRe = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g;
  for (const m of String(text).matchAll(candidateRe)) {
    // Strip surrounding backticks/parens/brackets and trailing punctuation.
    let tok = m[0].replace(/^[`('"<[]+/, "").replace(/[`)'">\].,;:]+$/, "");
    if (!tok) continue;
    const slashes = (tok.match(/\//g) ?? []).length;
    const hasExt = /\.[A-Za-z0-9]+$/.test(tok.split("/").pop() ?? "");
    if (!hasExt && slashes < 2) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** Normalize brief text for substring coverage: drop backticks, collapse whitespace. */
function normalizeForCoverage(text) {
  return String(text).replace(/`/g, "").replace(/\s+/g, " ");
}

/**
 * For each path token, report whether the brief text names it.
 * Coverage = the normalized brief contains the token as a substring, so a dir
 * token (`tools/lint/guard-tests`) is covered by a brief naming a file beneath
 * it (`tools/lint/guard-tests/dispatch-brief-check.spec.ts`).
 * @param {string[]} pathTokens
 * @param {string} briefText
 * @returns {{path: string, covered: boolean}[]}
 */
export function checkCoverage(pathTokens, briefText) {
  const haystack = normalizeForCoverage(briefText);
  return pathTokens.map((path) => ({
    path,
    covered: haystack.includes(normalizeForCoverage(path)),
  }));
}

/** Default runner — real `gh` via spawnSync (Windows-safe: gh is an exe on PATH). */
export function defaultRunner() {
  const run = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (res.error)
      throw new Error(`failed to spawn ${cmd}: ${res.error.message}`);
    return {
      status: res.status ?? 1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  };
  return { gh: (args) => run("gh", args) };
}

/**
 * Fetch the Issue body, extract its AC surfaces, and check them against the
 * brief text. The injectable `runner` seam is what the end-to-end test drives.
 * @param {{issueNumber: number|string, briefText: string, runner: {gh: Function}}} args
 * @returns {{rows: {path: string, covered: boolean}[], missing: number}}
 */
export function verifyBrief({ issueNumber, briefText, runner }) {
  const res = runner.gh(["issue", "view", String(issueNumber), "--json", "body"]);
  if (res.status !== 0) {
    throw new Error(
      `gh issue view ${issueNumber} failed (status ${res.status}): ${
        res.stderr?.trim() || "no stderr"
      }`,
    );
  }
  let body;
  try {
    body = String(JSON.parse(res.stdout).body ?? "");
  } catch (e) {
    throw new Error(`could not parse gh JSON for issue ${issueNumber}: ${e.message}`, {
      cause: e,
    });
  }
  const tokens = extractPathTokens(extractAcSection(body));
  const rows = checkCoverage(tokens, briefText);
  return { rows, missing: rows.filter((r) => !r.covered).length };
}

function usage() {
  process.stderr.write(
    "Usage: pnpm dispatch:brief-check <issue-N> <brief-file>   (or pipe the brief via stdin)\n",
  );
  process.exit(2);
}

function main() {
  const issueArg = process.argv[2];
  const fileArg = process.argv[3];
  if (!issueArg || !/^\d+$/.test(issueArg)) usage();

  let briefText;
  try {
    if (fileArg) {
      briefText = readFileSync(fileArg, "utf8");
    } else if (!process.stdin.isTTY) {
      briefText = readFileSync(0, "utf8"); // fd 0 read works on Windows too
    } else {
      usage();
    }
  } catch (e) {
    process.stderr.write(`[dispatch:brief-check] cannot read brief: ${e.message}\n`);
    process.exit(2);
  }

  let result;
  try {
    result = verifyBrief({
      issueNumber: issueArg,
      briefText,
      runner: defaultRunner(),
    });
  } catch (e) {
    process.stderr.write(`[dispatch:brief-check] ${e.message}\n`);
    process.exit(2);
  }

  const { rows, missing } = result;
  if (rows.length === 0) {
    process.stdout.write(
      `[dispatch:brief-check] #${issueArg}: no path-like AC surfaces to check — nothing to verify.\n`,
    );
    process.exit(0);
  }

  for (const r of rows)
    process.stdout.write(`${r.covered ? "PASS" : "MISSING"} ${r.path}\n`);
  const pass = rows.length - missing;
  process.stdout.write(
    `[dispatch:brief-check] ${rows.length} path(s): ${pass} PASS, ${missing} MISSING — ${
      missing > 0
        ? "the brief omits AC surface(s); name them before dispatching."
        : "OK"
    }\n`,
  );
  process.exit(missing > 0 ? 1 : 0);
}

// Run main only when invoked directly, so the pure functions can be imported
// in tests. `pathToFileURL` yields canonical `file:///C:/…` on Windows too.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
