#!/usr/bin/env node
/**
 * tools/gh/pr-land.mjs — `pnpm pr:land <N>` — one-command PR closeout tail
 * (#1026): merge gate → squash-merge → board Status=Done → worktree teardown →
 * re-sweep.
 *
 * Why: the post-merge tail (board Done, worktree teardown, branch/PR re-sweep)
 * is a multi-command sequence run by hand after every merge, and the audit
 * trail shows its steps are the most-forgotten part of the lifecycle
 * (AGENTS.md §6 "PR lifecycle runs to completion"). This wrapper makes the
 * whole tail ONE deterministic command, without weakening any gate semantics:
 *
 *   1. gate       — spawns `tools/gh/merge-gate.mjs <N>` (the single sanctioned
 *                   pre-merge gate, #836/#992) as its OWN statement and applies
 *                   the same barrier `merge-when-green.mjs` uses (its exported
 *                   `shouldMerge` seam, #928): any non-zero gate exit aborts —
 *                   no merge is attempted. Extra flags (incl. the loud
 *                   `--mode-a-exempt "<reason>"`) are forwarded verbatim.
 *   2. merge      — `gh pr merge <N> --squash --delete-branch` (the single
 *                   mandatory Phase-0 merge command, AGENTS.md §6).
 *   2b.board-clear— remove the merged PR's OWN board row (dead PR rows auto-leave
 *                   the board; `Closes #N` moves the linked Issue, never the PR
 *                   item). NON-FATAL: a failure is a reported line, not an abort
 *                   — the merge already landed (#1140).
 *   3. board-done — board Status=Done for each linked `Closes #N` Issue via
 *                   `tools/gh/set-board-status.mjs` (Closes closes the Issue
 *                   but never moves the Projects v2 column). No linked Issue →
 *                   loud SKIP, never silent.
 *   4. teardown   — `tools/dev/worktree-teardown.mjs <N>` iff
 *                   `.claude/worktrees/<N>` exists (candidates: linked Issue
 *                   numbers + the `<prefix>/<N>-<slug>` branch number). No
 *                   worktree on disk → loud SKIP.
 *   5. re-sweep   — `gh pr list` + `git ls-remote --heads origin`, printed as
 *                   one compact summary line (bot branches like
 *                   `changeset-release/main` can appear post-merge).
 *
 * Exit-code discipline: every stage is its own spawn (argv arrays — no shell,
 * no pipe, memory `feedback_no_pipe_exit_significant_commands`); the first
 * non-zero stage stops the tail immediately, prints the stage name + a
 * one-line remedy, and exits non-zero (the failing stage's own code where it
 * has one). Like merge-gate/merge-when-green, it refuses to run from a
 * worktree cwd (exit 4) — this is a lead-side, MAIN-tree command.
 *
 * Usage:
 *   node tools/gh/pr-land.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>] [--mode-a-exempt "<reason>"]
 *   pnpm pr:land <pr#>                                   # alias
 *
 * Exit codes: 0 = full tail complete; on a failed stage, that stage's exit
 * code (gate: 1 RED / 2 TIMEOUT / 4 refusal; merge/board/teardown/sweep: the
 * child's code, 1 when the child had none); 3 = usage / context-resolution /
 * spawn error; 4 = worktree-cwd refusal.
 *
 * Canon: AGENTS.md §4 + §6, skill `merge-when-green`, Issue #1026.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildDeleteItemMutation,
  buildPrProjectItemsQuery,
  ghGraphqlResult,
  pickProjectItem,
} from "./lib/projects-v2.mjs";
import {
  cwdGuardMessage,
  isWorktreeCwd,
  parseModeAExempt,
} from "./merge-gate.mjs";
import { shouldMerge } from "./merge-when-green.mjs";

const TAG = "[pr:land]";
const GH_MAX_BUFFER = 64 * 1024 * 1024; // large payloads overflow the 1 MiB default (#315).

// ── pure seams (unit-tested in guard-tests/pr-land.spec.ts) ──────────────────

/**
 * Canonical stage order — the contract the spec asserts (#1026 AC; `board-clear`
 * added #1140). `board-clear` is the one NON-FATAL stage: it removes the merged
 * PR's OWN board row (so dead PR rows auto-leave the board), and any failure is a
 * reported closeout-tail line, never an abort — the merge has already landed.
 */
