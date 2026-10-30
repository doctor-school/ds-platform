// tools/deploy/lib/github-release-facts.mjs — the GitHub reads behind the release
// candidate, shared by registry retention (`../registry-retention.mjs`) and
// `pnpm release:lane` (`../release-lane.mjs`, #3561). Every reader goes through the
// GitHub API via `gh` only — never `git`, so a reader touches no clone, ref or
// config — and throws when the fact cannot be read. Each reader takes an optional
// `gh` line reader (`ghVia(spawn)`) so a caller can inject the process spawner.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/** The default spawner: runs `cmd args`, resolves its stdout. */
export async function execSpawn(cmd, args) {
  const { stdout } = await run(cmd, args, { maxBuffer: MAX_BUFFER });
  return stdout;
}

/** A `gh` line reader over `spawn(cmd, args) → stdout`. */
export function ghVia(spawn) {
  return async (args) => (await spawn("gh", args)).split("\n").filter(Boolean);
}

export const ghLines = ghVia(execSpawn);

/** The SHA of the newest production Deployment (`deployment-record.mjs`) whose
 *  latest status is `success`; throws when none can be read. */
export async function latestProductionSha(repo, gh = ghLines) {
  const deployments = await gh([
    "api",
    `repos/${repo}/deployments?environment=production&per_page=100`,
    "--jq",
    ".[] | {id, sha}",
  ]);
  for (const line of deployments) {
    const { id, sha } = JSON.parse(line);
    const [state] = await gh([
      "api",
      `repos/${repo}/deployments/${id}/statuses?per_page=1`,
      "--jq",
      ".[].state",
    ]);
    if (state === "success") return sha;
  }
  throw new Error(
    "no successful production GitHub Deployment found — refusing to decide what production runs",
  );
}

/** The state of the latest `stage-suite` commit status on `sha` (`stage.yml`), or
 *  null when there is none; throws when the status cannot be read. */
export async function stageSuiteState(repo, sha, gh = ghLines) {
  const [state] = await gh([
    "api",
    `repos/${repo}/commits/${sha}/status?per_page=100`,
    "--jq",
    '.statuses[] | select(.context == "stage-suite") | .state',
  ]);
  return state ?? null;
}

/**
 * First-parent `main` history, newest first, read from the GitHub commits API — the
 * remote's current `main`, whatever the local clone holds. Each page starts at the
 * first-parent commit the previous page did not reach. The walk stops once it holds
 * at least `minimum` commits and has passed `through` (when given), at the root, or
 * at `limit` commits.
 */
export async function mainHistoryFromApi(
  repo,
  { minimum = 0, through = null, limit = 1000, gh = ghLines } = {},
) {
  const history = [];
  let reachedThrough = through == null;
  const done = () =>
    history.length >= limit || (reachedThrough && history.length >= minimum);
  let next = "main";
  while (next && !done()) {
    const page = (
      await gh([
        "api",
        `repos/${repo}/commits?sha=${next}&per_page=100`,
        "--jq",
        ".[] | {sha, parents: [.parents[].sha]}",
      ])
    ).map((line) => JSON.parse(line));
    if (page.length === 0)
      throw new Error(`GitHub returned no commits for ${repo}@${next}`);
    const parents = new Map(page.map((c) => [c.sha, c.parents]));
    let cur = page[0].sha;
    while (cur && parents.has(cur) && !done()) {
      history.push(cur);
      if (cur === through) reachedThrough = true;
      cur = parents.get(cur)[0] ?? null;
    }
    next = cur;
  }
  return history;
}
