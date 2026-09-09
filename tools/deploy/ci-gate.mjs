// tools/deploy/ci-gate.mjs — pure seams for the `deploy:prod` green-CI
// pre-flight (Issue #2077). No I/O: `prod.mjs` fetches the two GitHub boards
// and hands the parsed rows in, so the decision logic is unit-testable.
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

const REPO_WORKFLOW_PREFIX = ".github/workflows/";

/** Conclusions the deploy gate accepts as "not red". Unchanged from the
 *  pre-#2077 inline logic — deliberately neither tightened nor loosened. */
const GOOD_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * Partition check-suite ids by workflow provenance.
 *
 * @param {Array<{check_suite_id?: number|string, path?: string}>} workflowRuns
 * @returns {{keep: Set<string>, dropped: Map<string, string>}} `dropped` maps a
 *   suite id to the non-repo workflow `path` that identified it.
 */
export function repoWorkflowSuiteFilter(workflowRuns) {
  const keep = new Set();
  const dropped = new Map();
  for (const wr of workflowRuns || []) {
    const suiteId = wr?.check_suite_id;
    if (suiteId === undefined || suiteId === null) continue;
    const path = typeof wr.path === "string" ? wr.path : "";
    if (path.startsWith(REPO_WORKFLOW_PREFIX)) {
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
 * @returns {{runs: Array<object>, dropped: string[]}} `dropped` is a list of
 *   `"<name> (<path>)"` strings for logging.
 */
export function filterCheckRunsToRepoWorkflows(checkRuns, workflowRuns) {
  const { dropped: droppedSuites } = repoWorkflowSuiteFilter(workflowRuns);
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
export function classifyDeployCheckRuns(checkRuns, workflowRuns) {
  const { runs, dropped } = filterCheckRunsToRepoWorkflows(
    checkRuns,
    workflowRuns,
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