export const STAGES = [
  "gate",
  "merge",
  "board-clear",
  "board-done",
  "teardown",
  "re-sweep",
];

/**
 * Candidate Issue/worktree numbers for the tail: the PR's linked `Closes #N`
 * issue numbers plus the `<prefix>/<N>-<slug>` number from the branch name
 * (worktrees are keyed by Issue number — repo-conventions → Branches).
 * Deduped, order-preserving; invalid entries dropped.
 * @param {(number|null|undefined)[]|null|undefined} closingIssueNumbers
 * @param {string|null|undefined} branch
 * @returns {number[]}
 */
export function issueCandidates(closingIssueNumbers, branch) {
  const out = [];
  const push = (n) => {
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  };
  for (const n of Array.isArray(closingIssueNumbers) ? closingIssueNumbers : [])
    push(n);
  const m = /^[a-z]+\/(\d+)-/.exec(branch ?? "");
  if (m) push(Number(m[1]));
  return out;
}

/**
 * One-line remedy per stage — printed on the first non-zero stage so the
 * operator knows exactly how to finish the tail by hand (#1026 AC).
 * @param {string} stage
 * @param {number} pr
 * @returns {string}
 */
export function stageRemedy(stage, pr) {
  switch (stage) {
    case "gate":
      return `investigate the gate's terminal RED/TIMEOUT line above; do NOT merge (re-run \`pnpm pr:land ${pr}\` once resolved).`;
    case "merge":
      return `inspect the gh output above, then re-run \`pnpm pr:land ${pr}\` (the gate re-confirms before any retry merges).`;
    case "board-clear":
      return `merge landed — the merged PR's board row was NOT removed (non-fatal); delete it by hand from the board if it lingers as a dead row.`;
    case "board-done":
      return `merge landed — finish by hand: \`pnpm board:status <issue> Done\`, then \`pnpm worktree:teardown <N>\` if a worktree remains.`;
    case "teardown":
      return `merge landed — finish by hand: \`pnpm worktree:teardown <N>\` (its output above names the holder), then re-sweep \`gh pr list\` + \`git ls-remote --heads origin\`.`;
    case "re-sweep":
      return `merge landed — re-run the sweep by hand: \`gh pr list\` + \`git ls-remote --heads origin\`.`;
    default:
      return `re-run \`pnpm pr:land ${pr}\`.`;
  }
}

/**
 * Normalize a child exit status to this tool's non-zero exit: a numeric
 * non-zero status propagates unchanged; 0/null/undefined (a signal-killed
 * child must NEVER read as success, #978) collapse to 1.
 * @param {number|null|undefined} status
 * @returns {number}
 */
export function failCode(status) {
  return typeof status === "number" && status !== 0 ? status : 1;
}

// ── default (impure) runners — injectable so the guard-test stubs them ───────

/** Stage 1: the sanctioned merge gate, streamed, own statement. */
function runGate(pr, extraArgs) {
  return spawnSync("node", ["tools/gh/merge-gate.mjs", String(pr), ...extraArgs], {
    stdio: "inherit",
  });
}

/** Stage 2: the single mandatory Phase-0 merge command, streamed. */
function runMerge(pr) {
  return spawnSync(
    "gh",
    ["pr", "merge", String(pr), "--squash", "--delete-branch"],
    { stdio: "inherit" },
  );
}

/**
 * Pre-gate context resolution: linked Closes-issues + head branch (resolved
 * BEFORE the merge — `--delete-branch` erases the branch afterwards).
 */
