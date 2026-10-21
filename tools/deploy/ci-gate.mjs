// tools/deploy/ci-gate.mjs — the green-CI pre-flight of a prod release (Issue
// #2077), shared by the workstation path (`prod.mjs`) and the release workflow's
// runner pre-flight (`release-runner.mjs`, #3158). The decision logic is pure;
// the one board query (`fetchDeployCiBoard`) takes its `gh` runner injected, so
// both seams are unit-testable without the network.
//
// WHY a provenance filter. A commit's check-run board carries rows from every
// check suite GitHub attached to the SHA — including workflows GitHub itself
// injects on the default branch ("Dependabot Updates", code scanning). Those
// are not repo-owned CI, cannot be re-run from the Checks UI, and a `failure`
// there is not a statement about the code. On main a0ddf421 exactly one such
// row (`Dependabot`, failure) reddened an otherwise fully green board and the
// deploy pre-flight refused to ship.
//
// The rule is STRUCTURAL, never a name allow-list (the merge-gate TOTAL rule,
// #1253 / retro 29f490ed F1: check NAMES must never influence a verdict). The
// discriminator is the workflow run's `path`: repo-owned workflows live under
// `.github/workflows/`, GitHub-injected dynamic ones under `dynamic/`. The
// join key check-run -> workflow run is `check_suite.id` <-> `check_suite_id`.
//
// Fail-closed everywhere: a suite whose provenance cannot be established (no
// matching workflow run) is KEPT and still blocks; only a positively-identified
// non-`.github/workflows/` path drops a suite.

import { spawnSync } from "node:child_process";

const REPO_WORKFLOW_PREFIX = ".github/workflows/";

/**
 * The release workflow itself (#3158). Its runs attach check-runs to the SHA they
 * release (the running pre-flight, an earlier failed attempt): they are not CI and
 * are dropped by workflow PATH, the same structural rule as the injected suites.
 */
export const DEPLOY_PROD_WORKFLOW_PATH = ".github/workflows/deploy-prod.yml";

/** Conclusions the deploy gate accepts as "not red". Unchanged from the
 *  pre-#2077 inline logic — deliberately neither tightened nor loosened. */
const GOOD_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * Partition check-suite ids by workflow provenance.
 *
 * @param {Array<{check_suite_id?: number|string, path?: string}>} workflowRuns
 * @param {{ignoreWorkflowPaths?: string[]}} [options] repo workflow paths whose
 *   suites are dropped as well (exact path match).
 * @returns {{keep: Set<string>, dropped: Map<string, string>}} `dropped` maps a
 *   suite id to the workflow `path` that identified it.
 */
export function repoWorkflowSuiteFilter(
  workflowRuns,
  { ignoreWorkflowPaths = [] } = {},
) {
  const ignored = new Set(ignoreWorkflowPaths);
  const keep = new Set();
  const dropped = new Map();
  for (const wr of workflowRuns || []) {
    const suiteId = wr?.check_suite_id;
    if (suiteId === undefined || suiteId === null) continue;
    const path = typeof wr.path === "string" ? wr.path : "";
    if (path.startsWith(REPO_WORKFLOW_PREFIX) && !ignored.has(path)) {
      keep.add(suiteId);
      dropped.delete(suiteId);
    } else if (!keep.has(suiteId)) {
      dropped.set(suiteId, path);
    }
  }
  return { keep, dropped };
}

/**
 * Drop check-runs belonging to a positively-identified non-repo workflow suite.
 *
 * @param {Array<object>} checkRuns rows of `commits/<sha>/check-runs`
 * @param {Array<object>} workflowRuns rows of `actions/runs?head_sha=<sha>`
 * @param {{ignoreWorkflowPaths?: string[]}} [options] see repoWorkflowSuiteFilter
 * @returns {{runs: Array<object>, dropped: string[]}} `dropped` is a list of
 *   `"<name> (<path>)"` strings for logging.
 */
