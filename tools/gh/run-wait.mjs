#!/usr/bin/env node
/**
 * tools/gh/run-wait.mjs — bounded foreground poll for a GitHub Actions run (#984).
 *
 * Why: the 2026-07-15 release-cycle session (retro b9d9314e, finding E) burned
 * the SHARED 5000/hr `gh` token with a hand-rolled `for i in 1..8; do gh run
 * view <id> --json … ; sleep` loop polling a `workflow_dispatch` run. CLAUDE.md's
 * bounded-poll rule covered PR-**checks** waits (`pnpm merge:gate`) but NOT
 * workflow-**run** polling. This is the missing deterministic gate for a single
 * run id: one bounded foreground poll, one terminal line, a non-zero exit on
 * anything but SUCCESS.
 *
 * Structurally mirrors `tools/gh/merge-gate.mjs`: pure classifier seams at the
 * top (unit-tested in guard-tests/run-wait.spec.ts), the impure CLI `main()` at
 * the bottom guarded by the entry-point check so the seams import without firing
 * subprocesses.
 *
 * Classification reads ONLY the structured `status` / `conclusion` fields of
 * `gh run view <id> --json status,conclusion` — never a substring match over a
 * name, and never a `--jq '.status+"/"+.conclusion'` string-concat expression
 * (the session's `--jq` concat is exactly what broke and is BANNED here; the
 * JSON is parsed in JS). A GitHub Actions run: `status` ∈ queued/in_progress/
 * completed; when `completed`, `conclusion` ∈ success/failure/cancelled/
 * timed_out/action_required/neutral/skipped/stale. Terminal SUCCESS = completed
 * + success; terminal FAIL = completed + any non-success conclusion; anything
 * else (queued/in_progress, or a malformed/empty payload) is still pending.
 *
 * Usage:
 *   node tools/gh/run-wait.mjs <run-id> [--timeout <sec>] [--interval <sec>]
 *   pnpm run:wait <run-id>                               # alias
 *
 * Exit codes (mirror merge-gate): 0 = SUCCESS; 1 = FAIL (non-success terminal
 * conclusion); 2 = TIMEOUT (still pending at the deadline); 3 = usage /
 * gh-spawn error.
 *
 * Canon: CLAUDE.md → Subagent context economy (bounded-poll rule). Issue #984.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_SEC = 900; // 15 min — comfortably above a full CI run.
const DEFAULT_INTERVAL_SEC = 15;
const GH_MAX_BUFFER = 64 * 1024 * 1024; // parity with merge-gate (#315).
const TAG = "[run:wait]";

// ── pure seams (unit-tested in guard-tests/run-wait.spec.ts) ────────────────

/**
 * Classify one GitHub Actions run from its STRUCTURED status/conclusion fields.
 * Names never influence the verdict. A run is:
 *   - `success` — status completed + conclusion success.
 *   - `fail`    — status completed + any conclusion other than success
 *                 (failure, cancelled, timed_out, action_required, neutral,
 *                 skipped, stale, or an anomalous null on a completed run).
 *   - `pending` — not yet completed (queued / in_progress), or a
 *                 malformed/empty payload where `status` is missing — never
 *                 read as a terminal SUCCESS (a poll keeps waiting).
 *
 * @param {{status?: string, conclusion?: string|null}|null|undefined} run
 * @returns {{state: "success"|"fail"|"pending", status: string|null, conclusion: string|null}}
 */
export function classifyRun(run) {
  const status = run && typeof run.status === "string" ? run.status : null;
  const conclusion =
    run && typeof run.conclusion === "string" ? run.conclusion : null;
  if (status !== "completed") {
    return { state: "pending", status, conclusion };
  }
  if (conclusion === "success") {
    return { state: "success", status, conclusion };
  }
  return { state: "fail", status, conclusion };
}

/**
 * Decide the next poll action from a classified state and the elapsed time.
 * A terminal run resolves immediately; a still-pending run polls again until
 * the elapsed time reaches the timeout, at which point it is a TIMEOUT.
 *
 * @param {{state: "success"|"fail"|"pending", elapsedMs: number, timeoutMs: number}} args
 * @returns {"success"|"fail"|"timeout"|"poll"}
 */
export function nextAction({ state, elapsedMs, timeoutMs }) {
  if (state === "success") return "success";
  if (state === "fail") return "fail";
  if (elapsedMs >= timeoutMs) return "timeout";
  return "poll";
}

/**
 * Validate a raw run-id CLI arg: a positive integer only. Returns the parsed
 * number or null (the caller emits the usage message + exit 3).
 * @param {string|undefined} raw
 * @returns {number|null}
 */
export function parseRunId(raw) {
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(String(raw).trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

const USAGE =
  "Usage: node tools/gh/run-wait.mjs <run-id> [--timeout <sec>] [--interval <sec>]\n";

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

/** Fetch the run's structured status/conclusion (parsed in JS, no --jq). */
function fetchRun(runId) {
  const res = gh(["run", "view", String(runId), "--json", "status,conclusion"]);
  if (res.status !== 0)
    die(
      `gh run view ${runId} failed — is '${runId}' a valid run id? ${(res.stderr ?? "").trim()}`,
    );
  try {
    return JSON.parse(res.stdout);
  } catch {
    die(`could not parse gh JSON output for: gh run view ${runId}`);
    return; // unreachable — die() calls process.exit.
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runId = parseRunId(args[0]);
  if (runId === null) {
    process.stderr.write(USAGE);
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

  const start = Date.now();
  const timeoutMs = timeoutSec * 1000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const run = fetchRun(runId);
    const { state, status, conclusion } = classifyRun(run);
    const action = nextAction({
      state,
      elapsedMs: Date.now() - start,
      timeoutMs,
    });

    if (action === "success") {
      process.stdout.write(
        `${TAG} SUCCESS — run ${runId}: completed/success (${attempt} poll(s)).\n`,
      );
      process.exit(0);
    }
    if (action === "fail") {
      die(
        `FAIL — run ${runId}: completed/${conclusion ?? "<no-conclusion>"}. Not a success.`,
        1,
      );
    }
    if (action === "timeout") {
      die(
        `TIMEOUT — run ${runId}: still ${status ?? "<unknown>"} after ${timeoutSec}s (${attempt} poll(s)).`,
        2,
      );
    }
    process.stdout.write(
      `${TAG} run ${runId}: ${status ?? "<unknown>"}; re-poll in ${intervalSec}s…\n`,
    );
    await sleep(intervalSec * 1000);
  }
}

// Run main only when invoked directly, so the pure seams are importable in the
// guard-test harness without firing subprocesses (mirrors merge-gate.mjs).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