function runResolveContext(pr) {
  const res = spawnSync(
    "gh",
    [
      "pr",
      "view",
      String(pr),
      "--json",
      "closingIssuesReferences,headRefName",
    ],
    { encoding: "utf8", maxBuffer: GH_MAX_BUFFER },
  );
  if (res.error)
    return { ok: false, message: `failed to spawn gh: ${res.error.message}` };
  if (res.status !== 0)
    return {
      ok: false,
      message: `gh pr view ${pr} failed — is '${pr}' an open PR number? ${(res.stderr ?? "").trim()}`,
    };
  try {
    const parsed = JSON.parse(res.stdout);
    return {
      ok: true,
      issues: (parsed.closingIssuesReferences ?? []).map((r) => r?.number),
      branch: parsed.headRefName ?? null,
    };
  } catch {
    return { ok: false, message: `could not parse gh pr view JSON for #${pr}` };
  }
}

/** Post-merge: the merged commit SHA for the report (best-effort). */
function runMergedSha(pr) {
  const res = spawnSync(
    "gh",
    ["pr", "view", String(pr), "--json", "mergeCommit"],
    { encoding: "utf8", maxBuffer: GH_MAX_BUFFER },
  );
  if (res.error || res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout)?.mergeCommit?.oid ?? null;
  } catch {
    return null;
  }
}

/**
 * Board-clear stage (#1140): remove the merged PR's OWN board row so dead PR
 * rows auto-leave the board (an open-PR board row lingers as a stale "in review"
 * item after merge — `Closes #N` moves the linked ISSUE, never the PR item).
 * TWO targeted GraphQL calls (per-PR resolve → delete) via the shared plumbing —
 * no board-wide scan. Returns a structured result; NEVER throws / exits — the
 * caller treats every non-`deleted` outcome as a non-fatal reported line.
 * @param {number} pr
 * @returns {{status:"deleted"|"absent"|"error", detail?:string}}
 */
function runClearPrBoardItem(pr) {
  const resolved = ghGraphqlResult(buildPrProjectItemsQuery(pr));
  if (!resolved.ok) return { status: "error", detail: resolved.error };
  const nodes = resolved.data?.repository?.pullRequest?.projectItems?.nodes;
  const item = pickProjectItem(nodes);
  if (!item?.id || !item.project?.id) return { status: "absent" };
  const deleted = ghGraphqlResult(
    buildDeleteItemMutation(item.project.id, item.id),
  );
  if (!deleted.ok) return { status: "error", detail: deleted.error };
  return { status: "deleted", detail: item.id };
}

/** Stage 3: board Status=Done via the sanctioned setter, streamed. */
function runBoardDone(issue) {
  return spawnSync(
    "node",
    ["tools/gh/set-board-status.mjs", String(issue), "Done"],
    { stdio: "inherit" },
  );
}

/** Stage 4 probe: worktree dir presence under the MAIN tree (cwd is main — the worktree-cwd guard ran first). */
function defaultWorktreeExists(n) {
  return existsSync(join(process.cwd(), ".claude", "worktrees", String(n)));
}

/** Stage 4: the sanctioned long-path-safe teardown, streamed. */
function runTeardown(n) {
  return spawnSync("node", ["tools/dev/worktree-teardown.mjs", String(n)], {
    stdio: "inherit",
  });
}

/** Stage 5a: open-PR count. */
function runListOpenPrs() {
  const res = spawnSync("gh", ["pr", "list", "--json", "number"], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error || res.status !== 0)
    return { status: failCode(res.status), count: null };
  try {
    return { status: 0, count: JSON.parse(res.stdout).length };
  } catch {
    return { status: 1, count: null };
  }
}

/** Stage 5b: remote head-branch count. */
function runListRemoteBranches() {
  const res = spawnSync("git", ["ls-remote", "--heads", "origin"], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error || res.status !== 0)
    return { status: failCode(res.status), count: null };
  const count = res.stdout.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  return { status: 0, count };
}

// ── orchestration (unit-tested with injected runners) ────────────────────────

