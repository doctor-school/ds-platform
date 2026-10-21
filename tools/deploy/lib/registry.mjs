// tools/deploy/lib/registry.mjs — the recorded runtime images (#2981), shared by the
// stage slots (`tools/staging/slot.mjs`) and the production deploy (`tools/deploy/prod.mjs`).
//
// Nothing is built on a box. `.github/workflows/runtime-images.yml` builds every
// image ONCE per commit, pushes it to the registry and records the pushed digests in
// the run artifact `images-<sha>` (`images-<sha>.json`). A consumer resolves that
// record on the OPERATOR side, before any box is touched, and the box pulls exactly
// those digests — never a tag, which the registry could re-point (spec
// 2026-10-16-release-pipeline-off-workstation §3 item 1).
//
// Pure apart from `resolveRecordedImagesViaGh` (the operator's own `gh`). Every
// refusal is a `RegistryError`; a caller that owns its own error type converts it
// (`slot.mjs` rethrows it as `SlotError`, unchanged message).

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Raised for an unusable record or plan — the caller must fail closed. */
export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegistryError";
  }
}

export const IMAGE_REGISTRY = "ds-platform.registry.twcstorage.ru";
/** Root-only on every consuming box; read by the box's own shell, never by this tool. */
export const REGISTRY_PULL_TOKEN_FILE = "/etc/ds-platform/registry-pull-token";
export const IMAGES_WORKFLOW = "runtime-images.yml";
/** The manifest keys; each is pulled and tagged locally as `ds-<key>:<sha>`. */
export const RECORDED_IMAGE_NAMES = Object.freeze(["api", "api-migrate", "portal", "admin", "doctor"]);
/** `docker image inspect --format` that prints one RepoDigest per line. */
export const REPO_DIGESTS_FORMAT = "{{range .RepoDigests}}{{println .}}{{end}}";

const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_REF_RE = /^ds-platform\.registry\.twcstorage\.ru\/(pr\/)?([a-z0-9][a-z0-9-]*)@sha256:[0-9a-f]{64}$/;

export const imagesArtifactName = (sha) => `images-${sha}`;

/** `ds-<key>:<sha>` — the local tag compose, inventory, retention and prune all read. */
export const localImageTag = (name, sha) => `ds-${name}:${sha}`;

function assertFullSha(sha) {
  if (!FULL_SHA_RE.test(String(sha ?? ""))) {
    throw new RegistryError(
      `unusable commit id: ${JSON.stringify(sha)} — expected a full 40-character lowercase hex SHA`,
    );
  }
  return sha.slice(0, 7);
}

/** POSIX single-quote: the result is one shell word whatever `text` holds. */
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

/**
 * The five recorded references, each a digest reference of ITS OWN image. `pr` says
 * which namespace they must all come from: `true` = `pr/`, `false` = the release
 * namespace (no prefix: `main` and `hotfix/*` pushes), `undefined` = either (but one
 * for all five).
 */
export function assertImageRefs(images, { pr } = {}) {
  if (!images || typeof images !== "object" || Array.isArray(images)) {
    throw new RegistryError(
      "no recorded image set: a box runs only the digests `runtime-images.yml` recorded " +
        "for its commit, and nothing is built on the box",
    );
  }
  const extra = Object.keys(images).filter((name) => !RECORDED_IMAGE_NAMES.includes(name));
  if (extra.length) throw new RegistryError(`recorded image set has unknown image(s): ${extra.join(", ")}`);
  const namespaces = new Set();
  for (const name of RECORDED_IMAGE_NAMES) {
    const ref = images[name];
    if (typeof ref !== "string") throw new RegistryError(`recorded image set lacks \`${name}\``);
    const match = ref.match(DIGEST_REF_RE);
    if (!match || match[2] !== name) {
      throw new RegistryError(
        `recorded \`${name}\` is not a digest reference of ${IMAGE_REGISTRY}/[pr/]${name}: ${ref}`,
      );
    }
    namespaces.add(Boolean(match[1]));
  }
  if (namespaces.size > 1) throw new RegistryError("recorded image set mixes release and `pr/` references");
  const isPr = [...namespaces][0];
  if (pr !== undefined && pr !== isPr) {
    throw new RegistryError(
      `recorded image set is in the ${isPr ? "`pr/`" : "release"} namespace, but its manifest ` +
        `ref says ${pr ? "a PR" : "a release branch"}`,
    );
  }
  return images;
}

