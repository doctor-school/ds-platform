#!/usr/bin/env node
// tools/deploy/release-lane.mjs — `pnpm release:lane` (#3561): read-only view of the
// release lane — the live production SHA, the release candidate (newest `main` SHA
// with a green `stage-suite`, the same walk registry retention keeps), the Stage main
// runs in progress / pending, the Runtime images queue and the deploy-prod queue.
// Every fact comes from the GitHub API through `gh`; it runs no `git` at all, so it
// never fetches, moves a ref or writes clone config, and a stale local `origin/main`
// cannot skew the candidate.
//
// Environment: GITHUB_REPOSITORY (owner/name) optional — defaults to `gh repo view`.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  execSpawn,
  ghVia,
  latestProductionSha,
  mainHistoryFromApi,
  stageSuiteState,
} from "./lib/github-release-facts.mjs";
import { STAGE_SUITE_WALK_DEPTH } from "./lib/registry-retention.mjs";
import { laneCandidate, openRuns, renderLane } from "./lib/release-lane.mjs";

const RUN_FIELDS =
  ".workflow_runs[] | {status, event, head_sha, head_branch, created_at, html_url, pull_requests: [.pull_requests[] | {number}]}";

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    { encoding: "utf8" },
  ).trim();
}

/** The newest 100 runs of a workflow file, reduced to the unfinished ones. Queued
 *  runs are the newest, so 100 covers a full `queue: max` group. */
async function unfinished(repo, workflow, gh) {
  const lines = await gh([
    "api",
    `repos/${repo}/actions/workflows/${workflow}/runs?per_page=100`,
    "--jq",
    RUN_FIELDS,
  ]);
  return openRuns(lines.map((line) => JSON.parse(line)));
}

/** The lane as text. `spawn(cmd, args) → stdout` runs every external command. */
export async function readLane(repo, { spawn = execSpawn } = {}) {
  const gh = ghVia(spawn);
  const productionSha = await latestProductionSha(repo, gh);
  const [history, stage, images, deploy] = await Promise.all([
    // through production, so the candidate can be placed against it
    mainHistoryFromApi(repo, {
      minimum: STAGE_SUITE_WALK_DEPTH,
      through: productionSha,
      gh,
    }),
    unfinished(repo, "stage.yml", gh),
    unfinished(repo, "runtime-images.yml", gh),
    unfinished(repo, "deploy-prod.yml", gh),
  ]);
  const candidate = await laneCandidate({
    history,
    readState: (sha) => stageSuiteState(repo, sha, gh),
    productionSha,
  });
  return renderLane({
    productionSha,
    head: history[0],
    candidate,
    // Every PR image build also fires stage.yml as a skipped `stage-other-*` run;
    // only `main` runs converge the stage and post `stage-suite`.
    stage: stage.filter((r) => r.head_branch === "main"),
    images,
    deploy,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  readLane(repository())
    .then((text) => console.log(text))
    .catch((error) => {
      console.error(`release:lane: ${error.message}`);
      process.exit(1);
    });
}
