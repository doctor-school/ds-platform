#!/usr/bin/env node
/**
 * tools/gh/merge-gate.mjs — deterministic Phase-0 pre-merge gate (#836).
 *
 * Why: session 29f490ed hit two `prose-not-enforced` gaps at the merge decision
 * point. (1) A `gh pr checks --watch` launched ~90s after a push saw ZERO
 * registered check-runs for the new head SHA and read as green — "no failures
 * found" with zero runs is a FAIL, not a green; the grep pattern used was also
 * name-collision-prone (a job named `submit-pending` matches "pending"). (2)
 * Merges were attempted from a worktree cwd — `gh pr merge --delete-branch`
 * failed twice (`'main' is already used by worktree`), a caveat documented in
 * skill `merge-when-green` that nothing enforced at run time.
 *
 * This gate is the single sanctioned mechanical pre-merge form (skill
 * `merge-when-green` Step 1; invoked by `pnpm pr:preflight <N> --pre-merge`):
 *
 *   1. Worktree-cwd guard — refuses to run from a cwd inside
 *      `.claude/worktrees/*`, and refuses while the PR branch is checked out in
 *      a registered worktree (teardown BEFORE `--delete-branch`).
 *   2. Checks-registered gate — resolves the PR head SHA and polls the
 *      check-runs API for THAT exact SHA. Zero registered runs after the
 *      registration window (fresh-push race) = RED. Green requires run count
 *      > 0 with every non-skipped run terminal-successful.
 *   3. Structured status parsing — verdicts come from the `status`/`conclusion`
 *      fields of `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`, never
 *      from substring-matching check NAMES.
 *   4. Head pinning — after a green board the head SHA is re-resolved; a head
 *      that moved mid-poll (force-push, new commit) is RED, not green.
 *   5. Mode-a verdict gate (#992) — requires a head-SHA-pinned Mode (a)
 *      APPROVE: the latest PR review whose body opens `## Mode (a) Review` and
 *      carries a `VERDICT:` line must be APPROVE, and its native `commit_id`
 *      (the head the reviewer submitted against) must equal the CURRENT head
 *      SHA — a rework invalidates the verdict. Sanctioned no-Mode-a classes
 *      (AGENTS.md §3.8: pure docs / test-only / generated-regen; the Version
 *      Packages bot PR) skip the check ONLY via an explicit, loudly-printed
 *      `--mode-a-exempt "<reason>"` — no silent auto-detection.
 *
 * Bounded FOREGROUND poll with a mandatory terminal GREEN/RED/TIMEOUT line
 * (CLAUDE.md → checkpoint rule for CI waits; retro 85170286).
 *
 * Usage:
 *   node tools/gh/merge-gate.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>] [--mode-a-exempt "<reason>"]
 *   pnpm merge:gate <pr#>                                # alias
 *
 * Exit codes: 0 = GREEN (ok to merge); 1 = RED (failed/cancelled run, zero
 * registered runs, head moved, or missing/stale/negative Mode-a verdict);
 * 2 = TIMEOUT (still pending at deadline); 3 = usage / gh-spawn error;
 * 4 = worktree guard refusal.
 *
 * Canon: AGENTS.md §4, skill `merge-when-green` Step 1, memory
 * `feedback_phase0_merge_gate_manual`. Issue #836.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_SEC = 900; // 15 min — comfortably above a full CI run.
const DEFAULT_INTERVAL_SEC = 15;
const DEFAULT_REG_TIMEOUT_SEC = 180; // window for check-runs to REGISTER on a fresh push.
const GH_MAX_BUFFER = 64 * 1024 * 1024; // large boards overflow the 1 MiB default (#315).
const TAG = "[merge:gate]";

// ── pure seams (unit-tested in guard-tests/merge-gate.spec.ts) ──────────────

/**
 * Parse an ISO timestamp to epoch-ms; a missing/blank/invalid value sorts
 * OLDEST (`-Infinity`) so a run with no timestamp never wins its name group.
 * @param {string|null|undefined} v
 * @returns {number}
 */