/**
 * The refs whose digests may run a production release — and the stage `main` slot
 * the release pre-flight converges to that same target: a `main` push and a
 * `hotfix/<N>-<slug>` push (the `pnpm deploy:prod --ref` target). Both live in the
 * release namespace; a `pr/<N>` build never does.
 */
export const HOTFIX_MANIFEST_REF_RE = /^hotfix\/[0-9]+-[a-z0-9-]+$/;
export const RELEASE_MANIFEST_REFS = Object.freeze(["main", HOTFIX_MANIFEST_REF_RE]);

/**
 * The manifest policy of a production release: the workstation path
 * (`tools/deploy/prod.mjs`) and the release workflow's runner pre-flight
 * (`tools/deploy/release-runner.mjs`, #3158) resolve the same recorded digests.
 */
export const PROD_MANIFEST_POLICY = Object.freeze({
  acceptRefs: RELEASE_MANIFEST_REFS,
  consumer: "a production release",
  mainOnly: true,
  purpose: "release",
});

const describeRef = (want) => (want instanceof RegExp ? `\`${want.source}\`` : `\`${want}\``);

/**
 * Validates `images-<sha>.json` for `sha`. `acceptRefs` lists the manifest refs the
 * consumer runs — exact strings or anchored RegExps (`["main"]` for slot `main`;
 * a release adds the `hotfix/<N>-<slug>` shape); `consumer` names it in the refusal.
 * The references must sit in the namespace the ref says: `pr/` for a `pr/<N>` ref,
 * the release namespace (no prefix) for every other ref.
 */
export function validateImageManifest(manifest, { sha, acceptRefs, consumer }) {
  const short = assertFullSha(sha);
  if (!Array.isArray(acceptRefs) || acceptRefs.length === 0) {
    throw new RegistryError(`${consumer} names no acceptable manifest ref`);
  }
  if (!manifest || typeof manifest !== "object") {
    throw new RegistryError(`the recorded image manifest for ${short} is not a JSON object`);
  }
  if (manifest.sha !== sha) {
    throw new RegistryError(
      `the image manifest records ${JSON.stringify(manifest.sha)}, not ${sha} — refusing another commit's images`,
    );
  }
  const ref = manifest.ref;
  const accepted = (want) => (want instanceof RegExp ? want.test(ref) : want === ref);
  if (typeof ref !== "string" || !acceptRefs.some(accepted)) {
    throw new RegistryError(
      `${consumer} accepts only ${acceptRefs.map(describeRef).join(" or ")} manifests; ` +
        `the manifest for ${short} is ${JSON.stringify(ref)}`,
    );
  }
  const images = assertImageRefs(manifest.images, { pr: ref.startsWith("pr/") });
  return { ref, images: { ...images } };
}

/**
 * The `runtime-images.yml` run whose artifact is read — or a refusal.
 *
 * Fail closed: no run, a run still going or a failed run is a stop with the cause,
 * NEVER a fallback build — no box builds any more. `mainOnly` keeps only branch
 * builds (push / dispatch — `main`, or a `hotfix/*` branch; the manifest ref decides
 * which the consumer accepts); `purpose` is the verb of the refusal («stage», «release»).
 */
