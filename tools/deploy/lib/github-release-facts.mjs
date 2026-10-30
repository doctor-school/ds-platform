// tools/deploy/lib/github-release-facts.mjs — the GitHub reads behind the release
// candidate, shared by registry retention (`../registry-retention.mjs`) and
// `pnpm release:lane` (`../release-lane.mjs`, #3561). Every reader shells out to
// `gh` (and `git` for main history) and throws when the fact cannot be read.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export async function ghLines(args) {
  const { stdout } = await run("gh", args, { maxBuffer: MAX_BUFFER });
  return stdout.split("\n").filter(Boolean);
}

/** The SHA of the newest production Deployment (`deployment-record.mjs`) whose
 *  latest status is `success`; throws when none can be read. */
export async function latestProductionSha(repo) {
  const deployments = await ghLines([
    "api",
    `repos/${repo}/deployments?environment=production&per_page=100`,
    "--jq",
    ".[] | {id, sha}",
  ]);
  for (const line of deployments) {
    const { id, sha } = JSON.parse(line);
    const [state] = await ghLines([
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
export async function stageSuiteState(repo, sha) {
  const [state] = await ghLines([
    "api",
    `repos/${repo}/commits/${sha}/status?per_page=100`,
    "--jq",
    '.statuses[] | select(.context == "stage-suite") | .state',
  ]);
  return state ?? null;
}

/** First-parent `main` history, newest first, from a fresh fetch of origin/main
 *  (only FETCH_HEAD moves; no branch or working tree is touched). */
export async function mainHistory({ cwd } = {}) {
  await run("git", ["fetch", "--quiet", "--filter=tree:0", "origin", "main"], {
    cwd,
  });
  const { stdout } = await run(
    "git",
    ["rev-list", "--first-parent", "FETCH_HEAD"],
    { cwd, maxBuffer: MAX_BUFFER },
  );
  return stdout.split("\n").filter(Boolean);
}
