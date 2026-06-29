#!/usr/bin/env node
/**
 * tools/gh/wait-ci-green.mjs — deterministic Phase-0 merge-gate wait step.
 *
 * Why: in Phase 0 the repo is GitHub Free + private, so there is NO server-side
 * required-checks gate — `gh pr merge --auto` merges the instant an approval
 * exists, even while CI is still pending (AGENTS.md §4, memory
 * `feedback_phase0_merge_gate_manual`). The real gate is therefore a MANUAL
 * "confirm every check is green by hand" step. Doing that with a hand-tuned
 * `for i in 1..8; do sleep 45; ...; done` foreground loop is fragile: the long
 * cumulative sleep trips the harness into backgrounding the command (#317). This
 * helper replaces that loop with one blocking command that polls the PR's checks
 * on a fixed interval and exits with a status the caller can branch on.
 *
 * Canon: AGENTS.md §4, skill `merge-when-green` step 1, memory
 * `feedback_phase0_merge_gate_manual`.
 *
 * Usage:
 *   node tools/gh/wait-ci-green.mjs <pr#> [--timeout <sec>] [--interval <sec>]
 *   pnpm ci:wait <pr#>                                    # alias
 *
 * Behaviour: polls `gh pr checks <pr#> --json name,bucket,state` every
 * <interval> seconds (default 20) until no check is `pending`, or until
 * <timeout> seconds elapse (default 900). A `skipping` / `cancel`-less, all-`pass`
 * board is green. `skipping` is treated as non-blocking (drift jobs skip on
 * unrelated diffs); any `fail` or `cancel` is a hard red.
 *
 * Exit codes: 0 = all checks resolved green (pass/skipping); 1 = at least one
 * check failed or was cancelled; 2 = timed out while still pending; 3 = usage /
 * gh-spawn error. (0 only on green; every non-green outcome is non-zero so the
 * caller can `&&`-chain the merge.)
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_SEC = 900; // 15 min — comfortably above a full CI run.
const DEFAULT_INTERVAL_SEC = 20;
const GH_MAX_BUFFER = 64 * 1024 * 1024; // large boards/checklists overflow the 1 MiB default (#315).

function die(msg, code = 3) {
  process.stderr.write(`[wait-ci-green] ${msg}\n`);
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pure classifier — decide the gate outcome from the parsed checks array.
 * Kept side-effect-free so the fail / pending / pass / empty branches are
 * unit-checkable without a live failing PR.
 *
 * @param {{bucket?: string}[]} checks
 * @returns {{ state: "green"|"red"|"pending", red: string[], pending: string[] }}
 */
export function classify(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    // No checks reported yet — treat as still-pending so we keep polling
    // (a freshly-opened PR has an empty board for a few seconds).
    return { state: "pending", red: [], pending: ["<no checks reported yet>"] };
  }
  const red = checks
    .filter((c) => c.bucket === "fail" || c.bucket === "cancel")
    .map((c) => c.name ?? "<unnamed>");
  const pending = checks
    .filter((c) => c.bucket === "pending")
    .map((c) => c.name ?? "<unnamed>");
  if (pending.length > 0) return { state: "pending", red, pending };
  if (red.length > 0) return { state: "red", red, pending };
  return { state: "green", red, pending };
}

/** Run `gh pr checks` and return the parsed JSON array (or null on a soft error). */
function pollChecks(prNumber) {
  // `gh pr checks` exits 8 while pending and non-zero on failure — that is data,
  // not a spawn error, so we read stdout regardless of res.status.
  const res = spawnSync(
    "gh",
    ["pr", "checks", String(prNumber), "--json", "name,bucket,state"],
    { encoding: "utf8", maxBuffer: GH_MAX_BUFFER },
  );
  if (res.error)
    die(
      `failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`,
    );
  const out = (res.stdout ?? "").trim();
  if (!out) {
    // gh prints "no checks reported on the 'X' branch" to stderr with empty
    // stdout when the board is empty — surface a non-fatal pending.
    if (/no checks reported/i.test(res.stderr ?? "")) return [];
    if (res.status !== 0 && res.status !== 8)
      die(`gh pr checks ${prNumber} failed: ${(res.stderr ?? "").trim()}`);
    return [];
  }
  try {
    return JSON.parse(out);
  } catch {
    die(`could not parse gh JSON output for: gh pr checks ${prNumber}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rawPr = args[0];
  const prNumber = Number(rawPr);
  if (!rawPr || !Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(
      "Usage: node tools/gh/wait-ci-green.mjs <pr#> [--timeout <sec>] [--interval <sec>]\n",
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

  const deadline = Date.now() + timeoutSec * 1000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const { state, red, pending } = classify(pollChecks(prNumber));

    if (state === "green") {
      process.stdout.write(
        `[wait-ci-green] PR #${prNumber}: all checks green (pass/skipping) after ${attempt} poll(s). OK to merge.\n`,
      );
      process.exit(0);
    }
    if (state === "red") {
      die(
        `PR #${prNumber}: ${red.length} check(s) failed/cancelled — ${red.join(", ")}. Do NOT merge.`,
        1,
      );
    }

    // pending
    if (Date.now() >= deadline) {
      die(
        `PR #${prNumber}: timed out after ${timeoutSec}s with ${pending.length} check(s) still pending — ${pending.join(", ")}.`,
        2,
      );
    }
    process.stdout.write(
      `[wait-ci-green] PR #${prNumber}: ${pending.length} pending (${pending.join(", ")}); re-poll in ${intervalSec}s…\n`,
    );
    await sleep(intervalSec * 1000);
  }
}

// Run main only when invoked directly, so `classify` can be imported in a test.
// `pathToFileURL` yields the canonical `file:///C:/…` form on Windows too;
// `process.argv[1]` is undefined under `node -e`/`--eval` (import-only), so guard it.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