export function selectImagesRun(runs, { sha, mainOnly, purpose }) {
  assertFullSha(sha);
  const candidates = (Array.isArray(runs) ? runs : []).filter(
    (run) => !mainOnly || run.event === "push" || run.event === "workflow_dispatch",
  );
  const success = candidates.find((run) => run.status === "completed" && run.conclusion === "success");
  if (success) return success;
  const running = candidates.find((run) => run.status !== "completed");
  if (running) {
    throw new RegistryError(`runtime-images run ${running.url} is ${running.status}; retry when it completes`);
  }
  if (candidates.length) {
    const failed = candidates[0];
    throw new RegistryError(
      `runtime-images run ${failed.url} concluded ${failed.conclusion}: no images recorded for ${sha}`,
    );
  }
  throw new RegistryError(
    `no images recorded for ${sha}: there is no ${mainOnly ? "branch-push " : ""}` +
      `${IMAGES_WORKFLOW} run for this commit (${
        mainOnly
          ? "only a branch push (`main`, or a `hotfix/*` branch for a release) records the digests this consumer accepts"
          : "a PR head that changes no image input does not run it"
      }) — nothing to ${purpose}`,
  );
}

/**
 * Operator-side resolution of the recorded digests: run → artifact → validated set.
 * `gh(argv)` resolves to stdout; `readText(path)` reads the downloaded manifest.
 */
export async function resolveRecordedImages({
  sha,
  acceptRefs,
  consumer,
  mainOnly,
  purpose,
  gh,
  readText,
  tmpDir,
}) {
  const runs = JSON.parse(
    await gh([
      "run",
      "list",
      "--workflow",
      IMAGES_WORKFLOW,
      "--commit",
      sha,
      "--json",
      "databaseId,status,conclusion,event,url",
      "--limit",
      "20",
    ]),
  );
  const run = selectImagesRun(runs, { sha, mainOnly, purpose });
  const name = imagesArtifactName(sha);
  let text;
  try {
    await gh(["run", "download", String(run.databaseId), "-n", name, "-D", tmpDir]);
    text = await readText(join(tmpDir, `${name}.json`));
  } catch (err) {
    throw new RegistryError(
      `runtime-images run ${run.url} has no readable artifact ${name} ` +
        `(${err instanceof Error ? err.message.split("\n")[0] : err}) — nothing to ${purpose}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new RegistryError(`artifact ${name} of ${run.url} is not JSON`);
  }
  return { ...validateImageManifest(manifest, { sha, acceptRefs, consumer }), run };
}

/** {@link resolveRecordedImages} through the operator's own `gh`, in a throwaway temp dir. */
export async function resolveRecordedImagesViaGh(options) {
  const tmpDir = mkdtempSync(join(tmpdir(), "ds-images-"));
  try {
    return await resolveRecordedImages({
      ...options,
      tmpDir,
      readText: async (path) => readFileSync(path, "utf8"),
      gh: (argv) =>
        new Promise((resolve, reject) => {
          execFile("gh", argv, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(`gh ${argv.slice(0, 2).join(" ")}: ${(stderr || err.message).trim()}`));
            else resolve(stdout);
          });
        }),
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * `sudo sh -c "<login> && docker pull <ref> && docker tag <ref> <tag>"`, as argv.
 *
 * The login reads the pull token from its root-only file INSIDE the box's shell —
 * the token is never in an argv, a log line or a plan. The same shell logs out on
 * exit, a failed pull included, so `docker login` never leaves a second copy of the
 * token in root's docker config: the token file stays the only registry credential
 * at rest on the box ({@link registryLogoutArgv} closes the sequence).
 */
export function pullAndTagArgv(ref, tag) {
  const logoutOnExit = `trap 'docker logout ${IMAGE_REGISTRY} >/dev/null 2>&1' EXIT;`;
  const login = `${logoutOnExit} docker login ${IMAGE_REGISTRY} -u ds-platform --password-stdin < ${REGISTRY_PULL_TOKEN_FILE}`;
  return ["sudo", "sh", "-c", `${login} >/dev/null && docker pull ${ref} && docker tag ${ref} ${tag}`];
}

/** Probe argv: the local tag's RepoDigests, one per line. */
export function repoDigestsProbeArgv(tag) {
  return ["sudo", "docker", "image", "inspect", "--format", REPO_DIGESTS_FORMAT, tag];
}

/** True when the probe output carries exactly `ref` on one of its lines. */
export function repoDigestsMatch(stdout, ref) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .some((line) => line.trim() === ref);
}

/**
 * Unconditional, after the pulls: a run where every tag was reused never runs a
 * pull shell, and a credential an older tool version left in root's docker config
 * must not survive it either. `docker logout` without a stored login is a no-op.
 */
export function registryLogoutArgv() {
  return ["sudo", "docker", "logout", IMAGE_REGISTRY];
}

/**
 * One remote bash script (errexit) that brings the five recorded images onto the box
 * as `ds-<image>:<sha>`: a tag whose RepoDigests already carry the recorded digest is
 * reused (a same-SHA re-run pulls nothing), any other is pulled and re-tagged; the box
 * then logs out of the registry. Prints `pull:<image>=REUSED|PULLED`.
 */
export function pullRecordedImagesScript({ sha, images }) {
  assertFullSha(sha);
  assertImageRefs(images);
  const lines = RECORDED_IMAGE_NAMES.map((name) => {
    const ref = images[name];
    const tag = localImageTag(name, sha);
    return [
      `if ${repoDigestsProbeArgv(tag).map(shellQuote).join(" ")} 2>/dev/null | grep -Fxq ${shellQuote(ref)}; then`,
      `  echo 'pull:${name}=REUSED'`,
      "else",
      `  ${pullAndTagArgv(ref, tag).map(shellQuote).join(" ")}`,
      `  echo 'pull:${name}=PULLED'`,
      "fi",
    ].join("\n");
  });
  return [...lines, `${registryLogoutArgv().join(" ")} >/dev/null`].join("\n");
}

/** Prints `digest:<image>=OK` per image whose local tag carries its recorded digest. */
export function imageDigestScript({ sha, images }) {
  assertFullSha(sha);
  assertImageRefs(images);
  return RECORDED_IMAGE_NAMES.map((name) => {
    const ref = images[name];
    return [
      `d=$(sudo docker image inspect --format '${REPO_DIGESTS_FORMAT}' ${localImageTag(name, sha)} 2>/dev/null) || d=ABSENT`,
      `if printf '%s\\n' "$d" | grep -Fxq '${ref}'; then echo "digest:${name}=OK"; ` +
        `else echo "digest:${name}=MISMATCH $(printf '%s' "$d" | tr '\\n' ' ')"; fi`,
    ].join("\n");
  }).join("\n");
}

/** A missing verdict is a failure: truncated output must not read as «all match». */
export function assertImageDigests(stdout, images) {
  const verdicts = Object.fromEntries(
    String(stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^digest:([a-z0-9-]+)=(\w+)/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
  const bad = Object.keys(images).filter((name) => verdicts[name] !== "OK");
  if (bad.length) {
    throw new RegistryError(
      `the local images do NOT carry the recorded digests: ${bad
        .map((name) => `${name}=${verdicts[name] ?? "NO-VERDICT"}`)
        .join(", ")}`,
    );
  }
  return verdicts;
}

/** Read-only: is the pull token provisioned (non-empty, root-readable)? Never prints it. */
export function pullTokenProbeScript() {
  return `if sudo test -s ${REGISTRY_PULL_TOKEN_FILE}; then echo pull-token=present; else echo pull-token=absent; fi`;
}

/** Fail-closed verdict over {@link pullTokenProbeScript}'s output. */
export function pullTokenVerdict(output, { host }) {
  const lines = String(output ?? "").split(/\r?\n/).map((line) => line.trim());
  if (lines.includes("pull-token=present")) return { ok: true, reason: null };
  return {
    ok: false,
    reason:
      `${REGISTRY_PULL_TOKEN_FILE} is ${lines.includes("pull-token=absent") ? "missing or empty" : "unverifiable"} ` +
      `on ${host}: the box pulls the recorded images with it and builds nothing. Provision the ` +
      "read-only registry pull token there (root:root 0600) — infra/deploy/README.md → Container registry",
  };
}
