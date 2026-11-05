#!/usr/bin/env node
// tools/deploy/registry-retention.mjs — prune the container registry to the retention
// policy (#3110; policy and planner: `lib/registry-retention.mjs`). Run by
// `.github/workflows/registry-retention.yml`; never from a workstation.
//
// Environment:
//   REGISTRY_TOKEN     the push token (push + pull + delete); required
//   GITHUB_REPOSITORY  owner/name whose releases, production deployments, hotfix
//                      branches and open PRs set the keep-set
//   GH_TOKEN           for `gh api` (actions, contents, pull-requests, deployments,
//                      statuses: read)
//   DRY_RUN            "true" prints the plan only; anything else deletes
//   TWC_READ_TOKEN     optional; read-only, project-scoped Timeweb API token for the
//                      registry's disk usage (#3724). Missing or refused: a warning
//                      that never blocks or alters the prune; at >= 90 % the run
//                      fails after the prune has finished
//   GITHUB_STEP_SUMMARY optional; the plan and the result are appended to it
//
// Execution prerequisite: registry-retention.yml holds the shared registry-images
// workflow lock from BEFORE the snapshot through the final DELETE, excluding every
// runtime-images.yml run on `main`, `hotfix/*` and workflow_dispatch. Listing before
// the GitHub keep-set lookup alone cannot protect a digest that gains a fresh alias
// after the snapshot (#3144). Every registry writer that can re-tag an existing
// digest must participate in that same lock; never run standalone. `pull_request`
// runs stay outside it (#3561): their `pr/*` images carry the head SHA as the
// `org.opencontainers.image.revision` label, so each PR digest belongs to one head
// and no later push can alias a digest this run is deleting.
//
// Any failure exits non-zero. Before the first DELETE that is a delete of nothing;
// a refused DELETE (e.g. 405 UNSUPPORTED — the registry does not allow deletion)
// stops the run at once and is reported, never skipped.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

import {
  ghLines,
  latestProductionSha,
  stageSuiteState,
} from "./lib/github-release-facts.mjs";
import { MANIFEST_ACCEPT, registryClient } from "./lib/registry-client.mjs";
import {
  RetentionError,
  activeRunTargets,
  assessRegistryDisk,
  findGreenStageSuite,
  nextTagRequest,
  parseNextLink,
  planRetention,
  renderPlanSummary,
  readRegistryDisk,
  retentionRepos,
} from "./lib/registry-retention.mjs";

const LOOKUP_CONCURRENCY = 8;
const TAG_PAGE_SIZE = 100;

function env(name) {
  const value = process.env[name];
  if (!value) throw new RetentionError(`${name} is not set`);
  return value;
}

async function failure(res, what) {
  const body = await res.text().catch(() => "");
  return new RetentionError(
    `${what} answered HTTP ${res.status}: ${body.slice(0, 300)}`,
  );
}

async function listTags(request, repo) {
  const tags = [];
  const known = new Set();
  let next = `/v2/${repo}/tags/list?n=${TAG_PAGE_SIZE}`;
  let probed = false;
  while (next) {
    const res = await request(next);
    if (res.status === 404) {
      const body = await res.text();
      // A repository nobody has pushed to yet holds no tags; any other 404 is unknown.
      if (body.includes("NAME_UNKNOWN") && tags.length === 0) return [];
      throw new RetentionError(
        `listing ${repo} answered HTTP 404: ${body.slice(0, 300)}`,
      );
    }
    if (!res.ok) throw await failure(res, `listing ${repo}`);
    const body = await res.json();
    const step = nextTagRequest({
      repo,
      page: body.tags ?? [],
      known,
      link: parseNextLink(res.headers.get("link")),
      probed,
      pageSize: TAG_PAGE_SIZE,
    });
    for (const tag of step.fresh) known.add(tag);
    tags.push(...step.fresh);
    next = step.next;
    probed = step.probe;
  }
  return tags;
}

