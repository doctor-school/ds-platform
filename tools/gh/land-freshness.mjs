#!/usr/bin/env node
/**
 * tools/gh/land-freshness.mjs — decide whether a PR whose head no longer
 * contains `origin/main` must be rebased before the landing tail, or can be
 * squash-merged as-is (#2593).
 *
 * Why: the `main` ruleset is squash-only + linear history + NON-strict checks on
 * purpose (repo-conventions → Branch protection). GitHub's squash applies the
 * PR diff on top of current `main`, so a conflict-free merge needs no local
 * rebase, and CI on push to `main` is the safety net for a semantic conflict
 * between two disjoint landings. Rebasing every stale head anyway cost a full
 * CI round per parallel landing (PR #2586: three rebase + CI rounds in one
 * afternoon). This helper narrows the rebase to the cases where it buys
 * something: a textual conflict, or `main` touching the same files the PR
 * touches (the lockfile precedent #218 is exactly that class).
 *
 * Verdicts (one terminal line `[land:freshness] #<N>: <verdict> — <reason>`):
 *   fresh        exit 0 — the PR head contains origin/main.
 *   merge-as-is  exit 1 — stale, GitHub `mergeable` = MERGEABLE, and the files
 *                         changed on main since the merge-base do NOT intersect
 *                         the PR's changed files.
 *   rebase       exit 2 — stale and (CONFLICTING, or intersecting files — listed).
 *   error        exit 3 — any failed git/gh call, an invalid SHA, a usage error,
 *                         or `mergeable` still UNKNOWN after a bounded retry.
 *                         Never reported as stale: an error is a STOP.
 *
 * Usage:
 *   node tools/gh/land-freshness.mjs <pr#>
 *   pnpm land:freshness <pr#>
 *
 * Canon: `.claude/agents/ds-lander.md` Step 1, skill `merge-when-green` Step 1a.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TAG = "[land:freshness]";

export const EXIT = Object.freeze({
  fresh: 0,
  "merge-as-is": 1,
  rebase: 2,
  error: 3,
});

/** Bounded wait for GitHub to compute `mergeable` (it starts UNKNOWN after main moves). */
export const MERGEABLE_RETRIES = 5;
export const MERGEABLE_DELAY_MS = 3000;

const SHA_RE = /^[0-9a-f]{40}$/;

// ── pure seams (unit-tested in guard-tests/land-freshness.spec.ts) ───────────

/**
 * Split `git diff --name-only` output into a file list.
 * @param {string} out
 * @returns {string[]}
 */