/**
 * Run the five-stage closeout tail. Each stage is its own injected runner
 * invocation (own statement — never a pipe); the first non-zero stage aborts
 * with its name + a one-line remedy and a non-zero exit. Runners are
 * injectable so the guard-test drives every branch without subprocesses
 * (mirrors merge-when-green.mjs).
 *
 * @param {number} pr
 * @param {string[]} extraArgs  flags forwarded verbatim to the gate
 * @param {{
 *   gate?: typeof runGate, merge?: typeof runMerge,
 *   resolveContext?: typeof runResolveContext, mergedSha?: typeof runMergedSha,
 *   clearBoardItem?: typeof runClearPrBoardItem,
 *   boardDone?: typeof runBoardDone, worktreeExists?: typeof defaultWorktreeExists,
 *   teardown?: typeof runTeardown, listOpenPrs?: typeof runListOpenPrs,
 *   listRemoteBranches?: typeof runListRemoteBranches,
 *   exit?: (code: number) => never, log?: (msg: string) => void, err?: (msg: string) => void,
 * }} [io]
 * @returns {never}
 */
export function landPr(pr, extraArgs = [], io = {}) {
  const gate = io.gate ?? runGate;
  const merge = io.merge ?? runMerge;
  const resolveContext = io.resolveContext ?? runResolveContext;
  const mergedSha = io.mergedSha ?? runMergedSha;
  const clearBoardItem = io.clearBoardItem ?? runClearPrBoardItem;
  const boardDone = io.boardDone ?? runBoardDone;
  const worktreeExists = io.worktreeExists ?? defaultWorktreeExists;
  const teardown = io.teardown ?? runTeardown;
  const listOpenPrs = io.listOpenPrs ?? runListOpenPrs;
  const listRemoteBranches = io.listRemoteBranches ?? runListRemoteBranches;
  const exit = io.exit ?? ((code) => process.exit(code));
  const log = io.log ?? ((msg) => process.stdout.write(msg));
  const err = io.err ?? ((msg) => process.stderr.write(`${TAG} ${msg}\n`));

  /** Compact single-screen report — one line per stage. */
  const report = [];
  const printReport = () => {
    log(`${TAG} ── closeout tail for PR #${pr} ──\n`);
    for (const line of report) log(`${TAG}   ${line}\n`);
  };
  const fail = (stage, code, detail) => {
    report.push(`${stage}: FAIL${detail ? ` (${detail})` : ""}`);
    printReport();
    err(
      `stage '${stage}' FAILED for PR #${pr}${detail ? ` — ${detail}` : ""}. Remedy: ${stageRemedy(stage, pr)}`,
    );
    return exit(failCode(code));
  };

  // Pre-gate context resolution (branch + linked issues) — the merge deletes
  // the branch, so this must run first. A resolution failure is a usage-class
  // error (exit 3): nothing has been gated or merged yet.
  const ctx = resolveContext(pr);
  if (!ctx.ok) {
    err(`could not resolve PR #${pr} context — ${ctx.message}`);
    return exit(3);
  }
  const issues = (ctx.issues ?? []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );

  // Stage 1 — merge gate, own statement; the #928 barrier via shouldMerge.
  const gateRes = gate(pr, extraArgs);
  if (gateRes.error)
    return fail("gate", 3, `failed to spawn the merge gate: ${gateRes.error.message}`);
  if (!shouldMerge(gateRes.status))
    return fail("gate", gateRes.status, `gate exit ${gateRes.status} — not GREEN`);
  report.push("gate: OK (GREEN, Mode-a pinned)");

  // Stage 2 — the single mandatory Phase-0 merge command, own statement.
  const mergeRes = merge(pr);
  if (mergeRes.error)
    return fail("merge", 3, `failed to spawn gh pr merge: ${mergeRes.error.message}`);
  if (mergeRes.status !== 0) return fail("merge", mergeRes.status);
  const sha = mergedSha(pr);
  report.push(`merge: OK (squash${sha ? `, ${String(sha).slice(0, 12)}` : ""})`);

  // Stage — board-clear: remove the merged PR's OWN board row so dead PR rows
  // auto-leave. NON-FATAL by contract (#1140 AC): the merge has already landed,
  // so a resolve/delete failure is a reported line, never an abort. Runs before
  // board-done (which moves the linked ISSUE, a different board item).
  const clearRes = clearBoardItem(pr);
  if (clearRes.status === "deleted")
    report.push(`board-clear: OK (PR row removed)`);
  else if (clearRes.status === "absent")
    report.push("board-clear: SKIP (PR not on the board)");
  else
    report.push(
      `board-clear: WARN (non-fatal — ${clearRes.detail ?? "unknown error"}); ${stageRemedy("board-clear", pr)}`,
    );

  // Stage 3 — board Status=Done for each linked Closes-issue.
  if (issues.length === 0) {
    report.push("board-done: SKIP (no linked Closes #N issue on the PR)");
  } else {
    for (const issue of issues) {
      const res = boardDone(issue);
      if (res.error)
        return fail("board-done", 3, `failed to spawn set-board-status: ${res.error.message}`);
      if (res.status !== 0) return fail("board-done", res.status, `issue #${issue}`);
    }
    report.push(`board-done: OK (#${issues.join(", #")} → Done)`);
  }

  // Stage 4 — worktree teardown iff `.claude/worktrees/<N>` exists.
  const candidates = issueCandidates(issues, ctx.branch);
  const present = candidates.filter((n) => worktreeExists(n));
  if (present.length === 0) {
    report.push(
      `teardown: SKIP (no .claude/worktrees/{${candidates.join(",") || "-"}} on disk)`,
    );
  } else {
    for (const n of present) {
      const res = teardown(n);
      if (res.error)
        return fail("teardown", 3, `failed to spawn worktree-teardown: ${res.error.message}`);
      if (res.status !== 0)
        return fail("teardown", res.status, `.claude/worktrees/${n}`);
    }
    report.push(`teardown: OK (.claude/worktrees/{${present.join(",")}})`);
  }

  // Stage 5 — re-sweep: open PRs + remote head branches, one summary line.
  const prs = listOpenPrs();
  if (prs.status !== 0) return fail("re-sweep", prs.status, "gh pr list failed");
  const branches = listRemoteBranches();
  if (branches.status !== 0)
    return fail("re-sweep", branches.status, "git ls-remote --heads origin failed");
  report.push(
    `re-sweep: OK (${prs.count} open PR(s), ${branches.count} remote head branch(es))`,
  );

  printReport();
  log(`${TAG} closeout tail COMPLETE for PR #${pr}.\n`);
  return exit(0);
}

