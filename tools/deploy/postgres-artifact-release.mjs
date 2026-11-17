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
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { posix } from "node:path";
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

export const postgresArtifactName = (sourceHash) => {
  if (!HASH_RE.test(sourceHash ?? ""))
    throw new Error(`not a data source hash: ${sourceHash}`);
  return `postgres-artifact-${sourceHash}`;
};

/**
 * Visits every member of the tar archive `path` in order: `visit(name, type, size, body)`,
 * `body()` reading that member's bytes. Read in place (a `docker image save` archive is
 * 300+ MB) and refused unless every member has one reading for this reader, the box's
 * `postgres-load` and docker alike: one plain POSIX ustar header (no pax or GNU header,
 * an all-NUL prefix), a regular file or directory, a name already in normal form, no
 * name twice. `docker image save` writes nothing else.
 */
function scanTar(
  path,
  visit,
  { open = openSync, read = readSync, close = closeSync } = {},
) {
  const fd = open(path, "r");
  try {
    const header = Buffer.alloc(512);
    const seen = new Set();
    let offset = 0;
    for (;;) {
      if (read(fd, header, 0, 512, offset) !== 512) return;
      if (header.every((b) => b === 0)) return;
      const field = (start, length) =>
        header
          .subarray(start, start + length)
          .toString("utf8")
          .replace(/\0.*$/s, "");
      const size = parseInt(field(124, 12).trim() || "0", 8);
      if (!Number.isFinite(size) || size < 0)
        throw new Error(`${path} is not a tar archive`);
      const type = field(156, 1) || "0";
      // POSIX ustar only (magic "ustar\0" version "00", as Go's archive/tar writes for
      // `docker image save`), an all-NUL prefix field: no GNU or pax variant to resolve.
      if (
        ["x", "g", "L", "K"].includes(type) ||
        header.toString("latin1", 257, 265) !== "ustar\u000000" ||
        header.subarray(345, 500).some((b) => b !== 0)
      )
        throw new Error(`${path} refused: not a plain ustar header`);
      if (!["0", "5"].includes(type))
        throw new Error(`${path} refused: a link or special member`);
      const raw = field(0, 100);
      const member = type === "5" ? raw.replace(/\/$/, "") : raw;
      if (
        member !== posix.normalize(member) ||
        member.startsWith("/") ||
        ["", ".", ".."].includes(member.split("/")[0])
      )
        throw new Error(`${path} refused: a member name not in normal form`);
      if (seen.has(member))
        throw new Error(`${path} holds more than one ${member}`);
      seen.add(member);
      const at = offset + 512;
      visit(member, type, size, () => {
        const bytes = Buffer.alloc(size);
        if (read(fd, bytes, 0, size, at) !== size)
          throw new Error(`${path}: ${member} is truncated`);
        return bytes;
      });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    close(fd);
  }
}

/** The bytes of the regular file `name` of the tar archive `path` (`scanTar` rules), or null. */
export function readTarMember(path, name, io) {
  let found = null;
  scanTar(
    path,
    (member, type, _size, body) => {
      if (type === "0" && member === name) found = body();
    },
    io,
  );
  return found;
}

const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const BLOB_RE = /^blobs\/sha256\/[a-f0-9]{64}$/;
const ARCHIVE_DIRS = ["blobs", "blobs/sha256"];
const ARCHIVE_FILES = ["index.json", "manifest.json", "oci-layout"];
const SMALL_MEMBER = 1024 * 1024;

const sameKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());

/**
 * The image ids a `docker load` of the archive yields on Docker's containerd image store,
 * the store ds-data-prod runs (`overlayfs`, #4104): the digests of the image targets its
 * OCI `index.json` lists — the id `docker image inspect` reports and the `Image` of a
 * container run from it. The member set and entry shape are those of a real
 * `docker image save <id> <id>` on Docker 29.4.2 under that store (#4104): the
 * directories `blobs` and `blobs/sha256`, `blobs/sha256/<hex>` blobs, `index.json`,
 * `manifest.json` and `oci-layout`, each index.json entry exactly {mediaType, digest,
 * size}. Anything else is refused: another member (a `repositories` file included), a
 * classic-store archive (no index.json), an entry with a name or platform, a target blob
 * absent or not of its digest and size, a manifest.json image that is tagged or whose
 * config blob is absent. The images are saved by id, so a name could only retarget a tag
 * on ds-data-prod (the box's `postgres-load` refuses the same).
 */
