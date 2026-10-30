#!/usr/bin/env node
// tools/deploy/release-lane.mjs — `pnpm release:lane` (#3561): read-only view of the
// release lane — the live production SHA, the release candidate (newest `main` SHA
// with a green `stage-suite`, the same walk registry retention keeps), the Stage main
// runs in progress / pending, the Runtime images queue and the deploy-prod queue.
// Reads GitHub through `gh`; writes nothing but the FETCH_HEAD of a `git fetch`.
//
// Environment: GITHUB_REPOSITORY (owner/name) optional — defaults to the checkout's
// `gh repo view`.

import { execFileSync } from "node:child_process";

import {
  ghLines,
  latestProductionSha,
  mainHistory,
  stageSuiteState,
} from "./lib/github-release-facts.mjs";
import { laneCandidate, openRuns, renderLane } from "./lib/release-lane.mjs";

const RUN_FIELDS =
  ".workflow_runs[] | {status, event, head_sha, head_branch, created_at, html_url, pull_requests: [.pull_requests[] | {number}]}";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { cwd: root, encoding: "utf8" },
  ).trim();
}

/** The newest 100 runs of a workflow file, reduced to the unfinished ones. Queued
 *  runs are the newest, so 100 covers a full `queue: max` group. */
async function unfinished(repo, workflow) {
  const lines = await ghLines([
    "api",
    `repos/${repo}/actions/workflows/${workflow}/runs?per_page=100`,
    "--jq",
    RUN_FIELDS,
  ]);
  return openRuns(lines.map((line) => JSON.parse(line)));
}

async function main() {
  const repo = repository();
  const [productionSha, history, stage, images, deploy] = await Promise.all([
    latestProductionSha(repo),
    mainHistory({ cwd: root }),
    unfinished(repo, "stage.yml"),
    unfinished(repo, "runtime-images.yml"),
    unfinished(repo, "deploy-prod.yml"),
  ]);
  const candidate = await laneCandidate({
    history,
    readState: (sha) => stageSuiteState(repo, sha),
    productionSha,
  });
  console.log(
    renderLane({
      productionSha,
      head: history[0],
      candidate,
      // Every PR image build also fires stage.yml as a skipped `stage-other-*` run;
      // only `main` runs converge the stage and post `stage-suite`.
      stage: stage.filter((r) => r.head_branch === "main"),
      images,
      deploy,
    }),
  );
}

main().catch((error) => {
  console.error(`release:lane: ${error.message}`);
  process.exit(1);
});