// ── impure CLI (skipped on import) ───────────────────────────────────────────

function die(msg, code = 3) {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(code);
}

function main() {
  const args = process.argv.slice(2);
  const rawPr = args[0];
  const prNumber = Number(rawPr);
  if (!rawPr || !Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(
      'Usage: node tools/gh/pr-land.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>] [--mode-a-exempt "<reason>"]\n',
    );
    process.exit(3);
  }
  const extraArgs = args.slice(1);

  // Loudly surface a Mode-a exemption at THIS level too — the gate prints its
  // own audit line, but the forwarding must never be silent (#1026 brief).
  const exempt = parseModeAExempt(extraArgs);
  if (exempt.error) die(exempt.error);
  if (exempt.exempt) {
    process.stdout.write(
      `${TAG} forwarding --mode-a-exempt to the merge gate: ${exempt.reason} ` +
        `(sanctioned no-Mode-a classes only — AGENTS.md §3.8).\n`,
    );
  }

  // Lead-side, MAIN-tree command: refuse from a worktree cwd (mirrors
  // merge-gate/merge-when-green, exit 4) BEFORE any stage runs.
  const cwd = process.cwd();
  if (isWorktreeCwd(cwd)) die(cwdGuardMessage(cwd), 4);

  landPr(prNumber, extraArgs);
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors merge-gate.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