function runTimeMs(v) {
  if (!v) return -Infinity;
  const t = Date.parse(v);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * True when run `a` (at array index `ai`) is NEWER than run `b` (at index
 * `bi`) for its name group. Ordering:
 *   1. running-ness — a non-`completed` (in_progress/queued) run outranks a
 *      completed same-name predecessor. A PR-body edit re-triggers a body
 *      guard on the SAME head SHA; the fresh in-flight run must WIN so the
 *      board still reads `pending`, never a premature green off the stale
 *      completed run (#960 review).
 *   2. `started_at` desc — of two runs in the same running-state, the one that
 *      started later is newer (the re-run).
 *   3. `completed_at` desc — tie-break for two completed runs that share a
 *      start time (the #955 superseded-cancelled→success case).
 *   4. numeric `id` desc, else later array position wins.
 * Missing timestamps sort oldest (`-Infinity`).
 */
function runIsNewer(a, ai, b, bi) {
  const aRunning = a?.status !== "completed";
  const bRunning = b?.status !== "completed";
  if (aRunning !== bRunning) return aRunning;
  const as = runTimeMs(a?.started_at);
  const bs = runTimeMs(b?.started_at);
  if (as !== bs) return as > bs;
  const ac = runTimeMs(a?.completed_at);
  const bc = runTimeMs(b?.completed_at);
  if (ac !== bc) return ac > bc;
  const aid = typeof a?.id === "number" ? a.id : null;
  const bid = typeof b?.id === "number" ? b.id : null;
  if (aid !== null && bid !== null && aid !== bid) return aid > bid;
  return ai > bi;
}

/**
 * Dedupe a check-runs array to the NEWEST run per distinct `name`. GitHub keeps
 * BOTH a superseded `cancelled` run and its `success` re-run on the same head
 * SHA forever (a PR-body edit re-triggers the body guards via a concurrency
 * group that cancels the in-flight run; a `success` run replaces it ~40s
 * later). Counting the stale `cancelled` run as blocking made `merge:gate`
 * report a permanent RED on a genuinely-green PR (#955). Grouping to the latest
 * run per name before classification drops the superseded runs; a `cancelled`
 * run that IS the newest for its name still surfaces (genuinely aborted).
 *
 * @param {{name?: string, status?: string, conclusion?: string|null, started_at?: string|null, completed_at?: string|null, id?: number}[]|null|undefined} runs
 * @returns {{name?: string, status?: string, conclusion?: string|null}[]}
 */
export function latestRunsByName(runs) {
  if (!Array.isArray(runs)) return [];
  const latest = new Map(); // name -> {run, idx}
  runs.forEach((run, idx) => {
    const name = run?.name ?? "<unnamed>";
    const prev = latest.get(name);
    if (!prev || runIsNewer(run, idx, prev.run, prev.idx)) {
      latest.set(name, { run, idx });
    }
  });
  return [...latest.values()].map((e) => e.run);
}

/**
 * Classify the check-runs board for one commit SHA. Reads ONLY the structured
 * `status` / `conclusion` fields (GitHub check-runs API) — run NAMES never
 * influence the verdict (a job named `submit-pending` must not read as
 * pending; retro 29f490ed F1). Superseded runs are dropped first via
 * `latestRunsByName` (#955), so only the newest run per name is classified.
 *
 * States:
 *   - `empty`   — zero registered runs. NEVER green: a fresh-push race where
 *                 the watcher starts before CI registers reads exactly like
 *                 this, and "no failures found" with zero runs is a FAIL.
 *   - `red`     — any run completed with a conclusion other than
 *                 `success`/`skipped` (failure, cancelled, timed_out,
 *                 action_required, neutral, stale — the gate is strict).
 *                 Red is fail-fast: it wins even while other runs are pending.
 *   - `pending` — no red, but at least one run not yet `completed`.
 *   - `green`   — run count > 0 and every non-skipped run is
 *                 terminal-successful (`completed` + `success`); `skipped`
 *                 runs are non-blocking (drift jobs skip on unrelated diffs).
 *
 * @param {{name?: string, status?: string, conclusion?: string|null}[]|null|undefined} runs
 * @returns {{state: "empty"|"red"|"pending"|"green", red: string[], pending: string[]}}
 */
export function classifyCheckRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { state: "empty", red: [], pending: [] };
  }
  // Drop superseded runs so only the newest run per name is classified (#955).
  const latest = latestRunsByName(runs);
  const red = latest
    .filter(
      (r) =>
        r.status === "completed" &&
        r.conclusion !== "success" &&
        r.conclusion !== "skipped",
    )
    .map((r) => r.name ?? "<unnamed>");
  const pending = latest
    .filter((r) => r.status !== "completed")
    .map((r) => r.name ?? "<unnamed>");
  if (red.length > 0) return { state: "red", red, pending };
  if (pending.length > 0) return { state: "pending", red, pending };
  return { state: "green", red, pending };
}

/**
 * True when `cwd` lies inside a `.claude/worktrees/<slug>` checkout (either
 * separator style). The container dir itself (`.claude/worktrees`) is not a
 * worktree checkout.
 * @param {string} cwd
 */
export function isWorktreeCwd(cwd) {
  return /[\\/]\.claude[\\/]worktrees[\\/][^\\/]/.test(cwd);
}

/**
 * Extract the worktree slug (usually the Issue number) from a path inside
 * `.claude/worktrees/<slug>`, or null when the path is not inside one.
 * @param {string} p
 * @returns {string|null}
 */
export function worktreeNumber(p) {
  const m = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/.exec(p);
  return m ? m[1] : null;
}

/**
 * Actionable refusal message for a merge attempted from inside a worktree cwd.
 * Names the teardown command (`pnpm worktree:teardown <N>`) that must run
 * before `--delete-branch`'s local cleanup can succeed (retro 29f490ed F2).
 * @param {string} cwd
 */
export function cwdGuardMessage(cwd) {
  const n = worktreeNumber(cwd) ?? "<N>";
  return (
    `refusing to gate a merge from inside a worktree cwd (${cwd}). ` +
    `Merges run from the MAIN tree: exit the worktree (ExitWorktree / cd to the primary checkout), ` +
    `re-run the gate there, and tear the worktree down with \`pnpm worktree:teardown ${n}\` ` +
    `before relying on \`gh pr merge --delete-branch\` local cleanup ` +
    `(skill merge-when-green Step 2/2a).`
  );
}

/**
 * Find the registered worktree (from `git worktree list --porcelain` output)
 * that has `branch` checked out. Exact `branch refs/heads/<branch>` record
 * match only — never a substring match. Returns the worktree path or null.
 * @param {string} porcelain
 * @param {string} branch
 * @returns {string|null}
 */
export function findBranchWorktree(porcelain, branch) {
  let current = null;
  for (const line of (porcelain ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

/**
 * Assert a resolved `gh pr view` payload describes an OPEN pull request.
 *
 * `gh pr view <arg>` resolves a head SHA for a CLOSED or MERGED PR too, so
 * without this check the gate would poll that PR's stale check-runs and read
 * them as a fresh board — a silent semi-no-op at the merge decision point. An
 * ISSUE number instead makes `gh pr view` exit non-zero (caught upstream by the
 * `res.status !== 0` `die`), but the generic error does not say "this is not an
 * open PR". A DRAFT PR is still `OPEN` and therefore allowed. Only `state ===
 * "OPEN"` passes; anything else (`CLOSED`, `MERGED`, missing) is rejected with
 * an actionable message that names the arg (#963).
 *
 * @param {{state?: string, headRefOid?: string}} view
 * @param {string|number} arg  the CLI arg, echoed into the actionable message
 * @returns {{ok: boolean, message: string}}
 */
export function assertOpenPr(view, arg) {
  const state = view?.state;
  if (state === "OPEN") return { ok: true, message: "" };
  return {
    ok: false,
    message:
      `argument '${arg}' does not resolve to an OPEN pull request ` +
      `(state: ${state ?? "<unknown>"}). Pass the PR number of an OPEN PR, not an ` +
      `issue number — a closed/merged PR is also rejected because its check-runs ` +
      `are stale and gating them would be a silent no-op.`,
  };
}

/**
 * Actionable refusal message when the PR branch is checked out in a registered
 * worktree: `--delete-branch` cannot delete a branch a worktree holds — tear
 * the worktree down first.
 * @param {string} branch
 * @param {string} wtPath
 */
export function branchWorktreeMessage(branch, wtPath) {
  const n = worktreeNumber(wtPath);
  const teardown = n
    ? `pnpm worktree:teardown ${n}`
    : `node tools/dev/worktree-teardown.mjs ${wtPath}`;
  return (
    `branch '${branch}' is checked out in registered worktree ${wtPath} — ` +
    `\`gh pr merge --delete-branch\` cannot delete a branch a worktree holds. ` +
    `Tear it down first: \`${teardown}\` (long-path-safe), then re-run the gate.`
  );
}

/** A PR review counts as a Mode-a artifact only when its body opens with the
 * canonical header (skill `request-mode-a-review` → Output format)… */
const MODE_A_HEADER_RE = /^## Mode \(a\) Review/m;
/** …AND carries the mandatory structured verdict line. */
const MODE_A_VERDICT_RE = /^VERDICT:\s*(APPROVE|REQUEST_CHANGES)\b/m;

/**
 * Classify the Mode-a verdict state for one PR head SHA (#992).
 *
 * Input is the raw `GET /repos/{owner}/{repo}/pulls/{n}/reviews` array. Only
 * reviews whose body matches BOTH the `## Mode (a) Review` header and the
 * `VERDICT: <APPROVE|REQUEST_CHANGES>` line count — plain comments, human
 * drive-bys, and bot reviews are ignored. Of those, the LATEST by
 * `submitted_at` wins (a re-review supersedes its predecessor; missing
 * timestamps sort oldest, later array position breaks ties — GitHub returns
 * reviews in submission order).
 *
 * The deterministic head pin is the review's native `commit_id` — the head SHA
 * GitHub recorded when the reviewer ran `gh pr review` — so no verdict-format
 * change is needed: an APPROVE submitted against a superseded head is
 * `stale-approve`, never a pass (a rework invalidates the verdict).
 *
 * States (only `fresh-approve` passes the gate):
 *   - `no-verdict`      — no review matches the Mode-a artifact shape.
 *   - `request-changes` — the latest Mode-a verdict is REQUEST_CHANGES.
 *   - `stale-approve`   — latest is APPROVE but `commit_id !== headSha`.
 *   - `fresh-approve`   — APPROVE with `commit_id === headSha`.
 *
 * @param {{body?: string, commit_id?: string, submitted_at?: string|null}[]|null|undefined} reviews
 * @param {string} headSha
 * @returns {{state: "no-verdict"|"request-changes"|"stale-approve"|"fresh-approve", verdict: string|null, commitId: string|null, submittedAt: string|null}}
 */
export function classifyModeAVerdict(reviews, headSha) {
  const modeA = (Array.isArray(reviews) ? reviews : []).flatMap((r) => {
    const body = typeof r?.body === "string" ? r.body : "";
    if (!MODE_A_HEADER_RE.test(body)) return [];
    const m = MODE_A_VERDICT_RE.exec(body);
    if (!m) return [];
    return [
      {
        verdict: m[1],
        commitId: r?.commit_id ?? null,
        submittedAt: r?.submitted_at ?? null,
      },
    ];
  });
  if (modeA.length === 0) {
    return { state: "no-verdict", verdict: null, commitId: null, submittedAt: null };
  }
  // Latest Mode-a review wins; `>=` lets a later array position break ties.
  let latest = modeA[0];
  for (const cur of modeA.slice(1)) {
    if (runTimeMs(cur.submittedAt) >= runTimeMs(latest.submittedAt)) latest = cur;
  }
  if (latest.verdict === "REQUEST_CHANGES")
    return { state: "request-changes", ...latest };
  if (latest.commitId !== headSha) return { state: "stale-approve", ...latest };
  return { state: "fresh-approve", ...latest };
}

/**
 * Parse the explicit `--mode-a-exempt "<reason>"` escape flag (#992). The
 * sanctioned no-Mode-a merge classes (AGENTS.md §3.8: pure docs / test-only /
 * generated-regen; the Version Packages bot PR) skip the verdict gate ONLY via
 * this flag — a non-empty reason is mandatory (auditable, mirrors how
 * `--no-verify` demands a logged reason) and there is NO silent auto-detection.
 *
 * @param {string[]} args  raw CLI args
 * @returns {{exempt: boolean, reason: string|null, error?: string}}
 */
export function parseModeAExempt(args) {
  const i = (Array.isArray(args) ? args : []).indexOf("--mode-a-exempt");
  if (i === -1) return { exempt: false, reason: null };
  const raw = args[i + 1];
  if (typeof raw !== "string" || raw.trim() === "" || raw.startsWith("--")) {
    return {
      exempt: false,
      reason: null,
      error:
        '--mode-a-exempt requires a non-empty reason, e.g. --mode-a-exempt "pure docs — AGENTS.md §3.8 fast path"',
    };
  }
  return { exempt: true, reason: raw.trim() };
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

function die(msg, code = 3) {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Spawn gh, dying on spawn errors; returns {status, stdout, stderr}. */
function gh(args) {
  const res = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (res.error)
    die(
      `failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`,
    );
  return res;
}

/** Resolve the PR's head SHA + branch name; refuses a non-open-PR arg (#963). */
function resolveHead(prNumber) {
  const res = gh([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "headRefOid,headRefName,state",
  ]);
  if (res.status !== 0)
    die(
      `gh pr view ${prNumber} failed — is '${prNumber}' the number of an OPEN PR? ` +
        `(an issue number or unknown PR makes gh exit non-zero): ${(res.stderr ?? "").trim()}`,
    );
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh pr view ${prNumber}`);
    return; // unreachable — die() calls process.exit; satisfies control-flow analysis.
  }
  const { headRefOid, headRefName, state } = parsed;
  const open = assertOpenPr({ state, headRefOid }, prNumber);
  if (!open.ok) die(open.message);
  if (!headRefOid) die(`PR #${prNumber}: could not resolve head SHA`);
  return { sha: headRefOid, branch: headRefName };
}

/**
 * Fetch the check-runs registered for one exact commit SHA (structured
 * status/conclusion fields — the seam `classifyCheckRuns` consumes).
 */
function fetchCheckRuns(sha) {
  const res = gh([
    "api",
    `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
  ]);
  if (res.status !== 0)
    die(`gh api check-runs for ${sha} failed: ${(res.stderr ?? "").trim()}`);
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed.check_runs) ? parsed.check_runs : [];
  } catch {
    die(`could not parse gh api check-runs JSON for ${sha}`);
  }
}

/**
 * Fetch the PR's reviews (native `commit_id` = the head SHA each review was
 * submitted against — the pin `classifyModeAVerdict` consumes).
 */
function fetchReviews(prNumber) {
  const res = gh([
    "api",
    `repos/{owner}/{repo}/pulls/${prNumber}/reviews?per_page=100`,
  ]);
  if (res.status !== 0)
    die(
      `gh api reviews for PR #${prNumber} failed: ${(res.stderr ?? "").trim()}`,
    );
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    die(`could not parse gh api reviews JSON for PR #${prNumber}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rawPr = args[0];
  const prNumber = Number(rawPr);
  if (!rawPr || !Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(
      'Usage: node tools/gh/merge-gate.mjs <pr#> [--timeout <sec>] [--interval <sec>] [--reg-timeout <sec>] [--mode-a-exempt "<reason>"]\n',
    );
    process.exit(3);
  }
  const getOpt = (flag, dflt) => {
    const i = args.indexOf(flag);
    if (i === -1) return dflt;
    const v = Number(args[i + 1]);
    if (!Number.isFinite(v) || v <= 0) die(`invalid value for ${flag}`);
    return v;
  };
  const timeoutSec = getOpt("--timeout", DEFAULT_TIMEOUT_SEC);
  const intervalSec = getOpt("--interval", DEFAULT_INTERVAL_SEC);
  const regTimeoutSec = getOpt("--reg-timeout", DEFAULT_REG_TIMEOUT_SEC);
  const modeAExempt = parseModeAExempt(args);
  if (modeAExempt.error) die(modeAExempt.error);

  // 1. Worktree-cwd guard (retro 29f490ed F2).
  const cwd = process.cwd();
  if (isWorktreeCwd(cwd)) die(cwdGuardMessage(cwd), 4);

  // 2. Resolve the head SHA — every poll below is pinned to THIS commit.
  const { sha, branch } = resolveHead(prNumber);

  // 2a. Branch-in-worktree guard: --delete-branch cannot delete a branch a
  // registered worktree holds — instruct teardown BEFORE the merge.
  const wt = spawnSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (!wt.error && wt.status === 0) {
    const held = findBranchWorktree(wt.stdout, branch);
    if (held) die(branchWorktreeMessage(branch, held), 4);
  }

  // 2b. Mode-a verdict gate (#992) — fail fast BEFORE the CI poll: a merge
  // needs a Mode-a APPROVE pinned (via the review's native commit_id) to THIS
  // head SHA. If the head moves mid-poll, step 4's head pin goes RED anyway,
  // so a verdict fresh here stays fresh for any green this run can emit.
  const redispatch = `Dispatch (or re-dispatch) request-mode-a-review against the CURRENT head, or — ONLY for a sanctioned no-Mode-a class (AGENTS.md §3.8: pure docs / test-only / generated-regen; the Version Packages bot PR) — re-run with --mode-a-exempt "<reason>". Do NOT merge.`;
  if (modeAExempt.exempt) {
    process.stdout.write(
      `${TAG} MODE-A EXEMPT — verdict gate SKIPPED for PR #${prNumber}: ${modeAExempt.reason} ` +
        `(sanctioned classes only — AGENTS.md §3.8; this line is the audit record).\n`,
    );
  } else {
    const verdict = classifyModeAVerdict(fetchReviews(prNumber), sha);
    if (verdict.state === "no-verdict") {
      die(
        `RED — PR #${prNumber} head ${sha.slice(0, 12)}: no Mode (a) review verdict found ` +
          `(no PR review opens '## Mode (a) Review' with a VERDICT: line). ${redispatch}`,
        1,
      );
    }
    if (verdict.state === "request-changes") {
      die(
        `RED — PR #${prNumber} head ${sha.slice(0, 12)}: latest Mode (a) verdict is REQUEST_CHANGES ` +
          `(submitted ${verdict.submittedAt ?? "<unknown>"}). Address the findings, then re-dispatch. Do NOT merge.`,
        1,
      );
    }
    if (verdict.state === "stale-approve") {
      die(
        `RED — PR #${prNumber} head ${sha.slice(0, 12)}: latest Mode (a) APPROVE is STALE — reviewed at ` +
          `${(verdict.commitId ?? "<unknown>").slice(0, 12)}, but the head has since moved (a rework invalidates the verdict). ${redispatch}`,
        1,
      );
    }
    process.stdout.write(
      `${TAG} Mode-a verdict OK — PR #${prNumber}: APPROVE pinned at head ${sha.slice(0, 12)} (submitted ${verdict.submittedAt ?? "<unknown>"}).\n`,
    );
  }

  // 3. Bounded foreground poll against the pinned SHA.
  const start = Date.now();
  const regDeadline = start + regTimeoutSec * 1000;
  const deadline = start + timeoutSec * 1000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const runs = fetchCheckRuns(sha);
    const { state, red, pending } = classifyCheckRuns(runs);

    if (state === "green") {
      // 4. Head pinning: a green observed for a SHA that is no longer the PR
      // head (force-push / new commit mid-poll) is not a green for the merge.
      const now = resolveHead(prNumber);
      if (now.sha !== sha) {
        die(
          `RED — PR #${prNumber}: head moved during the poll (${sha.slice(0, 12)} → ${now.sha.slice(0, 12)}). Re-run the gate against the new head. Do NOT merge.`,
          1,
        );
      }
      process.stdout.write(
        `${TAG} GREEN — PR #${prNumber} head ${sha.slice(0, 12)}: ${runs.length} check-run(s) registered, all non-skipped terminal-successful (${attempt} poll(s)). OK to merge.\n`,
      );
      process.exit(0);
    }
    if (state === "red") {
      die(
        `RED — PR #${prNumber} head ${sha.slice(0, 12)}: ${red.length} check-run(s) not successful — ${red.join(", ")}. Do NOT merge.`,
        1,
      );
    }
    if (state === "empty" && Date.now() >= regDeadline) {
      die(
        `RED — PR #${prNumber} head ${sha.slice(0, 12)}: ZERO check-runs registered after ${regTimeoutSec}s (fresh-push race). Zero runs is a FAIL, not a green — verify CI triggered for this SHA. Do NOT merge.`,
        1,
      );
    }
    if (Date.now() >= deadline) {
      const stuck = state === "empty" ? ["<none registered>"] : pending;
      die(
        `TIMEOUT — PR #${prNumber} head ${sha.slice(0, 12)}: still not terminal after ${timeoutSec}s (${stuck.join(", ")}). Do NOT merge.`,
        2,
      );
    }
    process.stdout.write(
      `${TAG} PR #${prNumber} head ${sha.slice(0, 12)}: ${
        state === "empty"
          ? "no check-runs registered yet (waiting for registration)"
          : `${pending.length} pending (${pending.join(", ")})`
      }; re-poll in ${intervalSec}s…\n`,
    );
    await sleep(intervalSec * 1000);
  }
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors wait-ci-green.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