export function parseNameList(out) {
  return String(out ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The stale-head decision. Called only after the ancestry check said stale.
 * @param {{mergeable: string, mainFiles: string[], prFiles: string[]}} input
 * @returns {{verdict: "merge-as-is"|"rebase"|"error", reason: string, overlap: string[]}}
 */
export function classifyStale({ mergeable, mainFiles, prFiles }) {
  if (mergeable === "CONFLICTING") {
    return {
      verdict: "rebase",
      reason: "GitHub reports the PR as CONFLICTING with main",
      overlap: [],
    };
  }
  if (mergeable !== "MERGEABLE") {
    return {
      verdict: "error",
      reason: `GitHub mergeable is ${mergeable || "empty"} after the bounded retry`,
      overlap: [],
    };
  }
  const pr = new Set(prFiles);
  const overlap = [...new Set(mainFiles)].filter((f) => pr.has(f)).sort();
  if (overlap.length > 0) {
    return {
      verdict: "rebase",
      reason: `main changed ${overlap.length} file(s) the PR also changes: ${overlap.join(", ")}`,
      overlap,
    };
  }
  return {
    verdict: "merge-as-is",
    reason: `stale but MERGEABLE; main changed ${mainFiles.length} file(s), none of the PR's ${prFiles.length}`,
    overlap: [],
  };
}

// ── orchestration with injected runners ─────────────────────────────────────

class StepError extends Error {}

/**
 * @typedef {{status: number|null, stdout?: string, stderr?: string}} RunResult
 * @typedef {{
 *   git: (args: string[]) => RunResult,
 *   gh: (args: string[]) => RunResult,
 *   sleep: (ms: number) => void,
 *   retries?: number,
 *   delayMs?: number,
 * }} Deps
 */

/**
 * @param {number} prNumber
 * @param {Deps} deps
 * @returns {{verdict: "fresh"|"merge-as-is"|"rebase"|"error", reason: string, overlap: string[]}}
 */
export function landFreshness(prNumber, deps) {
  const retries = deps.retries ?? MERGEABLE_RETRIES;
  const delayMs = deps.delayMs ?? MERGEABLE_DELAY_MS;

  /** @param {"git"|"gh"} tool @param {string[]} args */
  const run = (tool, args) => {
    const r = deps[tool](args);
    if (r.status !== 0) {
      const last =
        String(r.stderr || r.stdout || "")
          .trim()
          .split(/\r?\n/)
          .pop() || "no output";
      throw new StepError(
        `\`${tool} ${args.join(" ")}\` exited ${r.status}: ${last}`,
      );
    }
    return String(r.stdout ?? "").trim();
  };
  /** @param {string} name @param {string} sha */
  const sha = (name, value) => {
    if (!SHA_RE.test(value))
      throw new StepError(`${name} is not a commit SHA: "${value}"`);
    return value;
  };

  try {
    if (!Number.isInteger(prNumber) || prNumber <= 0)
      throw new StepError(`invalid PR number: ${prNumber}`);

    run("git", ["fetch", "origin", "-q"]);
    const base = sha("origin/main", run("git", ["rev-parse", "origin/main"]));
    const head = sha(
      "PR head",
      run("gh", [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "headRefOid",
        "-q",
        ".headRefOid",
      ]),
    );
    // The head object may be absent locally (branch never fetched here).
    run("git", ["fetch", "origin", "-q", `refs/pull/${prNumber}/head`]);

    const anc = deps.git(["merge-base", "--is-ancestor", base, head]);
    if (anc.status === 0) {
      return {
        verdict: "fresh",
        reason: `head ${head.slice(0, 12)} contains origin/main ${base.slice(0, 12)}`,
        overlap: [],
      };
    }
    if (anc.status !== 1) {
      throw new StepError(
        `\`git merge-base --is-ancestor\` exited ${anc.status}: ${String(anc.stderr || "").trim()}`,
      );
    }

    const mb = sha("merge-base", run("git", ["merge-base", base, head]));
    const mainFiles = parseNameList(
      run("git", ["diff", "--name-only", "--no-renames", mb, base]),
    );
    const prFiles = parseNameList(
      run("git", ["diff", "--name-only", "--no-renames", mb, head]),
    );

    let mergeable = "UNKNOWN";
    for (let i = 0; i < retries; i++) {
      mergeable = run("gh", [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "mergeable",
        "-q",
        ".mergeable",
      ]);
      if (mergeable !== "UNKNOWN") break;
      if (i < retries - 1) deps.sleep(delayMs);
    }
    return classifyStale({ mergeable, mainFiles, prFiles });
  } catch (e) {
    if (e instanceof StepError)
      return { verdict: "error", reason: e.message, overlap: [] };
    throw e;
  }
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

/** @param {string} cmd */
const runner = (cmd) => (args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false });
  if (r.error) return { status: null, stdout: "", stderr: r.error.message };
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main(argv) {
  const pr = Number(argv[0]);
  if (argv.length !== 1 || !Number.isInteger(pr) || pr <= 0) {
    process.stderr.write(
      `${TAG} usage: node tools/gh/land-freshness.mjs <pr#>\n`,
    );
    process.stdout.write(`${TAG} error — usage\n`);
    process.exit(EXIT.error);
  }
  const res = landFreshness(pr, {
    git: runner("git"),
    gh: runner("gh"),
    sleep: sleepSync,
  });
  process.stdout.write(`${TAG} #${pr}: ${res.verdict} — ${res.reason}\n`);
  process.exit(EXIT[res.verdict]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