export function imageArchiveIds(path, io) {
  const files = new Map();
  const blobs = new Map();
  scanTar(
    path,
    (member, type, size, body) => {
      if (type === "5" && ARCHIVE_DIRS.includes(member)) return;
      if (type === "0" && BLOB_RE.test(member)) {
        blobs.set(member, size);
        return;
      }
      if (type === "0" && ARCHIVE_FILES.includes(member)) {
        if (size > SMALL_MEMBER)
          throw new Error(`${path}: ${member} is not a small file`);
        files.set(member, body());
        return;
      }
      throw new Error(
        `${path} refused: ${member} is not a member of a containerd image archive`,
      );
    },
    io,
  );
  const json = (name) => {
    const bytes = files.get(name);
    if (!bytes)
      throw new Error(
        `${path} carries no ${name}: not a containerd image archive`,
      );
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`${path}: ${name} is not JSON`);
    }
  };
  const layout = json("oci-layout");
  if (
    !sameKeys(layout, ["imageLayoutVersion"]) ||
    layout.imageLayoutVersion !== "1.0.0"
  )
    throw new Error(`${path}: oci-layout is not the OCI image layout 1.0.0`);
  const index = json("index.json");
  if (
    !sameKeys(index, ["schemaVersion", "mediaType", "manifests"]) ||
    index.schemaVersion !== 2 ||
    index.mediaType !== OCI_INDEX ||
    !Array.isArray(index.manifests) ||
    index.manifests.length === 0
  )
    throw new Error(`${path}: index.json is not an OCI image index of images`);
  const manifest = json("manifest.json");
  if (!Array.isArray(manifest) || manifest.length !== index.manifests.length)
    throw new Error(
      `${path}: manifest.json does not list the ${index.manifests.length} images of index.json`,
    );
  for (const entry of manifest) {
    const tags = entry?.RepoTags ?? [];
    if (!Array.isArray(tags) || tags.length)
      throw new Error(
        `${path}: an image of manifest.json carries the tag ${[].concat(tags).join(", ")}`,
      );
    if (!blobs.has(String(entry?.Config ?? "")))
      throw new Error(
        `${path}: an image of manifest.json has no config blob in the archive`,
      );
  }
  const targets = index.manifests.map((entry) => {
    if (
      !sameKeys(entry, ["mediaType", "digest", "size"]) ||
      ![OCI_INDEX, OCI_MANIFEST].includes(entry.mediaType) ||
      !IMAGE_ID_RE.test(entry.digest ?? "") ||
      !Number.isSafeInteger(entry.size)
    )
      throw new Error(
        `${path}: an index.json entry is not exactly {mediaType, digest, size} of an unnamed image`,
      );
    const blob = `blobs/sha256/${entry.digest.slice(7)}`;
    if (blobs.get(blob) !== entry.size || entry.size > SMALL_MEMBER)
      throw new Error(
        `${path}: the image ${entry.digest} has no blob of its size in the archive`,
      );
    return { id: entry.digest, blob };
  });
  for (const { id, blob } of targets) {
    const bytes = readTarMember(path, blob, io);
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== id)
      throw new Error(
        `${path}: the blob of the image ${id} is not of its digest`,
      );
  }
  return targets.map(({ id }) => id);
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
  if (archiveIds.length !== certified.length)
    throw new Error(
      `the image archive holds ${archiveIds.length} images, the certificate ${certified.length}`,
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
 * Provenance is bound to the release: only a successful `push` / `workflow_dispatch` run
 * of POSTGRES_ARTIFACT_WORKFLOW on `main` of this repository whose commit is the release
 * target `targetSha` or an ancestor of it (`isAncestor(sha, targetSha)`) counts — a
 * pull_request or any other branch builds from a head nobody reviewed into production,
 * and a run outside the target's history certified a tree the release does not ship. The
 * Actions release has no hotfix ref (deploy-prod.yml: hotfixes stay break-glass), so no
 * hotfix run qualifies. An expired artifact never does. Among the qualifying runs the
 * newest wins; none qualifying is a refusal. The certificate's own sourceHash is checked
 * against the target's by the guard (postgres-guard.mjs, `missing/stale artifact
 * certification`).
 */
export function selectPostgresArtifact({
  sourceHash,
  targetSha,
  artifacts,
  runs,
  repo,
  isAncestor,
}) {
  const name = postgresArtifactName(sourceHash);
  if (!SHA_RE.test(targetSha ?? "") || typeof isAncestor !== "function")
    throw new Error("the release target SHA and its history are required");
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
      : !Number.isInteger(artifact.id)
        ? "it names no artifact id"
        : artifact.expired
          ? "it expired"
          : run.path !== POSTGRES_ARTIFACT_WORKFLOW
            ? `it comes from ${run.path}`
            : !["push", "workflow_dispatch"].includes(run.event)
              ? `it comes from a ${run.event} run`
              : run.head_repository?.full_name !== repo
                ? "it comes from another repository"
                : run.head_branch !== "main"
                  ? `it comes from branch ${run.head_branch}`
                  : run.status !== "completed" || run.conclusion !== "success"
                    ? `its run is ${run.conclusion ?? run.status}`
                    : !SHA_RE.test(run.head_sha ?? "")
                      ? "its run names no commit"
                      : run.head_sha !== targetSha &&
                          !isAncestor(run.head_sha, targetSha)
                        ? `its commit ${run.head_sha.slice(0, 12)} is not in the history of the release ${targetSha.slice(0, 12)}`
                        : null;
    if (why) rejected.push(`run ${artifact.workflow_run?.id}: ${why}`);
    else
      candidates.push({
        runId: run.id,
        artifactId: artifact.id,
        // The API's digest of the artifact zip; printed beside the delivered sums.
        digest: /^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? "")
          ? artifact.digest
          : "",
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
    output("artifact-id=");
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
  // The checkout is the full history of `main` (fetch-depth 0); a commit it lacks is no
  // ancestor of the target.
  const isAncestor = (ancestor, target) =>
    spawnSync("git", ["cat-file", "-e", `${ancestor}^{commit}`]).status === 0 &&
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, target])
      .status === 0;
  const chosen = selectPostgresArtifact({
    sourceHash: targetHash,
    targetSha: sha,
    artifacts,
    runs,
    repo,
    isAncestor,
  });
  // The deploy job downloads this artifact by its id: the one checked here.
  output(`run-id=${chosen.runId}`);
  output(`artifact-id=${chosen.artifactId}`);
  output(`digest=${chosen.digest || "unknown"}`);
  console.log(
    `data input changed ${liveHash.slice(0, 12)}… → ${targetHash.slice(0, 12)}…: delivering the certified artifact ${chosen.artifactId} of run ${chosen.runId} (${chosen.headSha.slice(0, 12)}, ${chosen.digest || "no digest"})`,
  );
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked && invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::postgres-artifact: ${error.message}`);
    process.exit(1);
  });
}
