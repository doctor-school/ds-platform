#!/usr/bin/env node
// tools/deploy/registry-retention.mjs — prune the container registry to the retention
// policy (#3110; policy and planner: `lib/registry-retention.mjs`). Run by
// `.github/workflows/registry-retention.yml`; never from a workstation.
//
// Environment:
//   REGISTRY_TOKEN     the push token (push + pull + delete); required
//   GITHUB_REPOSITORY  owner/name whose releases, production deployments, hotfix
//                      branches and open PRs set the keep-set
//   GH_TOKEN           for `gh api` (contents, pull-requests, deployments: read)
//   DRY_RUN            "true" prints the plan only; anything else deletes
//   GITHUB_STEP_SUMMARY optional; the plan and the result are appended to it
//
// Order matters: the registry is listed BEFORE the releases, deployments, hotfix
// branches, open PRs and `main`, so any tag in the snapshot was pushed after its
// commit became visible — an open PR's or hotfix branch's current head or a `main`
// commit can never be missing from the keep-set while its own tag is in the delete
// list.
//
// Any failure exits non-zero. Before the first DELETE that is a delete of nothing;
// a refused DELETE (e.g. 405 UNSUPPORTED — the registry does not allow deletion)
// stops the run at once and is reported, never skipped.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

import { IMAGE_REGISTRY } from "./lib/registry.mjs";
import {
  RetentionError,
  nextTagRequest,
  parseBearerChallenge,
  parseNextLink,
  planRetention,
  renderPlanSummary,
  retentionRepos,
} from "./lib/registry-retention.mjs";

const run = promisify(execFile);
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const REGISTRY_USER = "ds-platform";
const LOOKUP_CONCURRENCY = 8;
const TAG_PAGE_SIZE = 100;

function env(name) {
  const value = process.env[name];
  if (!value) throw new RetentionError(`${name} is not set`);
  return value;
}

/** Docker Registry v2 client: Basic or Bearer, whichever the registry challenges with. */
function registryClient(token) {
  const base = `https://${IMAGE_REGISTRY}`;
  const basic = `Basic ${Buffer.from(`${REGISTRY_USER}:${token}`).toString("base64")}`;
  const bearerByScope = new Map();

  async function authorize(challenge) {
    const bearer = parseBearerChallenge(challenge);
    if (!bearer) return basic;
    const key = bearer.scope ?? "";
    if (!bearerByScope.has(key)) {
      const url = new URL(bearer.realm);
      if (bearer.service) url.searchParams.set("service", bearer.service);
      if (bearer.scope) url.searchParams.set("scope", bearer.scope);
      const res = await fetch(url, { headers: { Authorization: basic } });
      if (!res.ok)
        throw new RetentionError(
          `registry token request for ${key || "(no scope)"} answered HTTP ${res.status}`,
        );
      const body = await res.json();
      const value = body.token ?? body.access_token;
      if (!value)
        throw new RetentionError(
          `registry token response for ${key || "(no scope)"} carries no token`,
        );
      bearerByScope.set(key, `Bearer ${value}`);
    }
    return bearerByScope.get(key);
  }

  return async function request(path, { method = "GET", headers = {} } = {}) {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    let res = await fetch(url, { method, headers });
    if (res.status === 401) {
      const auth = await authorize(res.headers.get("www-authenticate"));
      res = await fetch(url, {
        method,
        headers: { ...headers, Authorization: auth },
      });
    }
    return res;
  };
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

async function ghLines(args) {
  const { stdout } = await run("gh", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean);
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

/** The SHA of the newest production Deployment (`deployment-record.mjs`) whose
 *  latest status is `success`; throws when none can be read. */
async function latestProductionSha(repo) {
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
  throw new RetentionError(
    "no successful production GitHub Deployment found — refusing to decide what production runs",
  );
}

async function mainHistory() {
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

async function main() {
  const token = env("REGISTRY_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const dryRun = process.env.DRY_RUN === "true";
  const request = registryClient(token);

  const tags = await snapshotRegistry(request);
  const [releases, openPrHeads, hotfixHeads, productionSha, history] =
    await Promise.all([
      listReleases(repo),
      listOpenPrHeads(repo),
      listHotfixHeads(repo),
      latestProductionSha(repo),
      mainHistory(),
    ]);
  const plan = planRetention({
    tags,
    releases,
    mainHistory: history,
    openPrHeads,
    hotfixHeads,
    productionSha,
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