async function resolveDigest(request, repo, tag) {
  const head = await request(`/v2/${repo}/manifests/${tag}`, {
    method: "HEAD",
    headers: { Accept: MANIFEST_ACCEPT },
  });
  if (!head.ok) throw await failure(head, `HEAD ${repo}:${tag}`);
  const digest = head.headers.get("docker-content-digest");
  if (digest) return digest;
  // No digest header: the digest of a manifest is the sha256 of its exact bytes.
  const get = await request(`/v2/${repo}/manifests/${tag}`, {
    headers: { Accept: MANIFEST_ACCEPT },
  });
  if (!get.ok) throw await failure(get, `GET ${repo}:${tag}`);
  return `sha256:${createHash("sha256")
    .update(Buffer.from(await get.arrayBuffer()))
    .digest("hex")}`;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const index = i++;
        out[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

async function snapshotRegistry(request) {
  const tags = {};
  for (const repo of retentionRepos()) {
    const names = await listTags(request, repo);
    tags[repo] = await mapPool(names, LOOKUP_CONCURRENCY, async (tag) => ({
      tag,
      digest: await resolveDigest(request, repo, tag),
    }));
  }
  return tags;
}

async function listReleases(repo) {
  const lines = await ghLines([
    "api",
    "--paginate",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    ".[] | select(.draft | not) | {tag: .tag_name, sha: .target_commitish}",
  ]);
  return lines.map((line) => JSON.parse(line));
}

async function listOpenPrHeads(repo) {
  return ghLines([
    "api",
    "--paginate",
    `repos/${repo}/pulls?state=open&per_page=100`,
    "--jq",
    ".[].head.sha",
  ]);
}

async function listHotfixHeads(repo) {
  return ghLines([
    "api",
    "--paginate",
    `repos/${repo}/git/matching-refs/heads/hotfix/`,
    "--jq",
    ".[].object.sha",
  ]);
}

/** Every run status GitHub reports before `completed`. */
const ACTIVE_RUN_STATUSES = [
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
];

/** The queued or in-progress runs of `workflow`, as `{id, title, url}`. */
async function listActiveRuns(repo, workflow) {
  const runs = [];
  for (const status of ACTIVE_RUN_STATUSES) {
    const lines = await ghLines([
      "api",
      "--paginate",
      `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=100`,
      "--jq",
      ".workflow_runs[] | {id, title: .display_title, url: .html_url}",
    ]);
    runs.push(...lines.map((line) => JSON.parse(line)));
  }
  return runs;
}

/** First-parent `main` history, newest first. CI-only: registry-retention.yml checks
 *  out `main` as a `filter: tree:0` partial clone, so this filtered fetch refreshes
 *  FETCH_HEAD and changes no clone config there. On a full workstation clone the same
 *  fetch would register the remote as a promisor in `.git/config` — workstation
 *  readers use `mainHistoryFromApi` (`lib/github-release-facts.mjs`) instead. */
async function mainHistory() {
  const run = promisify(execFile);
  await run("git", ["fetch", "--quiet", "--filter=tree:0", "origin", "main"]);
  const { stdout } = await run(
    "git",
    ["rev-list", "--first-parent", "FETCH_HEAD"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.split("\n").filter(Boolean);
}

function summarize(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

/** Summary line + annotation for the disk usage; returns the verdict. */
function reportDisk(disk) {
  const verdict = assessRegistryDisk(disk);
  summarize(`${verdict.line}
`);
  if (verdict.level === "warn") console.log(`::warning::${verdict.message}`);
  return verdict;
}

async function main() {
  // Started first, awaited after the prune: the usage read never delays, blocks or
  // alters pruning, and it is reported even when the prune fails.
  const disk = readRegistryDisk({ token: process.env.TWC_READ_TOKEN });
  let verdict;
  try {
    await prune();
  } finally {
    verdict = reportDisk(await disk);
  }
  // At the fail ratio the run goes red only now, after the prune has finished.
  if (verdict.level === "fail") throw new RetentionError(verdict.message);
}

async function prune() {
  const token = env("REGISTRY_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const dryRun = process.env.DRY_RUN === "true";
  const request = registryClient(token);

  const tags = await snapshotRegistry(request);
  const [
    releases,
    openPrHeads,
    hotfixHeads,
    productionSha,
    history,
    stageRuns,
    deployRuns,
  ] = await Promise.all([
    listReleases(repo),
    listOpenPrHeads(repo),
    listHotfixHeads(repo),
    latestProductionSha(repo),
    mainHistory(),
    listActiveRuns(repo, "stage.yml"),
    listActiveRuns(repo, "deploy-prod.yml"),
  ]);
  const stageSuite = await findGreenStageSuite(history, (sha) =>
    stageSuiteState(repo, sha),
  );
  const plan = planRetention({
    tags,
    releases,
    mainHistory: history,
    openPrHeads,
    hotfixHeads,
    productionSha,
    stageSuite,
    activeStageShas: activeRunTargets(stageRuns, "Stage main"),
    deployTargets: activeRunTargets(deployRuns, "deploy-prod"),
  });
  summarize(renderPlanSummary(plan, { dryRun }));
  if (dryRun) return;

  let deleted = 0;
  try {
    for (const r of plan.repos) {
      for (const d of r.delete) {
        const res = await request(`/v2/${r.repo}/manifests/${d.digest}`, {
          method: "DELETE",
        });
        if (res.status !== 202 && res.status !== 200)
          throw await failure(res, `DELETE ${r.repo}@${d.digest}`);
        deleted += 1;
        console.log(`deleted ${r.repo}@${d.digest} (${d.tags.join(", ")})`);
      }
    }
  } finally {
    const total = plan.repos.reduce((n, r) => n + r.delete.length, 0);
    summarize(
      `Deleted ${deleted} of ${total} manifest digests. The space returns when the registry's ` +
        "garbage collection reclaims the unreferenced layers.",
    );
  }
}

main().catch((error) => {
  console.error(`::error::registry retention: ${error.message}`);
  process.exit(1);
});