export function filterCheckRunsToRepoWorkflows(checkRuns, workflowRuns, options) {
  const { dropped: droppedSuites } = repoWorkflowSuiteFilter(
    workflowRuns,
    options,
  );
  const runs = [];
  const dropped = [];
  for (const r of checkRuns || []) {
    const suiteId = r?.check_suite?.id ?? r?.check_suite_id;
    if (suiteId !== undefined && suiteId !== null && droppedSuites.has(suiteId)) {
      dropped.push(`${r.name} (${droppedSuites.get(suiteId)})`);
      continue;
    }
    runs.push(r);
  }
  return { runs, dropped };
}

/**
 * The deploy pre-flight verdict for one SHA.
 *
 * Groups the surviving rows by check name, takes the LATEST run per name (a
 * passing re-run wins over an older failure) and requires every latest run to
 * be `completed` with a good conclusion.
 *
 * @returns {{state: "empty"|"red"|"pending"|"green", red: string[],
 *   pending: string[], dropped: string[], count: number}}
 */
export function classifyDeployCheckRuns(checkRuns, workflowRuns, options) {
  const { runs, dropped } = filterCheckRunsToRepoWorkflows(
    checkRuns,
    workflowRuns,
    options,
  );

  const latest = new Map();
  for (const r of runs) {
    const key = r.name;
    const ts = Date.parse(r.completed_at || r.started_at || 0) || 0;
    const prev = latest.get(key);
    if (!prev || ts >= prev._ts) latest.set(key, { ...r, _ts: ts });
  }

  const red = [];
  const pending = [];
  for (const r of latest.values()) {
    if (r.status !== "completed") pending.push(r.name);
    else if (!GOOD_CONCLUSIONS.has(r.conclusion))
      red.push(`${r.name}=${r.conclusion}`);
  }

  const count = latest.size;
  let state;
  if (count === 0) state = "empty";
  else if (pending.length) state = "pending";
  else if (red.length) state = "red";
  else state = "green";

  return { state, red, pending, dropped, count };
}

function ghCapture(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.slice(0, 3).join(" ")}\` exited ${r.status}: ${(r.stderr || r.stdout || "").trim()}`,
    );
  }
  return (r.stdout || "").trim();
}

const jsonLines = (raw) =>
  String(raw ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/**
 * The two GitHub boards the verdict judges: the commit's check-runs and the SHA's
 * workflow runs (their `path` is the provenance). Throws on either query failing —
 * without provenance, judging the unfiltered board would re-introduce #2077.
 *
 * @param {{sha: string, repo: string, run?: (cmd: string, args: string[]) => string}} opts
 * @returns {{checkRuns: object[], workflowRuns: object[]}}
 */
export function fetchDeployCiBoard({ sha, repo, run = ghCapture }) {
  let checkRuns;
  try {
    checkRuns = jsonLines(
      run("gh", [
        "api",
        "--paginate",
        `repos/${repo}/commits/${sha}/check-runs`,
        "-q",
        ".check_runs[] | {name,status,conclusion,started_at,completed_at,check_suite_id:.check_suite.id}",
      ]),
    );
  } catch (e) {
    throw new Error(`could not query CI check-runs via gh: ${e.message}`, {
      cause: e,
    });
  }
  let workflowRuns;
  try {
    workflowRuns = jsonLines(
      run("gh", [
        "api",
        "--paginate",
        `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
        "-q",
        ".workflow_runs[] | {name,path,check_suite_id}",
      ]),
    );
  } catch (e) {
    throw new Error(
      `could not query workflow runs via gh (provenance unknown): ${e.message}`,
      { cause: e },
    );
  }
  return { checkRuns, workflowRuns };
}

/** The refusal line for a non-green verdict, or `null` when CI is green. */
export function ciVerdictProblem(verdict, sha) {
  const short = String(sha).slice(0, 12);
  switch (verdict.state) {
    case "green":
      return null;
    case "empty":
      return `no repo-owned CI check-runs reported for ${short} yet — wait for CI to run.`;
    case "pending":
      return `CI still running for ${short}: ${verdict.pending.join(", ")}`;
    case "red":
      return `CI is RED for ${short}: ${verdict.red.join(", ")}`;
    default:
      return `CI verdict for ${short} is unknown (${verdict.state})`;
  }
}
