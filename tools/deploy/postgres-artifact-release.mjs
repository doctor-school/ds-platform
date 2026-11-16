#!/usr/bin/env node
// #4089: the Actions path of a changed data-prod image input (tools/deploy/README.md →
// PostgreSQL deployment guard; spec 2026-10-16-release-pipeline-off-workstation-en.md
// §5 «Certified PostgreSQL artifacts.»). `postgres-artifact.yml` certifies the images of
// a data source hash on a GitHub-hosted runner and keeps the certificate, the audit log
// and the exported images as the run artifact `postgres-artifact-<sourceHash>`.
// `deploy-prod.yml` asks this module whether the release changes the data input and, if
// it does, which run's artifact it delivers; ds-api-prod keeps the delivery under
// POSTGRES_ARTIFACT_DIR and `prod.mjs --local` loads it into ds-data-prod before the
// guard. The guard alone decides what is accepted: this module only finds the evidence.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import { readPostgresTarget } from "./postgres-guard.mjs";

export const POSTGRES_ARTIFACT_WORKFLOW =
  ".github/workflows/postgres-artifact.yml";
/** Where ds-api-prod keeps the delivered artifact of a release SHA (root:deploy 0750). */
export const POSTGRES_ARTIFACT_DIR = "/var/lib/ds-platform/postgres-artifact";
export const ARTIFACT_CERTIFICATE = "certificate.json";
export const ARTIFACT_IMAGES = "images.tar";

const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;
const HOTFIX_REF_RE = /^hotfix\/[0-9]+-[a-z0-9-]+$/;

export const postgresArtifactName = (sourceHash) => {
  if (!HASH_RE.test(sourceHash ?? ""))
    throw new Error(`not a data source hash: ${sourceHash}`);
  return `postgres-artifact-${sourceHash}`;
};

/**
 * The bytes of the regular file `name` at the top of the tar archive `path`, or null.
 * ustar headers only, read in place (a `docker image save` archive is 300+ MB): pax and
 * GNU long-name headers are skipped as entries of their own.
 */
export function readTarMember(
  path,
  name,
  { open = openSync, read = readSync, close = closeSync } = {},
) {
  const fd = open(path, "r");
  try {
    const header = Buffer.alloc(512);
    let offset = 0;
    for (;;) {
      if (read(fd, header, 0, 512, offset) !== 512) return null;
      if (header.every((b) => b === 0)) return null;
      const field = (start, length) =>
        header
          .subarray(start, start + length)
          .toString("utf8")
          .replace(/\0.*$/s, "");
      const size = parseInt(field(124, 12).trim() || "0", 8);
      if (!Number.isFinite(size) || size < 0)
        throw new Error(`${path} is not a tar archive`);
      const prefix = field(345, 155);
      const member = (prefix ? `${prefix}/` : "") + field(0, 100);
      const type = field(156, 1) || "0";
      if (
        (type === "0" || type === "") &&
        member.replace(/^\.\//, "") === name
      ) {
        const data = Buffer.alloc(size);
        if (read(fd, data, 0, size, offset + 512) !== size)
          throw new Error(`${path}: ${name} is truncated`);
        return data;
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    close(fd);
  }
}

/**
 * The image ids a `docker load` of the archive yields: the config digest of each image of
 * its `manifest.json` (`blobs/sha256/<hex>` since Docker 25, `<hex>.json` before).
 */
export function imageArchiveConfigIds(path, io) {
  const raw = readTarMember(path, "manifest.json", io);
  if (!raw)
    throw new Error(
      `${path} carries no manifest.json: not a docker image archive`,
    );
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${path}: manifest.json is not JSON`);
  }
  if (!Array.isArray(manifest) || manifest.length === 0)
    throw new Error(`${path}: manifest.json lists no image`);
  return manifest.map((entry) => {
    const match = String(entry?.Config ?? "").match(
      /^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/,
    );
    if (!match)
      throw new Error(
        `${path}: an image of manifest.json has no config digest`,
      );
    return `sha256:${match[1] ?? match[2]}`;
  });
}

/**
 * Refuses unless the archive yields exactly the certified image ids: a `docker load` of it
 * then holds the very images the certificate measured, under the ids the guard inspects.
 */
export function assertArchiveMatchesCertificate(archiveIds, certificate) {
  const certified = ["postgres", "pgbackrest"].map(
    (role) => certificate?.images?.[role]?.id,
  );
  if (!certified.every((id) => IMAGE_ID_RE.test(id ?? "")))
    throw new Error(
      "the certificate names no immutable image id for postgres and pgbackrest",
    );
  const archived = [...new Set(archiveIds)].sort();
  const wanted = [...new Set(certified)].sort();
  if (JSON.stringify(archived) !== JSON.stringify(wanted))
    throw new Error(
      `the image archive holds ${archived.join(", ") || "no image"}, the certificate ${wanted.join(", ")}`,
    );
}

/** True when the release changes the data source hash the live SHA runs. */
export function postgresInputChanged({ targetHash, liveHash }) {
  if (!HASH_RE.test(targetHash ?? "") || !HASH_RE.test(liveHash ?? ""))
    throw new Error(
      "the data source hash of the target or the live SHA is unknown",
    );
  return targetHash !== liveHash;
}

/**
 * The run whose `postgres-artifact-<sourceHash>` the release delivers — or a refusal.
 * Only a successful `push` / `workflow_dispatch` run of POSTGRES_ARTIFACT_WORKFLOW on
 * `main` or a `hotfix/<N>-<slug>` branch of this repository counts (a pull_request run
 * builds from a head nobody reviewed into production); an expired artifact never does.
 * The newest qualifying run wins.
 */
export function selectPostgresArtifact({ sourceHash, artifacts, runs, repo }) {
  const name = postgresArtifactName(sourceHash);
  const byId = new Map(
    (Array.isArray(runs) ? runs : []).map((run) => [run?.id, run]),
  );
  const rejected = [];
  const candidates = [];
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    if (artifact?.name !== name) continue;
    const run = byId.get(artifact.workflow_run?.id);
    const why = !run
      ? "its run is unreadable"
      : artifact.expired
        ? "it expired"
        : run.path !== POSTGRES_ARTIFACT_WORKFLOW
          ? `it comes from ${run.path}`
          : !["push", "workflow_dispatch"].includes(run.event)
            ? `it comes from a ${run.event} run`
            : run.head_repository?.full_name !== repo
              ? "it comes from another repository"
              : run.head_branch !== "main" &&
                  !HOTFIX_REF_RE.test(run.head_branch ?? "")
                ? `it comes from branch ${run.head_branch}`
                : run.status !== "completed" || run.conclusion !== "success"
                  ? `its run is ${run.conclusion ?? run.status}`
                  : !SHA_RE.test(run.head_sha ?? "")
                    ? "its run names no commit"
                    : null;
    if (why) rejected.push(`run ${artifact.workflow_run?.id}: ${why}`);
    else
      candidates.push({
        runId: run.id,
        artifactId: artifact.id,
        headSha: run.head_sha,
        createdAt: artifact.created_at,
      });
  }
  candidates.sort(
    (a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)) ||
      b.runId - a.runId,
  );
  if (candidates.length) return candidates[0];
  throw new Error(
    `no certified PostgreSQL artifact ${name.slice(0, 34)}…${rejected.length ? ` (${rejected.join("; ")})` : ""}: ` +
      `run \`gh workflow run postgres-artifact.yml --ref main\` and release when it is green`,
  );
}

function gh(args) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")} failed: ${String(r.stderr).trim().split("\n")[0]}`,
    );
  return r.stdout;
}

async function main() {
  const [flag, sha, ...rest] = process.argv.slice(2);
  if (flag !== "--sha" || !SHA_RE.test(sha ?? "") || rest.length)
    throw new Error("usage: postgres-artifact-release.mjs --sha <target sha>");
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? ""))
    throw new Error("GITHUB_REPOSITORY is unset");
  // The live SHA as the release pre-flight reads it: the newest successful production
  // Deployment. Its tree's hash is what ds-data-prod runs; the box record stays the
  // guard's own evidence.
  const { liveProdShaViaGh } = await import("./release-runner.mjs");
  const liveSha = await liveProdShaViaGh({ repo, gh });
  if (!SHA_RE.test(liveSha ?? ""))
    throw new Error(
      "the live prod SHA is unknown (no successful production Deployment)",
    );
  // A hotfix branch is deleted once its release is recorded: fetch a live SHA the
  // checkout does not hold by its id.
  if (
    spawnSync("git", ["cat-file", "-e", `${liveSha}^{commit}`]).status !== 0 &&
    spawnSync("git", ["fetch", "--no-tags", "--quiet", "origin", liveSha])
      .status !== 0
  )
    throw new Error(
      `the live prod SHA ${liveSha.slice(0, 12)} cannot be fetched`,
    );
  const targetHash = readPostgresTarget(sha).sourceHash;
  const liveHash = readPostgresTarget(liveSha).sourceHash;
  const output = (line) =>
    process.env.GITHUB_OUTPUT &&
    appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  if (!postgresInputChanged({ targetHash, liveHash })) {
    output("run-id=");
    console.log(
      `data input unchanged since the live ${liveSha.slice(0, 12)} (${targetHash.slice(0, 12)}…): no PostgreSQL artifact`,
    );
    return;
  }
  const name = postgresArtifactName(targetHash);
  const artifacts = JSON.parse(
    gh(["api", `repos/${repo}/actions/artifacts?name=${name}&per_page=100`]),
  ).artifacts;
  const runIds = [
    ...new Set(
      artifacts.map((a) => a.workflow_run?.id).filter(Number.isInteger),
    ),
  ];
  const runs = runIds.map((id) =>
    JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}`])),
  );
  const chosen = selectPostgresArtifact({
    sourceHash: targetHash,
    artifacts,
    runs,
    repo,
  });
  output(`run-id=${chosen.runId}`);
  output(`source-hash=${targetHash}`);
  console.log(
    `data input changed ${liveHash.slice(0, 12)}… → ${targetHash.slice(0, 12)}…: delivering the certified artifact of run ${chosen.runId} (${chosen.headSha.slice(0, 12)})`,
  );
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked && invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::postgres-artifact: ${error.message}`);
    process.exit(1);
  });
}
