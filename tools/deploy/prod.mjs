#!/usr/bin/env node
// DS Platform — idempotent prod deploy (DSO-126/127/128/129).
//
// The one release pipeline for the always-on Timeweb prod environment (api-prod
// public + data-prod private), formalising the manual runbook in
// infra/deploy/README.md §5–§10; it does not replace first-time provisioning
// (Terraform, DNS, secrets, Zitadel first-boot bootstrap). Two entry points run it:
//   - `--local` — the box-local release/rollback body: the prod release driver on
//     ds-api-prod runs it for every Actions `deploy-prod.yml` release and its
//     rollback mode (below);
//   - `pnpm deploy:prod` — the break-glass workstation command (owner's word, the
//     owner's offline `breakglass` key): a hotfix `--ref`, a workstation
//     `--rollback`, and the gate exceptions.
//
//   Usage (break-glass, workstation):
//     pnpm deploy:prod                 release origin/main (default)
//     pnpm deploy:prod --ref <sha>        HOTFIX deploy: ship exactly <sha> (a
//                                          cherry-pick branch cut FROM the SHA
//                                          running in prod) instead of all of
//                                          origin/main — #1881, spec §10.11
//     pnpm deploy:prod --rollback <sha>   app-only rollback to a prior SHA tag
//     pnpm deploy:prod --skip-ci-check    (escape hatch; logs a loud warning)
//     pnpm deploy:prod --allow-live-broadcast   (escape hatch for the live-эфир
//                                          hold — owner-approved urgent ship ONLY,
//                                          release-cycle spec §10.4 item 7)
//     pnpm deploy:prod --release-gate-exempt "<reason>"   (escape hatch for the
//                                          release-blocker / open batched
//                                          Stage-B hold — #1662 — and the
//                                          stage `main` check — #2701; reason
//                                          is mandatory and loudly printed)
//     node tools/deploy/prod.mjs --local --images-file <path|->
//                                          the prod release driver's run ON
//                                          ds-api-prod (#3157, below)
//
// Box-local run (`--local`, #3157; tech spec 2026-10-16 release pipeline §5 «Prod
// release driver»): `infra/deploy/bin/release-driver` runs this file from the
// codeload tree of the released SHA inside the unit `ds-prod-<sha12>-driver`, with
// the recorded `images-<sha>.json` on stdin. It runs every box step of the plan
// below (`DEPLOY_PLAN`), in the same order, minus the steps that need the operator's
// git and gh (`OPERATOR_ONLY_STEPS`: the pre-flight, the release cut and the
// Deployment record — the release workflow runs them). api-prod is the box itself
// (`LOCAL_EXECUTOR`); data-prod is the VPC hop `deploy@<data-prod VPC IP>` with
// `/home/deploy/.ssh/data-prod-hop`.
//
// Hotfix path (`--ref <sha>`, #1881 / spec §10.11): prod is behind main and a
// single already-merged fix must ship WITHOUT everything else on main. The extra
// pre-flight invariants keep "prod runs reviewed, merged code" true — the target
// must be a strict descendant of the LIVE deployed SHA, and every commit in
// `deployed..target` must have an equivalent commit on `origin/main` (i.e. be a
// cherry-pick of merged work). Arbitrary-branch / feature-preview deploys stay
// forbidden; the decision seams live in tools/deploy/hotfix-ref.mjs.
//
// Pipeline (deploy):
//   pre-flight  clean tree · HEAD==origin/main · green CI for the SHA (gh)
//               · no live broadcast (tools/deploy/live-broadcast-check.mjs)
//               · release gate (tools/deploy/release-gate.mjs)
//               · stage gate: a `main` target's `stage-suite` status (Actions);
//                 a `--ref` target converges the slot and runs the full stage
//                 suite (tools/deploy/stage-main-check.mjs)
//   ship        git archive <sha> → api-prod + data-prod over ssh (compose + configs)
//   data-prod   verify cluster/artifacts → up immutable images (no build/pull)
//   checkpoint  pgbackrest pre-migrate incr backup  (DSO-129 — BEFORE migrate)
//   api-prod    pull the recorded `main`/`hotfix/*` digests (resolved in pre-flight, #2981)
//               as ds-<image>:<sha> → boot-verify → migrate → up -d (verify set
//               derived from the TARGET tree's compose, #1896); nothing is built
//   config      compare running bind mounts; restart only stale consumers (#1175)
//   retention   keep the last 3 SHA-tagged images per repo  (DSO-127)
//   smoke       tools/deploy/smoke-prod.mjs --expect-sha <sha>  (DSO-128)
//
// Fail-closed: it refuses a dirty tree / detached-from-main HEAD / red CI, and
// stops at the FIRST red step, printing a rollback pointer — never "fixes prod
// by hand". Idempotent + safe to re-run: archive overwrite, `up -d`, and
// `drizzle-kit migrate` are all no-ops when already current.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cutDeployRelease } from "../release/cut-release.mjs";
import {
  DEPLOY_PROD_WORKFLOW_PATH,
  ciVerdictProblem,
  classifyDeployCheckRuns,
  fetchDeployCiBoard,
} from "./ci-gate.mjs";
import { recordDeployment as recordDeploymentRecord } from "./deployment-record.mjs";
import {
  REF_FLAG,
  hotfixPreflightVerdict,
  verifyHotfixCommits,
  parseRefFlag,
} from "./hotfix-ref.mjs";
import {
  assertCodeGeneratorConverged,
  assertPasswordPolicyConverged,
  formatCodeGenerator,
  formatPasswordPolicy,
  parsePasswordMinLength,
  resolveEmailedCodeExpectation,
} from "./idp-policy.mjs";
import {
  RELEASE_GATE_EXEMPT_FLAG,
  evaluateReleaseGate,
  formatReleaseGateClear,
  formatReleaseGateHold,
  parseReleaseGateExempt,
  probeHealthSha,
  probeReleaseGate,
} from "./release-gate.mjs";
import {
  STAGE_SUITE_CONTEXT,
  combinedStatusViaGh,
  readStageSuiteProblem,
} from "./release-runner.mjs";
import {
  checkStageMainPrerequisites,
  runStageMainCheck,
} from "./stage-main-check.mjs";
import {
  assertPostgresEvidence,
  certifiedTarget,
  guardedPostgresStep,
  postgresImageOverride,
  postgresProbeRequest,
  postgresStateRecord,
  readPostgresTarget,
  readPostgresTargetFromTree,
} from "./postgres-guard.mjs";
import {
  assertRollbackAllowed,
  makeGitCutoverMigrationProbe,
  makeProdCutoverReader,
  makeTreeCutoverMigrationProbe,
  RollbackFloorError,
} from "./rollback-floor.mjs";
import {
  API_PROD_COMPOSE_PATH,
  bootProbeSet,
  deployServiceSet,
  formatServiceImages,
  formatServiceNames,
  rollbackBoundaryVerdict,
  shellVarName,
} from "./service-set.mjs";
import {
  IMAGE_REGISTRY,
  IMAGES_FILE_STDIN,
  PROD_MANIFEST_POLICY,
  RECORDED_IMAGE_NAMES,
  assertImageDigests,
  imageDigestScript,
  pullRecordedImagesScript,
  pullTokenProbeScript,
  pullTokenVerdict,
  readImageManifestFile,
  resolveRecordedImagesViaGh,
  validateImageManifest,
} from "./lib/registry.mjs";
import {
  DATA_PROD_HOP_KEY,
  DATA_PROD_HOP_KNOWN_HOSTS,
  LOCAL_EXECUTOR,
  PROD_HEALTH_URL,
  PROD_LIVE_TREE,
  RELEASE_DRIVER_BIN,
  STALL_BUDGET_BUILD_MS,
  BOX_ENTRYPOINTS,
  boxSpawnArgs,
  hopDestination,
  releaseCheckScript,
  releaseFinishScript,
  releaseInstallFromSourceScript,
  releaseInstallScript,
  releaseSupersedeScript,
  rollbackUnitName,
  runDurableStep,
  shipTree as shipCommittedTree,
  sshCapture as boxCapture,
  sshScript as boxScript,
} from "./lib/remote.mjs";
import { OPTIONAL_VHOST_PROBES } from "./smoke-prod.mjs";
import { createDataProdClient } from "./lib/data-prod.mjs";

// The ssh/ship primitives live in ./lib/remote.mjs so the staging slot tool
// drives its box through exactly the same channel (#2194). They are re-exported
// here unchanged: tools/lint/guard-tests/deploy-*.spec.ts import them from this
// module, and the import path of a guard test is part of its contract.
export {
  PROD_HEALTH_URL,
  STALL_BUDGET_BUILD_MS,
  STALL_BUDGET_DEFAULT_MS,
  createStallWatchdog,
  formatStallMessage,
  shipTreeCommand,
  sshBaseArgs,
} from "./lib/remote.mjs";

// --- config (env-overridable; SSH aliases live in ~/.ssh/config) ----------

// `let`: a `--local` run (#3157) re-points both before its first step (`useLocalHosts`).
// #2987: the operator path is break-glass only, and on ds-api-prod deploy is the CI
// user (forced command, no shell): the operator connects as `breakglass`.
export const BREAKGLASS_API_PROD = "breakglass@ds-api-prod";
let API_PROD = process.env.DS_API_PROD_SSH || BREAKGLASS_API_PROD;
let DATA_PROD = process.env.DS_DATA_PROD_SSH || "ds-data-prod";
// #3054: the entrypoint a run that ships no tree (`--rollback`) installs on the
// boxes, read from the operator checkout's HEAD commit (with ds-deploy-entrypoint,
// #2984: BOX_ENTRYPOINTS).
const DS_RELEASE_PATH = "infra/deploy/bin/ds-release";
const REPO_ROOT = join(import.meta.dirname, "..", "..");
const REMOTE_TREE = PROD_LIVE_TREE;
const VPC_IP = process.env.DS_DATA_PROD_VPC_IP || "192.168.0.10";
const IMAGE_RETENTION = 3;
// #3157: the tree a `--local` run reads its target files from and ships — the codeload
// tree of the released SHA the release driver extracted (null on the operator path,
// which reads and ships the committed SHA through git).
let LOCAL_TREE = null;
// #3320: the data-prod command form of the run's login (lib/data-prod.mjs): the
// workstation's `breakglass` shell, or the `--local` hop key's forced command.
let DATA_PROD_FORM = "sudo";
const API_COMPOSE = `${REMOTE_TREE}/infra/deploy/compose/api-prod`;
// #3313: ds-data-prod's compose dir is the entrypoint's DATA_COMPOSE, addressed by its verbs.

// --- #2981: the recorded release images ------------------------------------
// api-prod builds nothing. A release runs only the digests `runtime-images.yml`
// recorded for a push to `main` or to a `hotfix/<N>-<slug>` branch (the `--ref`
// path) — spec 2026-10-16-release-pipeline-off-workstation §3 item 1; `pr/`
// digests never reach production. Resolved on the operator side in pre-flight,
// pulled on the box by digest, tagged `ds-<image>:<sha>`, and proven by
// RepoDigests before anything boots. The shared mechanics live in
// ./lib/registry.mjs (the stage slots use the same ones). The manifest proves the
// images only; the hotfix pre-flight (./hotfix-ref.mjs) still proves the
// cherry-pick ancestry on its own.
export { PROD_MANIFEST_POLICY };

/** Validates a recorded manifest for a production release of `sha` (pure). */
export function validateProdImageManifest(manifest, sha) {
  return validateImageManifest(manifest, { ...PROD_MANIFEST_POLICY, sha });
}

// --- #3157: the plan, and its box-local run (the prod release driver) -------

/**
 * Every phase of `deploy()`, in its order. `deploy()` walks exactly this list
 * (`planWalker` refuses a phase out of order), so the list IS the release's order.
 * The smoke runs before `finish`: a red smoke ends the release `failed`.
 */
export const DEPLOY_PLAN = Object.freeze([
  "preflight",
  "test-token",
  "service-set",
  "postgres-verify",
  "previous-sha",
  "runtime-config-backup",
  "ship",
  "install",
  "data-prod-env",
  "data-prod-up",
  "backup",
  "pull",
  "boot-verify",
  "runtime-config-validate",
  "idp",
  "migrate",
  "runtime-configs",
  "verify-running-sha",
  "prune",
  "smoke",
  "finish",
  "release-cut",
  "deployment-record",
]);

/**
 * The phases that need the operator's checkout and `gh`. A `--local` run skips them:
 * the release workflow runs the pre-flight before it calls the box, and the release
 * cut and the Deployment record after a terminal status (spec §3 item 3).
 */
export const OPERATOR_ONLY_STEPS = Object.freeze(["preflight", "release-cut", "deployment-record"]);

/** The phases a run executes, in order. */
export function deployPlan({ local = false } = {}) {
  return DEPLOY_PLAN.filter((id) => !local || !OPERATOR_ONLY_STEPS.includes(id));
}

/**
 * The cursor `deploy()` walks the plan with. `phase(id)` enters a phase every run
 * executes; `operatorPhase(id)` an operator-only one, answering whether this run
 * executes it. Either refuses a phase out of `DEPLOY_PLAN` order or a skipped phase
 * this run executes; `done()` refuses a run that left one out.
 */
export function planWalker({ local = false } = {}) {
  const plan = deployPlan({ local });
  let at = 0;
  const advance = (id) => {
    const index = DEPLOY_PLAN.indexOf(id, at);
    if (index < 0) throw new Error(`deploy phase ${id} is out of plan order`);
    const missed = DEPLOY_PLAN.slice(at, index).find((skipped) => plan.includes(skipped));
    if (missed) throw new Error(`deploy phase ${missed} was left out before ${id}`);
    at = index + 1;
    return plan.includes(id);
  };
  return {
    phase(id) {
      if (OPERATOR_ONLY_STEPS.includes(id)) throw new Error(`${id} is an operator-only phase`);
      advance(id);
    },
    operatorPhase(id) {
      if (!OPERATOR_ONLY_STEPS.includes(id)) throw new Error(`${id} runs on every path`);
      return advance(id);
    },
    done() {
      const missed = DEPLOY_PLAN.slice(at).find((id) => plan.includes(id));
      if (missed) throw new Error(`deploy phase ${missed} was left out`);
    },
  };
}

/**
 * The boxes of a `--local` run on ds-api-prod: api-prod is the box itself, data-prod
 * the VPC hop as `deploy` with the dedicated hop key (spec §4, §5).
 */
export function localProdHosts({ dataProdAddress = VPC_IP } = {}) {
  return {
    api: LOCAL_EXECUTOR,
    data: hopDestination({
      user: "deploy",
      address: dataProdAddress,
      identityFile: DATA_PROD_HOP_KEY,
      knownHostsFile: DATA_PROD_HOP_KNOWN_HOSTS,
    }),
  };
}

function useLocalHosts() {
  const hosts = localProdHosts();
  API_PROD = hosts.api;
  DATA_PROD = hosts.data;
  DATA_PROD_FORM = "forced";
  LOCAL_TREE = REPO_ROOT;
}

const LOCAL_FLAG = "--local";
const IMAGES_FILE_FLAG = "--images-file";

const ROLLBACK_FLAG = "--rollback";

/**
 * `--local [--rollback <sha>] --images-file <path|->` (`-`: the inherited stdin).
 * `--rollback <sha>` (the full SHA) is the one mode flag `--local` admits: the
 * box-side rollback's run from the tooling tree (#2987, spec §5 «Prod rollback»).
 * Nothing else goes with them: a hotfix `--ref` and every escape hatch stay on the
 * operator path (spec §5 «Prod release driver»). Returns `{ local: null }`,
 * `{ local: { imagesFile } }`, `{ local: { imagesFile, rollback } }` or `{ error }`.
 */
export function parseLocalFlags(args) {
  const local = args.includes(LOCAL_FLAG);
  const at = args.indexOf(IMAGES_FILE_FLAG);
  if (!local && at < 0) return { local: null };
  if (!local || at < 0) return { error: "`--local` and `--images-file <path|->` go together" };
  const imagesFile = args[at + 1];
  if (!imagesFile || imagesFile.startsWith("--")) {
    return { error: "`--images-file` requires a path (`-`: stdin)" };
  }
  const rb = args.indexOf(ROLLBACK_FLAG);
  let rollback = null;
  if (rb >= 0) {
    rollback = args[rb + 1];
    if (!/^[0-9a-f]{40}$/.test(String(rollback))) {
      return { error: "`--local --rollback` takes the full 40-hex SHA of the target" };
    }
  }
  const taken = new Set([at, at + 1, ...(rb >= 0 ? [rb, rb + 1] : [])]);
  const rest = args.filter((arg, index) => arg !== LOCAL_FLAG && !taken.has(index));
  if (rest.length > 0) {
    return {
      error:
        `\`--local\` takes no other flag (${rest.join(" ")}): a hotfix and` +
        " every escape hatch stay on the operator path",
    };
  }
  return { local: rollback ? { imagesFile, rollback } : { imagesFile } };
}

/** A file of the target commit: `git show` on the operator path, the extracted tree on the box. */
function targetFile(sha, path) {
  if (LOCAL_TREE) return readFileSync(join(LOCAL_TREE, ...path.split("/")), "utf8").trim();
  return localCap("git", ["show", `${sha}:${path}`]);
}

/** The ship: the committed SHA (`git archive`), or on the box the tree it runs from. */
function shipTree(sha, host) {
  return shipCommittedTree(sha, host, prodShipOptions(host, { api: API_PROD, localTree: LOCAL_TREE }));
}

// #3313: ds-data-prod is reached only through the data verbs of its entrypoint (spec §5
// «Data-prod verbs.»), one client per run, created on first use (after --local has
// chosen the hosts and the form: the hop's forced command, else breakglass's sudo -n).
let dataProdClient = null;
function dataProd() {
  dataProdClient ??= createDataProdClient({ host: DATA_PROD, form: DATA_PROD_FORM });
  return dataProdClient;
}

async function shipDataProd(sha) {
  return shipCommittedTree(sha, DATA_PROD, {
    ...prodShipOptions(DATA_PROD, { api: API_PROD, localTree: LOCAL_TREE }),
    remoteCommand: await dataProd().command(["ship", sha]),
  });
}

/** The data-env payload: the VPC address and the recorded PostgreSQL image ids. */
export function dataProdEnvPayload(live, vpcIp = VPC_IP) {
  const { services } = JSON.parse(postgresImageOverride(live));
  return JSON.stringify({
    vpcIp,
    images: { postgres: services.postgres.image, pgbackrest: services.pgbackrest.image },
  });
}

/** `--except <unit>` of the box-side rollback, as the data verbs' optional word. */
export function dataProdExcept({ exceptUnit } = {}) {
  return exceptUnit === undefined ? [] : [exceptUnit];
}

/** A durable data-prod step (`up`, `backup`): started and polled through its verbs. */
function dataProdStep(sha, step, label) {
  const verb = step === "up" ? "data-up" : step;
  return runDurableStep(DATA_PROD, {
    env: RELEASE_ENV,
    sha,
    step,
    label,
    retryFailed: RETRY_FAILED,
    startStep: () => dataProd().call([verb, sha, ...(RETRY_FAILED ? ["retry-failed"] : [])]),
    readStatus: () =>
      dataProd().call(["status", RELEASE_ENV, sha], { sshOptions: ["-o", "ConnectTimeout=15"] }),
  });
}

/**
 * #2987: the ship options of a prod box. Both boxes ship into PROD_LIVE_TREE; on
 * ds-api-prod the writer is the root release unit or `breakglass`, never the tree's
 * owner deploy, so that ship runs as root. data-prod is reached as deploy (the VPC hop,
 * or the operator's ProxyJump) and ships as deploy.
 */
export function prodShipOptions(host, { api, localTree = null }) {
  return {
    liveDir: PROD_LIVE_TREE,
    asRoot: host === api,
    ...(localTree ? { sourceDir: localTree } : {}),
  };
}

/**
 * #2987: the script options of a prod box. The break-glass operator `breakglass`
 * reaches ds-api-prod as itself and the live tree there is root's (spec §4 «sudo on
 * prod»), so every script it sends that box runs as root. A `--local` run is the
 * root release unit already (api = LOCAL_EXECUTOR) and runs its scripts as they are;
 * data-prod is reached as deploy and stays deploy.
 */
export function prodScriptOptions(host, { api }) {
  return { asRoot: host === api && api !== LOCAL_EXECUTOR };
}

// The one transport of every prod script: each call site goes through these two, so
// the root decision above is made once, for every step, the durable ones included.
function sshScript(host, script, options = {}) {
  return boxScript(host, script, { ...options, ...prodScriptOptions(host, { api: API_PROD }) });
}
function sshCapture(host, script, options = {}) {
  return boxCapture(host, script, { ...options, ...prodScriptOptions(host, { api: API_PROD }) });
}

/**
 * Records the previous prod SHA for `status prod <sha>` (`driver.previousSha`, the
 * release-notes basis the runner reads without box access) through the installed
 * release driver.
 */
export function recordPreviousShaScript(sha, prevSha) {
  return `${RELEASE_DRIVER_BIN} record-previous prod ${sha} ${prevSha ?? "none"}\n`;
}

// A release moves production forward: a SHA that does not descend from the live one
// is a downgrade — a rollback, which goes through `--rollback` and its migration floor
// (`assertRollbackAllowed`), never through a release. The release driver refuses it
// before it starts the unit; the unit refuses it again, so a direct `--local` run
// cannot skip the check (spec §5 «Prod release driver»).
const GITHUB_COMPARE_API = "https://api.github.com/repos/doctor-school/ds-platform/compare";

/** GitHub's unauthenticated `compare <base>...<head>` status, or null when it cannot answer. */
export async function compareStatus(base, head, { fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const response = await fetchImpl(`${GITHUB_COMPARE_API}/${base}...${head}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: ac.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body && !Array.isArray(body) && typeof body.status === "string" ? body.status : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pure: may a release of `sha` replace the live prod SHA `live`? (compare `ahead`/`identical`) */
export function descendsFromLiveVerdict({ live, sha, status }) {
  if (!live) {
    return {
      ok: false,
      reason:
        "the live prod SHA is unknown (no running ds-api-prod-api-1) — release it from the workstation path",
    };
  }
  if (status === "ahead" || status === "identical") return { ok: true };
  return {
    ok: false,
    reason: `${sha} does not descend from the live prod SHA ${live.slice(0, 12)} — a downgrade is a rollback (deploy-prod.yml with mode: rollback)`,
  };
}

/**
 * Pure (#2987): may the box-side rollback put `sha` back in place of the live SHA
 * `live`? Only a strict ancestor (compare `behind`) — the mirror of
 * `descendsFromLiveVerdict`; the release driver refuses the same before it starts
 * the unit, and the unit refuses again so a direct `--local --rollback` cannot skip it.
 */
export function rollbackTargetVerdict({ live, sha, status }) {
  if (!live) {
    return { ok: false, reason: "the live prod SHA is unknown (no running ds-api-prod-api-1)" };
  }
  if (status === "behind") return { ok: true };
  return {
    ok: false,
    reason: `${sha} is not behind the live prod SHA ${live.slice(0, 12)} (compare status: ${status ?? "unknown"}) — a rollback never moves production forward`,
  };
}

const CODELOAD_URL = "https://codeload.github.com/doctor-school/ds-platform/tar.gz";

/**
 * #2987: the target tree of the box-side rollback — the target SHA's codeload tree,
 * fetched as a release fetches its own, into `dir` (top directory stripped). The
 * target's files are read only from there; it is never executed. Any failure is no
 * tree (null): the caller refuses the rollback as unresolved.
 */
export async function fetchTargetTree(sha, { dir, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 600_000);
  try {
    const response = await fetchImpl(`${CODELOAD_URL}/${sha}`, { signal: ac.signal });
    if (!response?.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    const archive = `${dir}.tar.gz`;
    writeFileSync(archive, bytes);
    const tar = spawnSync("tar", ["xzf", archive, "--strip-components=1", "-C", dir], { stdio: "ignore" });
    rmSync(archive, { force: true });
    return tar.status === 0 ? dir : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every repo the box holds SHA-tagged images of — the retention set. NOT
 * target-derived on purpose (#1896): retention must reclaim tags of every repo
 * the box has ever pulled, including one absent from a hotfix target's compose.
 */
export const RETAINED_IMAGE_REPOS = Object.freeze(
  RECORDED_IMAGE_NAMES.map((name) => `ds-${name}`),
);

/**
 * The api-prod compose's interpolation file (`.env` beside compose.yml, kept
 * across `shipTree` by `preserved`). Every `${VAR:?}` the compose requires must
 * be rendered here — deploy and rollback both write it before their first compose
 * call, and every later compose call (migrate, up, runtime-config restart) reads
 * it. Rewrites ONLY the DEPLOY_SHA line: the file also carries other non-secret
 * interpolation vars (SMARTCAPTCHA_SITE_KEY, #729/#186) a clobbering `>` would wipe.
 */
export const API_PROD_ENV_RENDERED_VARS = Object.freeze(["DEPLOY_SHA"]);

export function deployShaEnvScript(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ""))) {
    throw new Error(`DEPLOY_SHA must be a full commit SHA, got ${JSON.stringify(sha)}`);
  }
  return `{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env`;
}

/**
 * The on-box pull step: the recorded digests, reused when a local tag already
 * carries them, logged out after. The token is read on the box from its root-only
 * file — it never appears in this script.
 */
export function apiProdPullScript({ sha, images }) {
  return `${pullRecordedImagesScript({ sha, images })}\n`;
}

/** The retention script: keep the newest `keep` SHA tags of every retained repo. */
export function retentionScript(keep = IMAGE_RETENTION) {
  return `prune_repo() {
  repo="$1"; keep="$2"
  # \`|| true\` on grep: under pipefail a grep that filters out EVERY line (e.g.
  # only a legacy \`:local\` tag exists — no SHA tags) exits 1, which would abort
  # the whole deploy. "nothing to prune" is success, not failure.
  sudo docker images "$repo" --format '{{.CreatedAt}}\\t{{.Tag}}' \\
    | { grep -vP '\\tlocal$' || true; } \\
    | sort -r \\
    | awk -v k="$keep" -F'\\t' 'NR>k{print $2}' \\
    | while IFS= read -r tag; do
        [ -n "$tag" ] && sudo docker rmi "$repo:$tag" >/dev/null 2>&1 || true
      done
}
# \`prune_repo\` is a no-op for a repo with no images; an image a running
# container uses is refused by \`docker rmi\` (no -f) and kept.
${RETAINED_IMAGE_REPOS.map((repo) => `prune_repo ${repo} ${keep}`).join("\n")}
# A pull leaves the registry digest reference (\`<registry>/<image>@sha256:…\`)
# beside the local tag; on this box's containerd image store it is a record of
# its own and keeps the content alive after the tag is pruned. Drop every one
# that no kept \`ds-*\` tag shares an image ID with (a running container's image
# is refused by \`docker rmi\` and kept).
kept_ids=$(sudo docker images --format '{{.Repository}} {{.ID}}' | awk '$1 ~ /^ds-/ {print $2}' | sort -u)
sudo docker images --digests --filter 'reference=${IMAGE_REGISTRY}/*' --format '{{.Repository}}@{{.Digest}} {{.ID}}' \\
  | while read -r ref id; do
      if printf '%s\\n' "$kept_ids" | grep -Fxq "$id"; then continue; fi
      sudo docker rmi "$ref" >/dev/null 2>&1 || true
    done
echo "retained ds-api tags:"; sudo docker images ds-api --format '  {{.Tag}} ({{.CreatedAt}})'
`;
}

/**
 * The prod migrate + swap. The migrate image is the recorded `api-migrate` digest
 * tagged with the same SHA, so nothing is (re)built: no `--build`.
 * `</dev/null`: compose run attaches the container's stdin by default — never let
 * it read this shell's stdin (see REMOTE_BASH; defense in depth).
 */
export function migrateAndUpScript() {
  return `cd ${API_COMPOSE}
echo '── migrate (drizzle-kit; idempotent) ──'
sudo docker compose --profile migrate run --rm migrate </dev/null
echo '── up -d ──'
sudo docker compose up -d
`;
}

// `shipTree` replaces the remote tree, so single-file bind mounts stay pinned
// to the pre-deploy inodes until their containers restart. Compare the shipped
// host files with copies read through the RUNNING containers via `docker exec
// cat` — `docker cp` on a single-file bind mount resolves to the HOST source
// path and so always reads the shipped file (#2801). Both images ship `cat`.
// A missing/unreadable comparison is conservatively stale. The post-restart
// comparison is the fail-closed proof that the shipped bytes are really mounted.
const RUNTIME_CONFIG_SERVICES = ["caddy", "centrifugo"];

export function runtimeConfigComparisonScript() {
  return `cd ${API_COMPOSE}
mounted_file_matches() {
  local service="$1" shipped_path="$2" mounted_path="$3"
  local container_id mounted_copy result
  container_id=$(sudo docker compose ps -q "$service")
  [ -n "$container_id" ] || return 1
  mounted_copy=$(mktemp)
  if sudo docker exec "$container_id" cat "$mounted_path" >"$mounted_copy" 2>/dev/null \\
     && sudo cmp -s "$shipped_path" "$mounted_copy"; then
    result=0
  else
    result=1
  fi
  sudo rm -f "$mounted_copy"
  return "$result"
}
if mounted_file_matches caddy Caddyfile /etc/caddy/Caddyfile; then
  echo 'caddy=match'
else
  echo 'caddy=mismatch'
fi
if mounted_file_matches centrifugo centrifugo/config.json /centrifugo/config.json; then
  echo 'centrifugo=match'
else
  echo 'centrifugo=mismatch'
fi
`;
}

export function runtimeConfigServicesToRestart(comparisonOutput) {
  const matches = new Set(
    comparisonOutput
      .split(/\r?\n/)
      .filter((line) => line.endsWith("=match"))
      .map((line) => line.slice(0, -"=match".length)),
  );
  return RUNTIME_CONFIG_SERVICES.filter((service) => !matches.has(service));
}

export function runtimeConfigRestartScript(services) {
  if (
    services.length === 0 ||
    services.some((service) => !RUNTIME_CONFIG_SERVICES.includes(service))
  ) {
    throw new Error("runtime config restart needs known service names");
  }
  return `cd ${API_COMPOSE}
sudo docker compose restart ${services.join(" ")}
`;
}

// #3274: a shipped Caddyfile that does not parse took the prod edge down (#3273).
// The previous configs are kept outside the shipped tree (every ship replaces it),
// the shipped Caddyfile is validated on its pinned image before any swap, and a
// failed apply puts the previous configs back. Spec 2026-10-16 §5 «Edge config».
export const PREVIOUS_RUNTIME_CONFIG_DIR = "/var/lib/ds-platform/runtime-config/previous";
const RUNTIME_CONFIG_MOUNTS = [
  { service: "caddy", file: "Caddyfile", mounted: "/etc/caddy/Caddyfile" },
  { service: "centrifugo", file: "centrifugo/config.json", mounted: "/centrifugo/config.json" },
];
const API_COMPOSE_PATH = "infra/deploy/compose/api-prod";

function assertFullSha(sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`runtime config backup needs a full SHA, got: ${sha}`);
}

/**
 * The backup of the configs the running containers serve, taken for the release
 * (or rollback) of `target`. A re-entered run of the same target keeps the backup
 * its first entry took — by then the tree, or even the mounts, may already carry
 * the target's bytes. A new target retakes it through the running containers (the
 * bytes actually served, whatever tree an earlier failed run left on disk); only a
 * service whose container cannot be read falls back to the file on disk. A
 * rollback records its own key (`rollback-<sha>`): the backup a forward release of
 * that same SHA once took holds the configs from before it, not the running ones.
 */
export function runtimeConfigBackupScript(
  target,
  { composeDir = API_COMPOSE, backupDir = PREVIOUS_RUNTIME_CONFIG_DIR, rollback = false } = {},
) {
  assertFullSha(target);
  const key = rollback ? `rollback-${target}` : target;
  return `set -u
cd '${composeDir}' || exit 1
dir='${backupDir}'
recorded=$(sudo cat "$dir/for" 2>/dev/null || true)
if [ "$recorded" = '${key}' ]; then
  echo 'runtime-config-backup=kept ${key}'
  exit 0
fi
# umask 077: the backup dir and its files are root 0700/0600 as they are created.
umask 077
sudo mkdir -p "$dir/centrifugo" || exit 1
sudo rm -f "$dir/for"
copy=$(mktemp)
save() {
  local service="$1" shipped_path="$2" mounted_path="$3" container_id source
  container_id=$(sudo docker compose ps -q "$service" 2>/dev/null || true)
  if [ -n "$container_id" ] && sudo docker exec "$container_id" cat "$mounted_path" >"$copy" 2>/dev/null; then
    source=running
  elif sudo cat "$shipped_path" >"$copy" 2>/dev/null; then
    source=disk
  else
    echo "runtime-config-backup=FAILED $service"
    sudo rm -f "$copy"
    exit 1
  fi
  sudo cp "$copy" "$dir/$shipped_path" || exit 1
  echo "$service=$source"
}
${RUNTIME_CONFIG_MOUNTS.map((m) => `save ${m.service} ${m.file} ${m.mounted}`).join("\n")}
sudo rm -f "$copy"
printf '%s\\n' '${key}' | sudo tee "$dir/for" >/dev/null || exit 1
echo 'runtime-config-backup=taken ${key}'
`;
}

/** Puts the backed-up configs back into the compose dir; prints its verdict line. */
export function runtimeConfigRestoreScript({
  composeDir = API_COMPOSE,
  backupDir = PREVIOUS_RUNTIME_CONFIG_DIR,
} = {}) {
  return `set -u
cd '${composeDir}' || exit 1
dir='${backupDir}'
recorded=$(sudo cat "$dir/for" 2>/dev/null || true)
if [ -z "$recorded" ]; then
  echo 'runtime-config-restore=NO-BACKUP'
  exit 0
fi
${RUNTIME_CONFIG_MOUNTS.map(
  (m) =>
    `{ sudo cp "$dir/${m.file}" '${m.file}.ds-restore' && sudo chmod 0644 '${m.file}.ds-restore' && sudo mv -f '${m.file}.ds-restore' '${m.file}'; } || { echo 'runtime-config-restore=FAILED ${m.file}'; exit 0; }`,
).join("\n")}
echo "runtime-config-restore=restored (backup taken for $recorded)"
`;
}

/** The verdict line of a backup or restore script: `{ ok, detail }`, fail-closed. */
export function runtimeConfigStepVerdict(output, kind) {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(`runtime-config-${kind}=`));
  if (!line) return { ok: false, detail: `no runtime-config-${kind} verdict` };
  const detail = line.slice(`runtime-config-${kind}=`.length);
  const ok = kind === "backup" ? /^(kept|taken) /.test(detail) : detail.startsWith("restored ");
  return { ok, detail };
}

/**
 * `caddy validate` of the Caddyfile in the compose dir on the caddy image that
 * dir's compose.yml pins — the image the swap would run it on (the same command
 * as tools/ci/validate-caddyfiles.sh). No published port: the live caddy keeps :80/:443.
 */
export function caddyValidateScript({ composeDir = API_COMPOSE } = {}) {
  return `set -u
cd '${composeDir}' || exit 1
image="$(grep -Eo 'image:[[:space:]]*caddy:[^[:space:]]+' compose.yml | head -n1 | sed -E 's/image:[[:space:]]*//' || true)"
if [ -z "$image" ]; then
  echo 'caddy-validate=NO-IMAGE'
  exit 0
fi
log=$(mktemp)
if sudo docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" "$image" \\
     caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >"$log" 2>&1; then
  echo "caddy-validate=VALID $image"
else
  echo "caddy-validate=INVALID $image"
  echo '---- caddy validate (last 40) ----'
  tail -n 40 "$log"
fi
rm -f "$log"
`;
}

/** The verdict of `caddyValidateScript`: only an explicit VALID passes. */
export function caddyValidateVerdict(output) {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("caddy-validate="));
  if (!line) return { ok: false, reason: "no caddy-validate verdict" };
  const verdict = line.slice("caddy-validate=".length);
  if (/^VALID \S+$/.test(verdict)) return { ok: true, image: verdict.slice("VALID ".length) };
  return { ok: false, reason: `Caddyfile ${verdict}` };
}

/**
 * The Centrifugo config must parse as a JSON object — the shape
 * `centrifugo --config=…` loads (its secrets come from the env file, not this file).
 */
export function centrifugoConfigVerdict(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { ok: true };
    return { ok: false, reason: "centrifugo/config.json is not a JSON object" };
  } catch (e) {
    return { ok: false, reason: `centrifugo/config.json does not parse: ${e.message}` };
  }
}

/**
 * The pre-swap check of the runtime configs now in the compose dir. Invalid → the
 * previous configs go back on disk (so the tree matches what still runs) and the
 * result names the restore; nothing here swaps a container.
 */
export async function validateRuntimeConfigs({
  centrifugoConfig,
  validate = () => sshCapture(API_PROD, caddyValidateScript()),
  restore = () => sshCapture(API_PROD, runtimeConfigRestoreScript()),
  log = (message) => console.log(message),
}) {
  const centrifugo = centrifugoConfigVerdict(centrifugoConfig);
  let caddy = { ok: false, reason: "caddy validate did not run" };
  if (centrifugo.ok) {
    const out = await validate();
    log(out.split(/\r?\n/).filter(Boolean).map((l) => `      ${l}`).join("\n"));
    caddy = caddyValidateVerdict(out);
  }
  if (centrifugo.ok && caddy.ok) return { ok: true, image: caddy.image };
  const reason = centrifugo.ok ? caddy.reason : centrifugo.reason;
  const restored = runtimeConfigStepVerdict(
    await restore().catch((e) => `runtime-config-restore=FAILED ${e.message}`),
    "restore",
  );
  return {
    ok: false,
    reason,
    restore: restored.ok
      ? `the previous configs were put back on disk — ${restored.detail}`
      : `the previous configs were NOT put back on disk (${restored.detail})`,
  };
}

/**
 * Writes the given runtime config files into the compose dir (the rollback's
 * target configs). Base64 keeps the bytes exact through the script transport.
 */
export function runtimeConfigInstallScript(files, { composeDir = API_COMPOSE } = {}) {
  const known = RUNTIME_CONFIG_MOUNTS.map((m) => m.file);
  const names = Object.keys(files);
  if (names.length !== known.length || names.some((name) => !known.includes(name))) {
    throw new Error(`runtime config install needs exactly ${known.join(" + ")}`);
  }
  return `set -eu
cd '${composeDir}'
${known
  .map(
    (name) =>
      `printf '%s' '${Buffer.from(files[name], "utf8").toString("base64")}' | base64 -d | sudo tee '${name}.ds-new' >/dev/null
sudo chmod 0644 '${name}.ds-new'
sudo mv -f '${name}.ds-new' '${name}'`,
  )
  .join("\n")}
echo 'runtime-config-install=done'
`;
}

/**
 * `applyRuntimeConfigs`, and on its failure the previous configs back on disk, both
 * services restarted onto them and re-compared. Throws with the restore's result.
 */
export async function applyRuntimeConfigsOrRestore({
  compare = () => sshCapture(API_PROD, runtimeConfigComparisonScript()),
  restart = (script) => sshScript(API_PROD, script, { label: "runtime config restart" }),
  restore = () => sshCapture(API_PROD, runtimeConfigRestoreScript()),
  log = (message) => console.log(message),
} = {}) {
  try {
    return await applyRuntimeConfigs({ compare, restart, log });
  } catch (err) {
    const restored = runtimeConfigStepVerdict(
      await restore().catch((e) => `runtime-config-restore=FAILED ${e.message}`),
      "restore",
    );
    let result;
    if (!restored.ok) {
      result = `the previous configs were NOT restored (${restored.detail})`;
    } else {
      try {
        await restart(runtimeConfigRestartScript(RUNTIME_CONFIG_SERVICES));
        const stale = runtimeConfigServicesToRestart(await compare());
        result =
          stale.length === 0
            ? `the previous configs were restored and caddy + centrifugo restarted onto them — ${restored.detail}`
            : `the previous configs were restored on disk but ${stale.join(", ")} still do(es) not mount them — ${restored.detail}`;
      } catch (e) {
        result = `the previous configs were restored on disk, but the restart onto them failed (${e.message}) — ${restored.detail}`;
      }
    }
    throw new Error(`${err.message}; ${result}`, { cause: err });
  }
}

/** Takes (or, on a re-entered run of `target`, keeps) the runtime config backup. */
async function backupRuntimeConfigs(target, { rollback = false } = {}) {
  const out = await sshCapture(API_PROD, runtimeConfigBackupScript(target, { rollback })).catch(
    (e) => `runtime-config-backup=FAILED ${e.message}`,
  );
  const verdict = runtimeConfigStepVerdict(out, "backup");
  if (!verdict.ok) {
    die(
      `cannot keep the running Caddy + Centrifugo configs (${verdict.detail}) — nothing was shipped or swapped`,
    );
  }
  ok(`runtime configs backed up in ${PREVIOUS_RUNTIME_CONFIG_DIR}: ${verdict.detail}`);
}

/** Puts the backed-up configs back into the compose dir; returns the restore detail. */
async function restoreRuntimeConfigsOnDisk() {
  const verdict = runtimeConfigStepVerdict(
    await sshCapture(API_PROD, runtimeConfigRestoreScript()).catch(
      (err) => `runtime-config-restore=FAILED ${err.message}`,
    ),
    "restore",
  );
  return verdict.detail;
}

/**
 * A rollback that died after installing the target's configs: the running configs
 * back on disk, then the running mounts compared against what is on disk — an
 * `up -d` that got far enough to (re)start a service left it serving the target's.
 */
export async function rollbackSwapFailureReport({
  restore = () => sshCapture(API_PROD, runtimeConfigRestoreScript()),
  compare = () => sshCapture(API_PROD, runtimeConfigComparisonScript()),
} = {}) {
  const restored = runtimeConfigStepVerdict(
    await restore().catch((e) => `runtime-config-restore=FAILED ${e.message}`),
    "restore",
  );
  const disk = restored.ok
    ? `the running configs were put back on disk (${restored.detail})`
    : `the running configs were NOT put back on disk (${restored.detail}) — the target's stay there`;
  let mounts;
  try {
    const stale = runtimeConfigServicesToRestart(await compare());
    if (restored.ok) {
      mounts =
        stale.length === 0
          ? "caddy + centrifugo serve the configs now on disk"
          : `${stale.join(", ")} do(es) not serve the configs now on disk — restart it onto them`;
    } else {
      // The rollback aborted, so the running release stays; the target's configs on
      // disk are the wrong ones and no service may be restarted onto them.
      const onTarget = RUNTIME_CONFIG_SERVICES.filter((s) => !stale.includes(s));
      mounts = [
        onTarget.length > 0 && `${onTarget.join(", ")} serve(s) the target's configs`,
        stale.length > 0 && `${stale.join(", ")} still serve(s) the running configs`,
        `put the running configs back from ${PREVIOUS_RUNTIME_CONFIG_DIR}/ before any restart`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  } catch (e) {
    mounts = `the running mounts could not be compared (${e.message})`;
  }
  return `${disk}; ${mounts}`;
}

/** The pre-swap gate: `die` on an invalid config, after the previous ones are back on disk. */
async function assertRuntimeConfigsValid(files, { swapped }) {
  const verdict = await validateRuntimeConfigs({ centrifugoConfig: files["centrifugo/config.json"] });
  if (!verdict.ok) {
    die(
      `the edge config does NOT validate: ${verdict.reason}
` +
        `  ${swapped} — the PREVIOUS containers still serve the PREVIOUS configs;
` +
        `  ${verdict.restore}.
` +
        `  Fix the config on main and re-run (#3274).`,
    );
  }
  ok(`Caddyfile validates on ${verdict.image}; centrifugo/config.json parses`);
}

async function applyRuntimeConfigsOrDie({ rollbackHint = false } = {}) {
  try {
    await applyRuntimeConfigsOrRestore();
  } catch (e) {
    die(`runtime config apply failed: ${e.message}`, { rollbackHint });
  }
}

/** The target's runtime config files, byte-exact (the extracted tree, or `git show`). */
function targetRuntimeConfigs(sha) {
  return Object.fromEntries(
    RUNTIME_CONFIG_MOUNTS.map(({ file }) => {
      const path = `${API_COMPOSE_PATH}/${file}`;
      if (LOCAL_TREE) return [file, readFileSync(join(LOCAL_TREE, ...path.split("/")), "utf8")];
      const r = spawnSync("git", ["show", `${sha}:${path}`], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`\`git show ${sha.slice(0, 12)}:${path}\` exited ${r.status}`);
      return [file, r.stdout];
    }),
  );
}

export async function applyRuntimeConfigs({
  compare = () => sshCapture(API_PROD, runtimeConfigComparisonScript()),
  restart = (script) =>
    sshScript(API_PROD, script, { label: "runtime config restart" }),
  log = (message) => console.log(message),
} = {}) {
  const beforeApply = await compare();
  const servicesToRestart = runtimeConfigServicesToRestart(beforeApply);
  if (servicesToRestart.length > 0) {
    log(`      stale bind mount(s): ${servicesToRestart.join(", ")}`);
    await restart(runtimeConfigRestartScript(servicesToRestart));
  } else {
    log("      both running mounts already match — no restart");
  }

  const afterApply = await compare();
  const staleAfterApply = runtimeConfigServicesToRestart(afterApply);
  if (staleAfterApply.length > 0) {
    throw new Error(
      `runtime config apply did not mount the shipped file(s): ${staleAfterApply.join(", ")}`,
    );
  }
  return { restarted: servicesToRestart };
}

// --- #2605: the bot-protection test token never reaches production ---------
// The api already refuses to boot with `BOT_PROTECTION_TEST_TOKEN` set outside a
// non-production SENTRY_ENVIRONMENT; this is the second, independent control.
// The probe counts non-empty assignments in api-prod's env file (root 0600, so
// read via sudo) and never prints a value; the verdict fails closed on anything
// it does not recognise.
const API_PROD_ENV_FILE = "/etc/ds-platform/api.env";

export function apiEnvTestTokenProbeScript(envFile = API_PROD_ENV_FILE) {
  return `if sudo test -r '${envFile}'; then
  echo api-env=readable
  echo "test-token-lines=$(sudo grep -cE '^[[:space:]]*(export[[:space:]]+)?BOT_PROTECTION_TEST_TOKEN=[^[:space:]]' '${envFile}' || true)"
else
  echo api-env=unreadable
fi
`;
}

export function apiEnvTestTokenVerdict(output) {
  const lines = output.split(/\r?\n/);
  if (!lines.includes("api-env=readable")) {
    return {
      ok: false,
      reason: `could not read ${API_PROD_ENV_FILE} on api-prod to prove it carries no BOT_PROTECTION_TEST_TOKEN`,
    };
  }
  const count = lines
    .map((line) => line.match(/^test-token-lines=(\d+)$/))
    .find(Boolean);
  if (!count) {
    return {
      ok: false,
      reason: `unrecognised BOT_PROTECTION_TEST_TOKEN probe output for ${API_PROD_ENV_FILE}`,
    };
  }
  return Number(count[1]) === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `${API_PROD_ENV_FILE} on api-prod defines BOT_PROTECTION_TEST_TOKEN — the bot-protection test token is non-production only (#2605); remove the line on the box before deploying`,
      };
}

async function assertProdApiEnvHasNoTestToken() {
  step("#2605: api-prod env carries no bot-protection test token");
  const verdict = apiEnvTestTokenVerdict(
    await sshCapture(API_PROD, apiEnvTestTokenProbeScript()),
  );
  if (!verdict.ok) die(verdict.reason);
  ok(`${API_PROD_ENV_FILE}: no BOT_PROTECTION_TEST_TOKEN`);
}

// --- #3171: the sign-in host's record key is owner-placed in api.env ---------
// The api's sign-in-host module stays disabled (404) without SIGN_IN_RECORD_KEY;
// a release whose target ships the sign-in host refuses before any box change
// instead of shipping a host whose every form post 404s. Counted, never printed.
export function apiEnvRecordKeyProbeScript(envFile = API_PROD_ENV_FILE) {
  return `if sudo test -r '${envFile}'; then
  echo api-env=readable
  echo "record-key-lines=$(sudo grep -cE '^[[:space:]]*(export[[:space:]]+)?SIGN_IN_RECORD_KEY=[^[:space:]]' '${envFile}' || true)"
else
  echo api-env=unreadable
fi
`;
}

export function apiEnvRecordKeyVerdict(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const count = lines.map((line) => line.match(/^record-key-lines=(\d+)$/)).find(Boolean);
  if (!lines.includes("api-env=readable") || !count) {
    return {
      ok: false,
      reason: `could not read ${API_PROD_ENV_FILE} on api-prod to prove it carries SIGN_IN_RECORD_KEY`,
    };
  }
  return Number(count[1]) >= 1
    ? { ok: true }
    : {
        ok: false,
        reason:
          `${API_PROD_ENV_FILE} on api-prod has no SIGN_IN_RECORD_KEY — the sign-in host's at-rest key ` +
          "is owner-placed before the release that ships it (infra/deploy/README.md §\"Sign-in host roll-out\")",
      };
}

async function assertProdApiEnvHasRecordKey(services) {
  if (!(services ?? []).some((s) => s.image === "ds-login")) return;
  step("#3171: api-prod env carries the sign-in host's record key");
  const verdict = apiEnvRecordKeyVerdict(await sshCapture(API_PROD, apiEnvRecordKeyProbeScript()));
  if (!verdict.ok) die(verdict.reason);
  ok(`${API_PROD_ENV_FILE}: SIGN_IN_RECORD_KEY present`);
}

// --- tiny console ---------------------------------------------------------

const t0All = Date.now();
function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function ok(msg, since) {
  const dt = since ? ` (${((Date.now() - since) / 1000).toFixed(1)}s)` : "";
  console.log(`  ✓ ${msg}${dt}`);
}
function die(msg, { rollbackHint } = {}) {
  console.error(`\n✗ DEPLOY FAILED: ${msg}`);
  closeOpenReleaseAsFailed();
  if (rollbackHint) {
    console.error(
      `\n  Rollback pointer: the prod boxes were NOT hand-patched. To revert the\n` +
        `  app tier to the last-known-good SHA (image already on api-prod):\n` +
        `      pnpm deploy:prod --rollback <previous-sha>\n` +
        `  A bad MIGRATION (not app code) needs a pgbackrest restore — see\n` +
        `  infra/deploy/README.md → Rollback. DB was checkpointed pre-migrate.`,
    );
  }
  process.exit(1);
}

// --- local git / gh -------------------------------------------------------

function localCap(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(" ")}\` exited ${r.status}: ${(r.stderr || r.stdout || "").trim()}`,
    );
  }
  return (r.stdout || "").trim();
}

async function preflight(hotfixRef = null) {
  step(
    hotfixRef
      ? `Pre-flight (HOTFIX ${REF_FLAG}): stage check prerequisites · clean tree · target on origin · descendant of prod · cherry-picks of main · green CI · no live broadcast · release gate · recorded images · stage main check`
      : `Pre-flight: clean tree · HEAD==origin/main · green CI · no live broadcast · release gate · recorded images · \`${STAGE_SUITE_CONTEXT}\` status`,
  );

  // 0. stage `main` check prerequisites (#2806), `--ref` only: the PC check is the
  //    last step, but what it needs from this machine is probed first, so a
  //    missing one refuses in seconds instead of after the checkout, install and
  //    converge. A `main` target reads the Actions status instead (#3198).
  await assertStageMainPrerequisites(Boolean(hotfixRef));

  // 1. clean working tree
  const dirty = localCap("git", ["status", "--porcelain"]);
  if (dirty) {
    die(
      `working tree is dirty — commit/stash first (deploy ships committed main only):\n${dirty}`,
    );
  }
  ok("working tree clean");

  // 2. Fix the deploy target to origin/main's SHA. The ship step archives THIS
  //    ref explicitly (never local HEAD), so un-pushed local work can never
  //    reach prod — which is why a divergent HEAD is a loud WARNING, not a
  //    hard fail: it lets the tool run from a maintenance branch (e.g. the one
  //    that introduces this script) while still deploying exactly origin/main.
  localCap("git", ["fetch", "origin"]);
  const head = localCap("git", ["rev-parse", "HEAD"]);
  const originMain = localCap("git", ["rev-parse", "origin/main"]);

  // 2b. HOTFIX target (#1881, spec §10.11). In `--ref` mode the deploy target is
  //     the named commit, not origin/main — so the invariants that normally come
  //     free from "it is on main" (reachable on origin, reviewed, merged) must be
  //     asserted explicitly here. Fail-closed: any unresolvable fact dies.
  const target = hotfixRef ? resolveHotfixTarget(hotfixRef) : originMain;
  if (hotfixRef) {
    await assertHotfixInvariants(target);
    console.log(
      `  ℹ HEAD (${head.slice(0, 12)}) — deploying hotfix ${target.slice(0, 12)},` +
        ` NOT origin/main (${originMain.slice(0, 12)}).`,
    );
  } else if (head !== originMain) {
    console.log(
      `  ⚠ HEAD (${head.slice(0, 12)}) != origin/main (${originMain.slice(0, 12)}) —` +
        ` deploying origin/main, NOT your local HEAD.`,
    );
  } else {
    ok(`HEAD == origin/main @ ${originMain.slice(0, 12)}`);
  }

  // 3. green CI for this exact SHA (a hotfix branch gets its run from
  //    `gh workflow run ci.yml --ref hotfix/<N>-<slug>` — see the runbook)
  if (process.argv.includes("--skip-ci-check")) {
    console.log(
      "  ⚠ --skip-ci-check: SKIPPING the green-CI gate (escape hatch)",
    );
  } else {
    assertGreenCi(target);
  }

  // 4. эфир gate (release-cycle spec §10.4 item 7): the <60s container
  //    recreation blips a live webinar room, so a live broadcast — or an
  //    UNKNOWN probe (fail-closed) — holds the deploy regardless of
  //    change-class. Escape hatch mirrors --skip-ci-check and is for the
  //    owner-approved urgent-ship path ONLY (mid-эфир ship = escalate).
  if (process.argv.includes("--allow-live-broadcast")) {
    console.log(
      "  ⚠ --allow-live-broadcast: SKIPPING the live-broadcast hold (owner-approved urgent ship — viewers may blip)",
    );
  } else {
    assertNoLiveBroadcast();
  }

  // 5. release gate (#1662, spec §10): an OPEN `release-blocker` Issue, or a
  //    merged-but-not-yet-deployed PR whose `Stage-B: batched at #<gate>` gate
  //    Issue is still open, HOLDS the deploy. Fail-closed on an UNKNOWN, like
  //    the эфир probe above; the only bypass is the explicit, printed flag.
  //    In `--ref` mode the gate's range is already `<live deployed>..<target>`
  //    (the basis is the LIVE prod SHA, not main) — i.e. exactly the hotfix
  //    range, with no extra wiring.
  await assertReleaseGate(target);

  // 5b. #2981: the recorded release (`main`/`hotfix/*`) digests for the target and the box's pull
  //     token, resolved BEFORE anything touches a box — a missing / running /
  //     failed runtime-images run or a bad manifest refuses here with its cause.
  //     There is no build fallback: api-prod has no way to build any more.
  const images = await resolveProdImages(target);

  // 6. stage gate (release-pipeline spec §3 item 3, #3198). A `main` target: the
  //    `stage-suite` commit status `stage.yml` posted on it in Actions — the PC
  //    run crashed its pages on PC RAM and its lease refused the next converge.
  //    A `--ref` hotfix target: Actions runs the stage suite only on `main`
  //    pushes, so the PC stage `main` check (#2701) still converges the slot and
  //    runs the suite. Same owner-go bypass as step 5.
  await assertStageGate(target, Boolean(hotfixRef));

  return { sha: target, images };
}

// #2981: operator-side manifest resolution (gh) + a read-only token probe on
// api-prod. Used by the deploy pre-flight and by a rollback whose target images
// are no longer on the box.
async function resolveProdImages(sha) {
  const t = Date.now();
  let resolved;
  try {
    resolved = await resolveRecordedImagesViaGh({ ...PROD_MANIFEST_POLICY, sha });
  } catch (e) {
    die(
      `recorded images for ${sha.slice(0, 12)}: ${e.message}\n` +
        `  api-prod pulls only the digests a \`main\` or \`hotfix/<N>-<slug>\` push of` +
        ` runtime-images.yml recorded (a hotfix: push the branch, wait for its run);` +
        ` nothing is built on the box.`,
    );
  }
  ok(`recorded \`${resolved.ref}\` images for ${sha.slice(0, 12)} (run ${resolved.run.url})`, t);
  await assertPullToken();
  return resolved.images;
}

async function assertPullToken() {
  const token = pullTokenVerdict(await sshCapture(API_PROD, pullTokenProbeScript()), {
    host: API_PROD,
  });
  if (!token.ok) die(token.reason);
  ok(`registry pull token provisioned on ${API_PROD}`);
}

// #3157: a `--local` run's target — the SHA and digests of the `images-<sha>.json` the
// release driver validated and checked against GitHub and the registry before it
// started this unit (it downloaded the tree of exactly that SHA). Validated again
// with the release policy before anything touches a box.
async function readLocalRelease(imagesFile) {
  step("Release manifest from the release driver (box-local run)");
  let sha;
  let images;
  try {
    const manifest = readImageManifestFile(imagesFile);
    sha = manifest.sha;
    ({ images } = validateProdImageManifest(manifest, sha));
  } catch (e) {
    const source = imagesFile === IMAGES_FILE_STDIN ? "on stdin" : imagesFile;
    die(`the release manifest ${source}: ${e.message}`);
  }
  ok(`recorded images for ${sha.slice(0, 12)}`);
  await assertPullToken();
  return { sha, images };
}

// #2981: pull (or reuse) the recorded digests on api-prod as `ds-<image>:<sha>`,
// then prove every tag carries its recorded digest — before anything boots.
//
// `durable` (#2982) runs the pull as the release's `pull` unit through ds-release;
// the rollback pull stays streamed — it must never wait on the lease of the very
// release it reverts.
async function pullRecordedImages(sha, images, { label, durable = false }) {
  const script = apiProdPullScript({ sha, images });
  if (durable) await boxStep(API_PROD, sha, "pull", script, label);
  else {
    await sshScript(API_PROD, script, {
      label,
      stallBudgetMs: STALL_BUDGET_BUILD_MS,
    });
  }
  try {
    assertImageDigests(
      await sshCapture(API_PROD, imageDigestScript({ sha, images })),
      images,
    );
  } catch (e) {
    die(`${label}: ${e.message}`);
  }
}

// #2982 (tech spec 2026-10-16 release pipeline §5): every long box step of a
// release runs in its own systemd unit through /usr/local/bin/ds-release, so a
// killed operator session never kills it. A re-run of the same SHA returns each
// recorded verdict (backup and migrate are never repeated) or reattaches; a step
// recorded as failed re-runs only under `--retry-failed`.
const RELEASE_ENV = "prod";
const RETRY_FAILED = process.argv.includes("--retry-failed");

function boxStep(host, sha, step, script, label) {
  return runDurableStep(host, {
    env: RELEASE_ENV,
    sha,
    step,
    script,
    label,
    retryFailed: RETRY_FAILED,
    capture: sshCapture,
  });
}

// The SHA whose release is open on the boxes (first durable step → finish). Only a
// finished release frees the env lease for another SHA, so every failure exit closes
// it as failed — `die()` included, which is synchronous and exits.
let openReleaseSha = null;

async function finishReleaseSucceeded(sha) {
  await sshScript(API_PROD, releaseFinishScript(RELEASE_ENV, sha, "succeeded"), {
    label: "ds-release finish",
  });
  console.log(await dataProd().call(["finish", sha, "succeeded"]));
  openReleaseSha = null;
}

// Best-effort: a step still running on a box is refused by `finish` and stays
// open, which is right — a re-run of the same SHA reattaches to it.
function closeOpenReleaseAsFailed() {
  if (!openReleaseSha) return;
  const sha = openReleaseSha;
  openReleaseSha = null;
  for (const host of [API_PROD, DATA_PROD]) {
    // #3313: ds-data-prod's `finish` verb, in the form this run already found (a
    // release is open only after the data-prod calls that found it).
    const script =
      host === DATA_PROD
        ? (dataProdClient?.knownCommand(["finish", sha, "failed"]) ?? null)
        : releaseFinishScript(RELEASE_ENV, sha, "failed");
    if (!script) {
      console.error(`  ⚠ ${host}: the release stays open (no data-prod call was made). Close it with its \`finish ${sha} failed\` verb`);
      continue;
    }
    const r = spawnSync(
      ...boxSpawnArgs(host, script, ["-o", "ConnectTimeout=15", "-o", "BatchMode=yes"]),
      { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8", timeout: 60_000 },
    );
    if (r.status !== 0) {
      const why = (r.stderr || "").trim().split(/\r?\n/)[0] || r.error?.message || `exit ${r.status}`;
      console.error(`  ⚠ ${host}: the release stays open (${why}). Close it: ssh ${host} '${script}'`);
    }
  }
}

// Resolve the `--ref <sha>` argument to a full commit SHA that exists on ORIGIN.
// A SHA that is only local (or only on a fork) must never reach prod, so an
// unresolvable or unreachable ref is fatal. `git fetch origin` (all refs) ran in
// pre-flight step 2, so a pushed hotfix branch is present here.
function resolveHotfixTarget(ref) {
  const r = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    die(
      `${REF_FLAG} ${ref}: no such commit locally after \`git fetch origin\` —` +
        ` push the hotfix branch to origin first (\`git push -u origin hotfix/<N>-<slug>\`).`,
    );
  }
  const sha = (r.stdout || "").trim();

  // `--list origin/*` on purpose: reachability from ANY remote (a fork added as
  // a second remote) is not the invariant — reachability from `origin` is.
  const contains = localCap("git", [
    "branch",
    "-r",
    "--contains",
    sha,
    "--list",
    "origin/*",
  ]);
  if (!contains) {
    die(
      `${REF_FLAG} ${sha.slice(0, 12)} is not reachable from any \`origin/*\` branch —` +
        ` deploy ships pushed, reviewable commits only. Push the hotfix branch first.`,
    );
  }
  ok(
    `hotfix target ${sha.slice(0, 12)} on origin (${contains.split(/\r?\n/).length} branch(es))`,
  );
  return sha;
}

// The two hotfix invariants (tools/deploy/hotfix-ref.mjs — pure verdict, unit
// tested): strict descendant of the LIVE deployed SHA, and every commit in
// `deployed..target` is a cherry-pick of a commit already on `origin/main`.
// Ground truth for "what is running" is `/v1/health`, the same source the release
// gate and `## Project reality` use — NOT the Deployment record, which an
// app-only rollback leaves ahead of reality.
async function assertHotfixInvariants(target) {
  const health = await probeHealthSha(PROD_HEALTH_URL);
  if (!health.sha) {
    die(
      `${REF_FLAG}: cannot read the live prod SHA from ${PROD_HEALTH_URL}` +
        ` (${health.error ?? "unknown"}) — a hotfix deploy must know what it builds on.`,
    );
  }
  const deployed = localCap("git", ["rev-parse", `${health.sha}^{commit}`]);
  ok(`live prod SHA ${deployed.slice(0, 12)} (from /v1/health)`);

  const isDescendant =
    spawnSync("git", ["merge-base", "--is-ancestor", deployed, target], {
      encoding: "utf8",
    }).status === 0;

  const proof = verifyHotfixCommits({ cwd: process.cwd(), deployed, target });
  if (!proof.ok) die(proof.error);
  for (const replay of proof.replayed) {
    ok(
      `clean Git replay ${replay.target.slice(0, 12)} from origin/main ${replay.source.slice(0, 12)} (exact tree)`,
    );
  }

  const verdict = hotfixPreflightVerdict({
    deployedSha: deployed,
    targetSha: target,
    targetIsDescendant: isDescendant,
    unmatched: [],
  });
  if (!verdict.ok) die(verdict.error);
  ok(
    `hotfix range ${deployed.slice(0, 12)}..${target.slice(0, 12)} —` +
      ` every commit is a cherry-pick of origin/main`,
  );
}

// Release-blocker + open-batched-Stage-B hold (#1662). The evidence probe and
// the pure verdict live in tools/deploy/release-gate.mjs (unit-tested there);
// this is the deploy-side wiring: print the exemption loudly, else hold.
async function assertReleaseGate(sha) {
  const exempt = parseReleaseGateExempt(process.argv);
  if (exempt.error) die(exempt.error); // already caught at start-up; belt-and-braces
  if (exempt.exempt) {
    console.log(
      `  ⚠ ${RELEASE_GATE_EXEMPT_FLAG}: SKIPPING the release-blocker / batched-Stage-B gate` +
        ` — ${exempt.reason} (this line is the audit record).`,
    );
    return;
  }
  const probe = await probeReleaseGate({
    targetSha: sha,
    cwd: process.cwd(),
    healthUrl: PROD_HEALTH_URL,
  });
  const verdict = evaluateReleaseGate(probe);
  const hold = formatReleaseGateHold(verdict);
  if (hold) die(hold);
  ok(formatReleaseGateClear(probe.basisSha, verdict.notes));
}

/**
 * The PC stage `main` check prerequisites, probed only for a `--ref` target —
 * a `main` target reads the `stage-suite` status and needs nothing from this
 * machine (no `STAGE_BASIC_AUTH_PASS`, no stage ssh).
 */
export async function stageGatePrerequisites({ hotfix, checkPrerequisites }) {
  if (!hotfix) return { ok: true, needed: false };
  const result = await checkPrerequisites();
  return result.ok
    ? { ok: true, needed: true }
    : { ok: false, needed: true, reason: result.reason };
}

/**
 * The pre-flight stage gate for `sha`: `readStageSuite(sha)` (the
 * `stageSuiteProblem`, or `null`) for a `main` target, `runPcCheck(sha)` for a
 * `--ref` target. Returns `{ ok, line }` or `{ ok: false, reason }`.
 */
export async function stageGate({ sha, hotfix, readStageSuite, runPcCheck }) {
  const short = sha.slice(0, 12);
  if (hotfix) {
    const result = runPcCheck(sha);
    return result.ok
      ? {
          ok: true,
          line: `stage \`main\` slot serves ${short} and the full stage suite PASSED`,
        }
      : { ok: false, reason: `stage \`main\` check: ${result.reason}` };
  }
  let problem;
  try {
    problem = await readStageSuite(sha);
  } catch (e) {
    problem = `cannot read the \`${STAGE_SUITE_CONTEXT}\` status: ${e.message}`;
  }
  return problem
    ? { ok: false, reason: problem }
    : { ok: true, line: `\`${STAGE_SUITE_CONTEXT}\` is success for ${short}` };
}

// Same owner-go bypass as the check itself: an exempted check needs no prerequisites
// (its own skip line, printed at step 6, is the audit record).
async function assertStageMainPrerequisites(hotfix) {
  if (!hotfix) return;
  const exempt = parseReleaseGateExempt(process.argv);
  if (exempt.error) die(exempt.error);
  if (exempt.exempt) {
    console.log(
      `  ⚠ ${RELEASE_GATE_EXEMPT_FLAG}: SKIPPING the stage \`main\` check prerequisites`,
    );
    return;
  }
  const t = Date.now();
  const result = await stageGatePrerequisites({
    hotfix,
    checkPrerequisites: checkStageMainPrerequisites,
  });
  if (!result.ok) {
    die(
      `stage \`main\` check prerequisites missing — refusing before any checkout:
  ${result.reason}
` +
        `  Skipping the stage check needs the owner's go + ${RELEASE_GATE_EXEMPT_FLAG} "<reason>".`,
    );
  }
  ok(
    "stage `main` check prerequisites: STAGE_BASIC_AUTH_PASS set, stage box reachable over ssh",
    t,
  );
}

// The deploy-side wiring of `stageGate`: print the exemption loudly, else refuse on red.
async function assertStageGate(sha, hotfix) {
  const exempt = parseReleaseGateExempt(process.argv);
  if (exempt.error) die(exempt.error);
  const what = hotfix
    ? "stage `main` check"
    : `\`${STAGE_SUITE_CONTEXT}\` status check`;
  if (exempt.exempt) {
    console.log(
      `  ⚠ ${RELEASE_GATE_EXEMPT_FLAG}: SKIPPING the ${what}` +
        ` — ${exempt.reason} (this line is the audit record).`,
    );
    return;
  }
  const t = Date.now();
  const result = await stageGate({
    sha,
    hotfix,
    readStageSuite: (target) =>
      readStageSuiteProblem({
        sha: target,
        read: combinedStatusViaGh({ repo: ghRepoName(), run: localCap }),
      }),
    runPcCheck: (target) =>
      runStageMainCheck({ sha: target, repoRoot: process.cwd() }),
  });
  if (!result.ok) {
    die(
      `${result.reason}.
` +
        `  Fix the cause and re-run \`pnpm deploy:prod\`; skipping the ${what} needs the owner's go` +
        ` + ${RELEASE_GATE_EXEMPT_FLAG} "<reason>".`,
    );
  }
  ok(result.line, t);
}

// Read-only probe of the public upcoming-broadcasts listing (exit 0 = CLEAR,
// exit 1 = LIVE or UNKNOWN — both hold; see tools/deploy/live-broadcast-check.mjs).
function assertNoLiveBroadcast() {
  const script = fileURLToPath(
    new URL("./live-broadcast-check.mjs", import.meta.url),
  );
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  const line = `${r.stdout || ""}${r.stderr || ""}`.trim() || "(no output)";
  if (r.status !== 0) {
    die(
      `live-broadcast gate (spec §10.4 item 7): ${line}\n` +
        `  A deploy must not run over a live эфир — hold until it ends, or bind to\n` +
        `  the maintenance window (02:00–06:00 MSK). An urgent mid-broadcast ship is\n` +
        `  ESCALATE: owner's explicit go + \`--allow-live-broadcast\`.`,
    );
  }
  ok(`no live broadcast — ${line}`);
}

// The most reliable green-CI signal for a merged main SHA is its check-runs —
// but ONLY the ones produced by repo-owned workflows. GitHub also injects its
// own dynamic workflows on the default branch ("Dependabot Updates", code
// scanning); their check-runs sit on the same commit board, cannot be re-run,
// and a `failure` there says nothing about our code. On main a0ddf421 a single
// such row held a fully green deploy hostage (#2077).
//
// So: fetch the commit's check-runs AND the SHA's workflow runs, drop the
// suites whose workflow `path` is positively NOT under `.github/workflows/`
// (structural provenance — never a name allow-list, per the merge-gate TOTAL
// rule #1253), then group by check name, take the LATEST run per name and
// require every latest run completed successfully. Fail-closed throughout:
// unknown provenance still blocks, and an API failure dies rather than falling
// back to the unfiltered board. `tools/gh/merge-gate.mjs` is deliberately NOT
// changed — dynamic workflows only fire on the default branch, so this gate
// judges the same board the merge gate saw, minus those dynamic suites.
function ghRepoName() {
  return localCap("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
}

function assertGreenCi(sha) {
  const repo = ghRepoName();
  let board;
  try {
    board = fetchDeployCiBoard({ sha, repo, run: localCap });
  } catch (e) {
    die(e.message);
  }
  // #3158: the release workflow's own runs on this SHA are not CI either.
  const verdict = classifyDeployCheckRuns(board.checkRuns, board.workflowRuns, {
    ignoreWorkflowPaths: [DEPLOY_PROD_WORKFLOW_PATH],
  });
  if (verdict.dropped.length)
    ok(
      `ignored ${verdict.dropped.length} non-CI workflow check(s): ` +
        verdict.dropped.join(", "),
    );
  const problem = ciVerdictProblem(verdict, sha);
  if (problem) die(problem);
  ok(`CI green — ${verdict.count} check(s) passed for ${sha.slice(0, 12)}`);
}

// Container-name prefix compose derives from the project name (`name:
// ds-api-prod` in the api-prod compose file): `<project>-<service>-1`.
const CONTAINER_PREFIX = "ds-api-prod-";

// --- #1997: pipeline-owned IdP provisioning converge ----------------------
//
// `infra/dev-stand/idp/provision.sh` is the managed owner of the prod Zitadel
// instance configuration (login / notification / password-complexity policies,
// active providers, message texts). Before #1997 the deploy shipped IMAGES ONLY
// and the instance kept whatever the last MANUAL provisioning run had left, so a
// converge step could land in code and never reach prod — exactly the #1994
// incident (003 EARS-36 length-only password policy merged 2026-08-20, prod kept
// the provider default, registration 422'd for 18 days until the hand re-run on
// 2026-09-07). A checklist item (#1995) is a memory-based control; this step
// makes the PIPELINE the thing that runs it, on every deploy.
//
// The command is the `infra/deploy/README.md` step 9 command verbatim, env
// included: `api.env` is root:root 0600, so it is sourced AS ROOT inside
// `sudo bash -c` (a non-root `.` yields an EMPTY env and provision.sh then
// refuses `real` delivery mode fail-closed — #902). The script is idempotent
// read-before-write on every step, so with no `provision.sh` change since the
// last deploy the run is a no-op that prints `already` / `no changes` lines.
//
// Then the policy is READ BACK from the instance and compared against the
// mirrored `@ds/schemas` constant. The read-back runs ON THE BOX: the bootstrap
// PAT lives only in `/etc/ds-platform/idp-bootstrap-pat.txt` (0600 root:root) and
// is never copied to a workstation. A converge that "succeeded" but left the
// policy off-target fails the deploy — a green provision exit code alone is not
// evidence that the instance is where the code says it should be.
const IDP_BASE_URL = process.env.DS_IDP_BASE_URL || "https://id.doctor.school";
const IDP_PROVISION_DIR = `${REMOTE_TREE}/infra/dev-stand/idp`;
const IDP_BOOTSTRAP_PAT_FILE = "/etc/ds-platform/idp-bootstrap-pat.txt";
const IDP_REDIRECT_URIS = "https://api.doctor.school/auth/callback";
const IDP_POST_LOGOUT_URIS =
  "https://academy.doctor.school,https://new.doctor.school";
// The two storefront OIDC clients (provision.sh step 3.bis, 003 EARS-60, ADR-0015 §4):
// one exact callback + post-logout URI each, the sign-in host as their Login V2
// base_uri, the API's back-channel logout endpoint. The doctor storefront is
// `new.doctor.school` until the relaunch moves it (ADR-0015 §7 — a re-registration).
/**
 * #3171: merge the storefront client ids provision.sh printed (step 3.bis, one
 * `IDP_{ACADEMY,DOCTOR}_CLIENT_ID=` line each, into `idsFile`) into the compose
 * `.env` the api interpolates — the prod sign-in-host client map (003 EARS-60).
 * Run in the compose dir. A converge that printed no pair refuses, `.env`
 * untouched: the api would otherwise boot with its sign-in host disabled.
 * Client ids are public (they ride every authorize URL); nothing secret here.
 */
export function storefrontClientIdsEnvScript(idsFile) {
  return [
    `academy=$(grep -E '^IDP_ACADEMY_CLIENT_ID=[A-Za-z0-9@._-]+$' "${idsFile}" | tail -n 1)`,
    `doctor=$(grep -E '^IDP_DOCTOR_CLIENT_ID=[A-Za-z0-9@._-]+$' "${idsFile}" | tail -n 1)`,
    `if [ -z "$academy" ] || [ -z "$doctor" ]; then echo "provision.sh printed no storefront client id pair" >&2; exit 1; fi`,
    `{ { [ -f .env ] && grep -vE '^IDP_(ACADEMY|DOCTOR)_CLIENT_ID=' .env; } || true; printf '%s\\n%s\\n' "$academy" "$doctor"; } > .env.next && mv .env.next .env`,
  ].join("\n");
}

const IDP_STOREFRONT_CLIENT_ENV = [
  "IDP_SIGN_IN_BASE_URI=https://login.doctor.school",
  "IDP_BACK_CHANNEL_LOGOUT_URI=https://api.doctor.school/v1/auth/back-channel-logout",
  "IDP_ACADEMY_REDIRECT_URI=https://academy.doctor.school/auth/callback",
  "IDP_ACADEMY_POST_LOGOUT_URI=https://academy.doctor.school/",
  "IDP_DOCTOR_REDIRECT_URI=https://new.doctor.school/auth/callback",
  "IDP_DOCTOR_POST_LOGOUT_URI=https://new.doctor.school/",
].join(" ");
// The mirrored SSOT constant, read at the DEPLOYED SHA (never a literal `8`):
// the deploy must verify the instance against the number the shipped code
// enforces, which on a `--ref` hotfix is not necessarily the local checkout's.
const SCHEMAS_AUTH_SCHEMA_PATH = "packages/schemas/src/auth/auth.schema.ts";
// Same rule for the emailed/SMS code generators (#2555, #2636): the TARGET provision.sh
// decides their shape, and the shipped app's constant must agree with it.
const IDP_PROVISION_SCRIPT_PATH = "infra/dev-stand/idp/provision.sh";
const SCHEMAS_REGISTER_FIELDS_PATH =
  "packages/schemas/src/storefront/register-fields.ts";
// The code lifetimes the shipped emails state (#2814); provision.sh preserves
// the live expiry, so the read-back pins it to these.
const CODE_EMAILS_PATH = "apps/api/src/mailer/code-emails.ts";

// Convergence must complete before the strict API is swapped into service.
// IdP configuration is forward-only, but the previous app remains available.
const IDP_ROLLBACK_HINT =
  "the previous application containers are still serving (pre-swap IdP gate)";

async function provisionIdp(sha, label = sha.slice(0, 12)) {
  let expectedMin;
  try {
    expectedMin = parsePasswordMinLength(
      targetFile(sha, SCHEMAS_AUTH_SCHEMA_PATH),
    );
  } catch (e) {
    die(
      `cannot resolve PASSWORD_MIN_LENGTH from ${SCHEMAS_AUTH_SCHEMA_PATH} at ${label}` +
        ` — ${IDP_ROLLBACK_HINT}:\n  ${e.message}`,
      { rollbackHint: true },
    );
  }
  console.log(
    `  ℹ @ds/schemas PASSWORD_MIN_LENGTH at ${label}: ${expectedMin}` +
      ` (read from ${SCHEMAS_AUTH_SCHEMA_PATH}, not hardcoded)`,
  );

  // provision.sh streams one `converged` / `already` / `no changes` line per
  // step to stderr; sshScript forwards every remote byte verbatim, so those
  // lines land in the deploy transcript as-is.
  try {
    await sshScript(
      API_PROD,
      `set -eo pipefail
cd ${IDP_PROVISION_DIR}
ids=$(mktemp)
trap 'rm -f "$ids"' EXIT
sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; IDP_BASE_URL=${IDP_BASE_URL} IDP_REDIRECT_URIS=${IDP_REDIRECT_URIS} IDP_POST_LOGOUT_URIS=${IDP_POST_LOGOUT_URIS} ${IDP_STOREFRONT_CLIENT_ENV} EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real ./provision.sh --pat-file ${IDP_BOOTSTRAP_PAT_FILE}' | tee "$ids"
cd ${API_COMPOSE}
${storefrontClientIdsEnvScript("$ids")}
`,
      { label: "idp provision", stallBudgetMs: STALL_BUDGET_BUILD_MS },
    );
  } catch (e) {
    die(
      `IdP provision converge FAILED on api-prod — ${IDP_ROLLBACK_HINT}, and the` +
        ` instance configuration is in an UNKNOWN state (provision.sh is idempotent,` +
        ` so a re-run is safe once the cause is fixed):\n  ${e.message}\n` +
        `  Manual recovery path: infra/deploy/README.md → step 9.`,
      { rollbackHint: true },
    );
  }

  let raw;
  try {
    raw = await sshCapture(
      API_PROD,
      `sudo bash -c 'curl -fsS --max-time 30 -H "Authorization: Bearer $(cat ${IDP_BOOTSTRAP_PAT_FILE})" ${IDP_BASE_URL}/admin/v1/policies/password/complexity'`,
    );
  } catch (e) {
    die(
      `cannot READ BACK the prod IdP password-complexity policy — ${IDP_ROLLBACK_HINT}.` +
        ` An unreadable policy is a failed deploy, never an assumed-good one:\n  ${e.message}`,
      { rollbackHint: true },
    );
  }

  try {
    const verdict = assertPasswordPolicyConverged(JSON.parse(raw), expectedMin);
    console.log(
      `  ℹ prod IdP password policy @ ${IDP_BASE_URL}: ${formatPasswordPolicy(verdict)}`,
    );
  } catch (e) {
    die(
      `prod IdP policy read-back REJECTED — ${IDP_ROLLBACK_HINT}:\n  ${e.message}\n` +
        `  Re-run the converge by hand (infra/deploy/README.md → step 9) and inspect` +
        ` the instance before serving registrations (#1994).`,
      { rollbackHint: true },
    );
  }

  // provision.sh runs from the TARGET commit, so the expected generator shape
  // comes from that commit's step 8.septies; a target without the step never
  // converges the generators and the read-back is skipped (#2555, #2636).
  let codeExpectation;
  try {
    codeExpectation = resolveEmailedCodeExpectation({
      provisionText: targetFile(sha, IDP_PROVISION_SCRIPT_PATH),
      verifyCodeSchemaText: targetFile(sha, SCHEMAS_REGISTER_FIELDS_PATH),
      codeEmailsText: targetFile(sha, CODE_EMAILS_PATH),
    });
  } catch (e) {
    die(
      `cannot resolve the expected code-generator shape from ${IDP_PROVISION_SCRIPT_PATH}` +
        ` / ${SCHEMAS_REGISTER_FIELDS_PATH} / ${CODE_EMAILS_PATH} at ${label} — ${IDP_ROLLBACK_HINT}:
  ${e.message}`,
      { rollbackHint: true },
    );
  }
  if (!codeExpectation.check) {
    console.log(
      `  ℹ prod IdP code generators @ ${IDP_BASE_URL}: ${codeExpectation.reason}`,
    );
    return;
  }
  for (const type of codeExpectation.generators) {
    let generatorRaw;
    try {
      generatorRaw = await sshCapture(
        API_PROD,
        `sudo bash -c 'curl -fsS --max-time 30 -H "Authorization: Bearer $(cat ${IDP_BOOTSTRAP_PAT_FILE})" ${IDP_BASE_URL}/admin/v1/secretgenerators/${type}'`,
      );
    } catch (e) {
      die(
        `cannot READ BACK the prod IdP code generator ${type} — ${IDP_ROLLBACK_HINT}.` +
          ` An unreadable generator is a failed deploy, never an assumed-good one:
  ${e.message}`,
        { rollbackHint: true },
      );
    }
    try {
      const verdict = assertCodeGeneratorConverged(
        JSON.parse(generatorRaw),
        codeExpectation,
        codeExpectation.expirySeconds[type],
        type,
      );
      console.log(
        `  ℹ prod IdP code generators @ ${IDP_BASE_URL}: ${formatCodeGenerator(type, verdict)}`,
      );
    } catch (e) {
      die(
        `prod IdP code generator read-back REJECTED — ${IDP_ROLLBACK_HINT}:
  ${e.message}
` +
          `  A length/alphabet mismatch: re-run the converge by hand (infra/deploy/README.md → step 9),` +
          ` or sign-in codes would not match the shipped code input (#2555, #2636). An expiry` +
          ` mismatch: apply the remedy named above (#2814).`,
        { rollbackHint: true },
      );
    }
  }
}

// #1896: the per-service verify set of a deploy is READ from the TARGET tree's
// compose file, not from the local checkout. `--ref <sha>` ships that commit's
// tree, so its compose is what the on-box `docker compose up` consumes and
// therefore the only truthful source for "which SHA-tagged images must boot and
// must be running afterwards". Fail-closed: an unreadable or empty derivation
// dies here, before any ssh — never "probe nothing".
function resolveTargetServiceSet(sha, label = sha.slice(0, 12)) {
  let composeText;
  try {
    composeText = targetFile(sha, API_PROD_COMPOSE_PATH);
  } catch (e) {
    die(
      `cannot read ${API_PROD_COMPOSE_PATH} at ${label} — the deploy cannot know` +
        ` which services it must verify:\n  ${e.message}`,
    );
  }
  try {
    const services = deployServiceSet(composeText, { source: label });
    // Validate the boot-probe subset NOW (ports pinned, non-empty) so a broken
    // compose fails during pre-flight, not two build-minutes into the deploy.
    const probed = bootProbeSet(services);
    console.log(
      `  ℹ service set derived from ${label}: ${formatServiceNames(services)}` +
        ` (boot-probed: ${formatServiceNames(probed)})`,
    );
    return services;
  } catch (e) {
    die(`${e.message}`);
  }
}

// Truthful-success gate (DSO-127 rework): after `up -d`, prove the RUNNING
// containers of the TARGET's service set actually carry the deployed SHA-tagged
// images and reach healthy — a "DEPLOY OK" line must never outrun the box's
// reality again. Polls on-box (one ssh channel) up to ~4 min to cover the
// containers' healthcheck start_period + retries after a real image swap.
//
// `services` is derived from the deploy TARGET's compose file (#1896), never
// from the local checkout: a `--ref` hotfix based on a SHA that predates a
// service must not be asserted against that service (it cannot exist there).
async function verifyRunningSha(sha, services) {
  const reads = services
    .map(
      (s) =>
        `  ${shellVarName(s.name)}_img=$(sudo docker inspect ${CONTAINER_PREFIX}${s.name}-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent)\n` +
        `  ${shellVarName(s.name)}_h=$(sudo docker inspect ${CONTAINER_PREFIX}${s.name}-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)`,
    )
    .join("\n");
  const state = services
    .map(
      (s) =>
        `${s.name}=$${shellVarName(s.name)}_img($${shellVarName(s.name)}_h)`,
    )
    .join(" ");
  const condition = services
    .map(
      (s) =>
        `[ "$${shellVarName(s.name)}_img" = "${s.image}:${sha}" ] && [ "$${shellVarName(s.name)}_h" = healthy ]`,
    )
    .join(" \\\n     && ");
  const out = await sshCapture(
    API_PROD,
    `deadline=$(( $(date +%s) + 240 ))
while true; do
${reads}
  state="${state}"
  if ${condition}; then
    echo "OK $state"; break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "TIMEOUT $state"; break
  fi
  sleep 5
done`,
  );
  console.log(`      ${out}`);
  if (!out.startsWith("OK ")) {
    die(
      `running containers do NOT carry the deployed SHA (or never got healthy):\n` +
        `  ${out}\n` +
        `  The success line would be a lie — treating this deploy as FAILED.`,
      { rollbackHint: true },
    );
  }
  ok(
    `${formatServiceNames(services)} RUN ds-*:${sha.slice(
      0,
      12,
    )} and are healthy`,
  );
}

// PRE-SWAP boot verify (#1410). `verifyRunningSha` above is the truthful-success
// gate — but it runs AFTER `up -d`, i.e. after the old containers have already
// stopped serving. #1407 is exactly that gap: `next` 16.3.1 built cleanly, the
// images swapped, and the freshly started portal + admin crash-looped, so the
// public surface 502'd until a human rolled back.
//
// This runs the freshly pulled images BEFORE anything is swapped, as throwaway
// detached containers with the SAME env_file production uses, and asserts each
// answers non-5xx on `/` from inside the container (same probe shape as the
// compose healthcheck). A non-booting image aborts the deploy while the OLD
// containers are still up and serving — the public surface never sees it.
//
// Scope: every SHA-tagged service of the TARGET tree except the api (#1896) —
// the Next standalone images, with the port each one listens on read from the
// same compose file. The api is deliberately NOT probed here: it needs
// Postgres/Redis/Zitadel on the compose network, so a detached one-shot would
// fail for reasons unrelated to the image and turn a safety gate into a flaky
// one. The api keeps its compose healthcheck + `verifyRunningSha`.
//
// The set is derived, never hard-coded: the first live `--ref` hotfix built on a
// base predating the `doctor` storefront, and a hard-coded probe demanded an
// image that cannot exist at that SHA (`doctor=NOSTART`, #1896).
//
// No published ports, no compose network, unique container names, always removed
// — the probe cannot collide with or disturb the live stack.
async function verifyImagesBoot(sha, services) {
  const probed = bootProbeSet(services);
  const out = await sshCapture(
    API_PROD,
    `probe() {
  svc="$1"; repo="$2"; port="$3"
  name="ds-bootcheck-$svc"
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
  # -e PORT after --env-file on purpose: an explicit -e outranks the env-file, the
  # same precedence compose \`environment:\` has over \`env_file:\` (DSO-100).
  if ! sudo docker run -d --name "$name" --env-file /etc/ds-platform/api.env \\
        -e PORT="$port" -e HOSTNAME=0.0.0.0 "$repo:${sha}" >/dev/null 2>&1; then
    echo "$svc=NOSTART"; return
  fi
  deadline=$(( $(date +%s) + 120 ))
  status=PENDING
  while [ "$status" = PENDING ]; do
    running=$(sudo docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)
    if sudo docker exec "$name" node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      status=OK
    elif [ "$running" != true ]; then
      status=EXITED
    elif [ "$(date +%s)" -ge "$deadline" ]; then
      status=TIMEOUT
    else
      sleep 3
    fi
  done
  echo "$svc=$status"
  if [ "$status" != OK ]; then
    echo "---- $svc boot log (last 60) ----"
    sudo docker logs --tail 60 "$name" 2>&1 || true
  fi
  sudo docker rm -f "$name" >/dev/null 2>&1 || true
}
${probed.map((s) => `probe ${s.name} ${s.image} ${s.port}`).join("\n")}`,
  );
  console.log(
    out
      .split(/\r?\n/)
      .map((l) => `      ${l}`)
      .join("\n"),
  );
  const names = probed.map((s) => s.name);
  const verdicts = Object.fromEntries(
    out
      .split(/\r?\n/)
      .map((l) => l.trim().match(/^([A-Za-z0-9._-]+)=(\w+)$/))
      .filter((m) => m && names.includes(m[1]))
      .map((m) => [m[1], m[2]]),
  );
  const bad = names.filter((s) => verdicts[s] !== "OK");
  if (bad.length > 0) {
    die(
      `freshly pulled image(s) do NOT boot: ${bad
        .map((s) => `${s}=${verdicts[s] ?? "NO-VERDICT"}`)
        .join(", ")}\n` +
        `  Nothing was swapped — the PREVIOUS containers are still up and serving.\n` +
        `  Fix the image (see the boot log above) and re-run the deploy (#1407/#1410).`,
    );
  }
  ok(
    `${formatServiceImages(probed)} :${sha.slice(
      0,
      12,
    )} boot and serve / before the swap`,
  );
}

// --- deploy ---------------------------------------------------------------

// Read-only preflight; each subsequent guarded callback re-reads the cluster.
export async function preparePostgresDeployment(
  sha,
  { client, certificate, readTarget = readPostgresTarget } = {},
) {
  const plan = readTarget(sha);
  const probePlan = {
    ...plan,
    target: certifiedTarget(plan.target, certificate),
    preferRecordedImages: !certificate,
  };
  // #3313: ds-data-prod's `postgres-probe` verb. `client` is the read-only operator
  // check's own audited data-prod client (postgres-artifact-check.mjs) — same verb.
  const read = async () =>
    JSON.parse(
      await (client ?? dataProd()).call(["postgres-probe"], {
        input: JSON.stringify(postgresProbeRequest(probePlan)),
      }),
    );
  let live = await read();
  const expected = assertPostgresEvidence({ ...plan, live, certificate });
  return {
    identity: expected,
    async run(mutate) {
      live = await read();
      return guardedPostgresStep({
        ...plan,
        live,
        certificate,
        expected,
        mutate: () => mutate({ live, sourceHash: plan.sourceHash }),
      });
    },
  };
}

// `local` (#3157): `{ imagesFile }` of a box-local run, null on the operator path.
async function deploy(hotfixRef = null, local = null) {
  const walk = planWalker({ local: Boolean(local) });
  const { sha, images } = walk.operatorPhase("preflight")
    ? await preflight(hotfixRef)
    : await readLocalRelease(local.imagesFile);
  walk.phase("test-token");
  await assertProdApiEnvHasNoTestToken();
  // #1896: everything per-service below (pull banner, pre-swap boot probe,
  // truthful-success verify, smoke scope) is derived from THIS set.
  walk.phase("service-set");
  const services = resolveTargetServiceSet(
    sha,
    hotfixRef ? `hotfix ${sha.slice(0, 12)}` : "origin/main",
  );
  const certIndex = process.argv.indexOf("--postgres-artifacts");
  const certificate =
    certIndex < 0
      ? undefined
      : JSON.parse(readFileSync(process.argv[certIndex + 1], "utf8"));
  walk.phase("postgres-verify");
  step(
    "PostgreSQL: verify cluster, backup path, mounts and immutable target artifacts",
  );
  const postgres = await preparePostgresDeployment(sha, {
    certificate,
    ...(LOCAL_TREE
      ? { readTarget: (target) => readPostgresTargetFromTree(target, LOCAL_TREE) }
      : {}),
  });
  // What the banners call the thing being shipped: `origin/main` for the normal
  // train, an explicit «hotfix @ <sha>» for `--ref` (#1881) — a deploy log that
  // says "origin/main" while shipping a cherry-pick branch is a lie the next
  // reader would act on.
  const targetLabel = hotfixRef
    ? `hotfix @ ${sha.slice(0, 12)}`
    : `origin/main @ ${sha.slice(0, 12)}`;

  // Capture the previously-deployed prod SHA BEFORE the pull/up swap — the
  // durable deploy record IS the running api-prod container's image tag
  // `ds-api:<sha>` (no separate persistence file). This is the anchor the
  // release-notes digest ranges from (Issue #868). Non-fatal: any ssh error →
  // prevSha=null (the digest then skips green — it never breaks the deploy).
  walk.phase("previous-sha");
  let prevSha;
  try {
    prevSha = await readLiveProdSha();
    console.log(
      `  ↩ previous prod SHA (from running ds-api image): ${prevSha ? prevSha.slice(0, 12) : "none"}`,
    );
  } catch (e) {
    prevSha = null;
    console.log(
      `  ⚠ could not read the previous prod SHA (${e.message}) — release-notes range disabled for this deploy.`,
    );
  }
  // #3157: the box-local run refuses a downgrade, then records the release-notes
  // basis — the runner cuts the release from `status prod <sha>`, without box access.
  if (local) {
    const descent = descendsFromLiveVerdict({
      live: prevSha,
      sha,
      status: prevSha ? await compareStatus(prevSha, sha) : null,
    });
    if (!descent.ok) die(descent.reason);
    try {
      await sshScript(API_PROD, recordPreviousShaScript(sha, prevSha), {
        label: "record the previous SHA",
      });
    } catch (e) {
      console.log(
        `  ⚠ could not record the previous prod SHA for status (${e.message}) — the release notes of this release have no basis.`,
      );
    }
  }

  // #3274: the configs the running caddy/centrifugo serve, kept outside the tree the
  // ship below replaces — the restore source of a failed validate or apply.
  walk.phase("runtime-config-backup");
  step("#3274: keep the running Caddy + Centrifugo configs (BEFORE the ship)");
  await backupRuntimeConfigs(sha);

  const shipLabel =
    hotfixRef && prevSha
      ? `${targetLabel} (base ${prevSha.slice(0, 12)})`
      : targetLabel;
  walk.phase("ship");
  step(`Ship ${shipLabel} → both boxes`);
  let t = Date.now();
  await postgres.run(async ({ live }) => {
    // Outside the shipped tree: an interrupted archive swap must not rewrite
    // the provenance of the still-running PostgreSQL image on re-entry.
    await dataProd().call(["postgres-checkpoint"], { input: postgresStateRecord(live) });
    await shipTree(sha, API_PROD);
  });
  ok(`archive → ${API_PROD}`, t);
  t = Date.now();
  await postgres.run(() => shipDataProd(sha));
  ok(`archive → ${DATA_PROD}`, t);
  // #2982: the durable entrypoint comes from the tree just shipped, every run (with
  // the CI keys' forced command ds-deploy-entrypoint, #2984).
  walk.phase("install");
  // #2987: the install also keeps this tree as the box-side rollback's tooling tree.
  await sshScript(API_PROD, releaseInstallScript(PROD_LIVE_TREE, { sha }), { label: "install ds-release" });
  // #3313: ds-data-prod installs from the tree it was just shipped, box-side.
  await dataProd().call(["install", sha]);
  ok("ds-release + ds-deploy-entrypoint installed on both boxes");
  // #3320: the Actions run converges ds-data-prod's hop to the forced command itself,
  // before any data-prod state change (a no-op once converged); the workstation path
  // reaches it as breakglass, a shell login, and never converges.
  if (local) await dataProd().converge(sha);
  openReleaseSha = sha;

  step("data-prod: bring up persistence plane (idempotent)");
  t = Date.now();
  // The compose interpolation files live INSIDE the shipped tree, which every ship
  // replaces — so they are rewritten on every run, outside the durable unit: a
  // re-run whose `up` returns its recorded verdict still leaves them in place for
  // the compose calls after it (#2982).
  walk.phase("data-prod-env");
  await postgres.run(({ live }) =>
    dataProd().call(["data-env"], { input: dataProdEnvPayload(live) }),
  );
  walk.phase("data-prod-up");
  await postgres.run(() => dataProdStep(sha, "up", "data-prod up"));
  await postgres.run(({ live, sourceHash }) =>
    dataProd().call(["postgres-checkpoint"], { input: postgresStateRecord(live, sourceHash) }),
  );
  ok("postgres + redis + pgbackrest up", t);

  step("DSO-129: pgbackrest pre-migrate checkpoint (BEFORE migrate)");
  t = Date.now();
  // Reuse the on-box-proven wrapper (same one cron runs); `incr` is the fast,
  // correct pre-migrate anchor at the pre-pilot's near-zero write volume —
  // combined with synchronous WAL archiving it yields PITR to just-before-migrate
  // so an app-only rollback never needs a DB rollback.
  walk.phase("backup");
  await dataProdStep(sha, "backup", "pgbackrest checkpoint");
  const info = await dataProd().call(["backup-info"]);
  ok("pre-migrate incr backup taken", t);
  console.log(
    info
      .split(/\r?\n/)
      .map((l) => `      ${l}`)
      .join("\n"),
  );

  // ORDER (#1410): pull → boot-verify → migrate → up -d. The recorded app images
  // are pulled and PROVEN TO BOOT before the database is migrated and before any
  // container is swapped, so a #1407-class non-booting image aborts the deploy
  // with prod untouched — no 502, and no migration applied for an image that was
  // never going to serve. (The pre-migrate pgbackrest checkpoint above still
  // anchors PITR for the migrate step itself.) Nothing is built on api-prod
  // (#2981): one `next build` beside live production is what took the site down
  // for ~17 min on 2026-09-18 (#2283).
  step(
    `api-prod: pull recorded ${formatServiceImages(services, "/")} + ds-api-migrate :${sha.slice(0, 12)}…`,
  );
  t = Date.now();
  walk.phase("pull");
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
${deployShaEnvScript(sha)}
`,
    { label: "api-prod DEPLOY_SHA" },
  );
  await pullRecordedImages(sha, images, { label: "api-prod pull", durable: true });
  ok("recorded digests pulled, tagged and verified (RepoDigests)", t);

  step("#1410: PRE-SWAP boot verify (old containers still serving)");
  // No `t = Date.now()` here: verifyImagesBoot() prints its own `ok(...)` line
  // and takes no elapsed argument, so timing it would be a dead assignment.
  walk.phase("boot-verify");
  await verifyImagesBoot(sha, services);

  step("#3274: PRE-SWAP edge config validate (old containers still serving)");
  walk.phase("runtime-config-validate");
  let shippedConfigs;
  try {
    shippedConfigs = targetRuntimeConfigs(sha);
  } catch (e) {
    die(
      `cannot read the shipped runtime configs of ${sha.slice(0, 12)} (${e.message}) —` +
        " nothing was swapped; the previous containers still serve the previous configs",
    );
  }
  await assertRuntimeConfigsValid(shippedConfigs, { swapped: "Nothing was swapped" });

  step("#2149: PRE-SWAP IdP converge + SMTP and policy read-back");
  t = Date.now();
  walk.phase("idp");
  await assertProdApiEnvHasRecordKey(services);
  await provisionIdp(sha);
  ok("prod IdP converged and read back before app swap", t);

  step("api-prod: migrate → up -d");
  t = Date.now();
  walk.phase("migrate");
  await boxStep(API_PROD, sha, "migrate", migrateAndUpScript(), "api-prod deploy");
  ok("migrate + up -d", t);

  step("api-prod: apply bind-mounted Caddy + Centrifugo configs (#1175)");
  t = Date.now();
  walk.phase("runtime-configs");
  await applyRuntimeConfigsOrDie({ rollbackHint: true });
  ok("Caddy + Centrifugo run with the shipped configs", t);

  walk.phase("verify-running-sha");
  step("Verify the RUNNING containers carry the deployed SHA");
  await verifyRunningSha(sha, services);

  step(`DSO-127: image retention (keep last ${IMAGE_RETENTION} SHA tags/repo)`);
  t = Date.now();
  walk.phase("prune");
  await boxStep(API_PROD, sha, "prune", retentionScript(), "retention");
  ok("old images pruned", t);

  walk.phase("smoke");
  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha, services);

  walk.phase("finish");
  step("#2982: close the release on both boxes (frees the env lease)");
  await finishReleaseSucceeded(sha);

  if (walk.operatorPhase("release-cut")) {
    step("Cut the release at the deployed SHA (#996/§10.5 — Option A)");
    cutReleaseAtDeployedSha(sha, { hotfix: Boolean(hotfixRef) });
  }

  if (walk.operatorPhase("deployment-record")) {
    step("Record the deploy as a GitHub Deployment (#927/#942)");
    await recordDeployment(prevSha, sha);
  }
  walk.done();

  console.log(
    `\n✓ DEPLOY OK — ${shipLabel} live on prod` +
      ` (${((Date.now() - t0All) / 1000).toFixed(1)}s total).`,
  );
  console.log(`  Verify over HTTP:  curl -s ${PROD_HEALTH_URL} | jq .version`);
}

// Cut the repo-level release at the DEPLOYED SHA (#996/§10.5, Option A). The
// agent-run deploy is the release initiator: this runs BEFORE recordDeployment so
// the Deployment record (which reads `gh release list --limit 1`) references the
// freshly-cut tag. NON-FATAL by contract — the deploy has already succeeded, and
// `cutDeployRelease` never throws (it logs + returns { cut:false } on any failure
// or an empty range). A redeploy of an already-released SHA cuts nothing.
function cutReleaseAtDeployedSha(sha, { hotfix = false } = {}) {
  try {
    const res = cutDeployRelease({
      targetSha: sha,
      hotfix,
      cwd: process.cwd(),
    });
    if (res.cut) ok(`release ${res.tag} cut at ${sha.slice(0, 12)}`);
    else console.log(`  ↷ no release cut (${res.reason})`);
  } catch (e) {
    // Defensive: the seam is contractually non-throwing, but never let a release
    // cut fail a deploy that already succeeded.
    console.log(
      `  ⚠ release cut errored (deploy already succeeded): ${e?.message ?? String(e)}`,
    );
  }
}

// Record a successful deploy as a GitHub Deployment(production, sha) + success
// status (#942, spec §D3); the seam lives in ./deployment-record.mjs, shared with
// the release workflow's runner (#3158). NON-FATAL by contract.
function recordDeployment(prevSha, sha) {
  return recordDeploymentRecord({
    prevSha,
    sha,
    state: "success",
    healthUrl: PROD_HEALTH_URL,
    cwd: process.cwd(),
    log: (line) => console.log(line),
  });
}

// `services` is the TARGET-derived set (#1896): a hotfix or rollback target that
// predates a storefront or the sign-in host ships no such image and no such vhost,
// so probing its host would red a healthy deploy. The `image -> env opt-out`
// contract is the smoke's own (`OPTIONAL_VHOST_PROBES`, smoke-prod.mjs).
export function smokeEnvFor(services, env = process.env) {
  const shipped = new Set((services ?? []).map((s) => s.image));
  const out = { ...env };
  for (const [image, variable] of Object.entries(OPTIONAL_VHOST_PROBES)) {
    if (!shipped.has(image)) out[variable] = "skip";
  }
  return out;
}

function runSmoke(sha, services) {
  const env = smokeEnvFor(services);
  for (const [image, variable] of Object.entries(OPTIONAL_VHOST_PROBES)) {
    if (env[variable] === "skip" && process.env[variable] !== "skip") {
      console.log(`  ℹ the deploy target ships no ${image} image — its vhost probes are skipped for this smoke (#1896).`);
    }
  }
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "smoke-prod.mjs"), "--expect-sha", sha],
      {
        stdio: "inherit",
        env,
      },
    );
    child.on("close", (code) => {
      if (code === 0) {
        ok("prod smoke green");
        resolve();
      } else {
        die(`prod smoke RED (exit ${code}) — the new build is unhealthy`, {
          rollbackHint: true,
        });
      }
    });
  });
}

// The SHA production runs: the running api container's image tag `ds-api:<sha>` (the
// durable deploy record; no separate persistence file), or null. Throws when the box
// cannot be read.
async function readLiveProdSha() {
  const img = await sshCapture(
    API_PROD,
    `sudo docker inspect ds-api-prod-api-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent`,
  );
  const m = img.trim().match(/^ds-api:([0-9a-f]{7,40})$/i);
  return m ? m[1] : null;
}

// --- rollback (app-only; DSO-127) -----------------------------------------

/**
 * The committed `ds-release` blob at `ref`, byte-exact. `git cat-file blob` (not
 * the working-tree file, not `git show`, which may apply a textconv) so an
 * uncommitted local edit never reaches prod: `rollback()` runs no clean-tree
 * pre-flight.
 */
export function committedReleaseSource(repoRoot = REPO_ROOT, ref = "HEAD", path = DS_RELEASE_PATH) {
  const r = spawnSync("git", ["-C", repoRoot, "cat-file", "blob", `${ref}:${path}`], {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(
      `cannot read ${ref}:${path} from ${repoRoot}: ${String(r.stderr || "").trim() || `git exited ${r.status}`}`,
    );
  }
  return r.stdout;
}

/** Every box entrypoint's committed blob at `ref`, as `[{ source, dest }]` (#2984). */
export function committedReleaseSources(repoRoot = REPO_ROOT, ref = "HEAD") {
  return BOX_ENTRYPOINTS.map(({ dest, path }) => ({
    source: committedReleaseSource(repoRoot, ref, path),
    dest,
  }));
}

// `local` (#2987): `{ imagesFile, rollback }` of the box-side rollback — the release
// driver's -rollback unit runs it from the tooling tree on ds-api-prod (spec §5 «Prod
// rollback»); null on the workstation path (break-glass). One implementation: the box
// run differs only in where the target's files and digests come from, in installing
// nothing, and in excluding its own unit from the live-unit check.
async function rollback(shaArg, local = null) {
  if (!/^[0-9a-f]{7,40}$/.test(shaArg)) {
    die(`--rollback needs a git SHA (7–40 hex chars), got: ${shaArg}`);
  }
  let sha;
  let localRelease = null;
  if (local) {
    // The box has no git: the driver passes the full SHA and its recorded manifest.
    sha = shaArg;
    localRelease = await readLocalRelease(local.imagesFile);
    if (localRelease.sha !== sha) die(`--rollback ${sha}: the manifest on stdin records ${localRelease.sha}`);
    const live = await readLiveProdSha().catch(() => null);
    const target = rollbackTargetVerdict({
      live,
      sha,
      status: live ? await compareStatus(live, sha) : null,
    });
    if (!target.ok) die(`--rollback: ${target.reason}`);
    // The target tree: fetched into a directory of its own, read, never executed.
    const base = mkdtempSync(join(tmpdir(), "ds-rollback-target-"));
    process.on("exit", () => rmSync(base, { recursive: true, force: true }));
    LOCAL_TREE = await fetchTargetTree(sha, { dir: join(base, "tree") });
    if (!LOCAL_TREE) {
      die(
        `--rollback: cannot fetch the target tree of ${sha.slice(0, 12)} — its service set and` +
          " migration floor are unresolved; prod was not touched",
      );
    }
  } else {
    // Images are tagged with the FULL commit SHA — expand a short prefix via
    // local git so `--rollback 88514b6` matches `ds-api:88514b60c93d…`.
    try {
      sha = localCap("git", ["rev-parse", "--verify", `${shaArg}^{commit}`]);
    } catch {
      die(`cannot resolve ${shaArg} to a commit in the local repo`);
    }
  }
  // #2987: inside its own unit the rollback excludes exactly that unit.
  const own = local ? { exceptUnit: rollbackUnitName(sha) } : {};
  // #1896: the rollback target's OWN compose says which SHA-tagged images that
  // commit produced — rolling back below a service's introduction must not
  // demand an image that never existed at that SHA.
  const services = resolveTargetServiceSet(sha, `rollback ${sha.slice(0, 12)}`);

  // …but a rollback ships NO tree: the `up -d` below runs against the compose
  // the LAST DEPLOY left on the box, which is newer than the target. A service
  // the target predates is still declared there as `ds-<svc>:${DEPLOY_SHA:?}`,
  // and no image of it exists for the rollback SHA — a "ROLLBACK OK" would be
  // untrue for that surface (service-set.mjs → rollbackBoundaryVerdict).
  // Compare the two sets and refuse the crossing BEFORE any state change.
  // Ground truth for "what `up -d` will consume" is the compose file ON THE
  // BOX itself, read over one read-only ssh channel — NOT `/v1/health`: an
  // emergency rollback runs exactly when the api is 502/crash-looping (the
  // state the deploy's own rollbackHint sends the operator from), so a health
  // precondition would make the rollback unavailable when it is needed
  // (#1901 review). An unreadable box is a refusal (fail-closed), never
  // "assume the sets are equal".
  let boxCompose;
  try {
    boxCompose = await sshCapture(API_PROD, `cat ${API_COMPOSE}/compose.yml`);
  } catch (e) {
    die(
      `--rollback: cannot read ${API_COMPOSE}/compose.yml on ${API_PROD}` +
        ` (${e.message}) — without the box's declared service set the rollback` +
        ` cannot tell whether it crosses a service-introduction boundary.`,
    );
  }
  let boxServices;
  try {
    boxServices = deployServiceSet(boxCompose, { source: "box compose" });
  } catch (e) {
    die(`--rollback: ${e.message}`);
  }
  ok(`box compose declares ${formatServiceNames(boxServices)}`);
  const boundary = rollbackBoundaryVerdict(boxServices, services);
  if (!boundary.ok) die(`--rollback: ${boundary.reason}`);

  step(
    `App-only rollback → ${services
      .map((svc) => `${svc.image}:${sha.slice(0, 12)}`)
      .join(" / ")}`,
  );

  // ── #1607 / EARS-24: the speaker-cutover rollback compatibility floor. FIRST
  //    thing after argument resolution, so a target below the floor is refused
  //    before ANY provider read or mutation — no image probe, no `.env` rewrite,
  //    no `up -d`. The floor is keyed on migration 0036 (prod dropped
  //    `event_speakers`; the target's tree must carry the migration that dropped
  //    it). Fail-closed rules and the one recorded allow (a production DB that
  //    has not applied 0036) live in tools/deploy/rollback-floor.mjs.
  step(
    "EARS-24: rollback compatibility floor (speaker cutover, migration 0036)",
  );
  try {
    const verdict = await assertRollbackAllowed({
      sha,
      readProdCutoverState: makeProdCutoverReader({
        readPresence: () => dataProd().call(["rollback-floor"]),
      }),
      // The box has no git: the fetched target tree answers (#2987).
      targetCarriesMigration: local
        ? makeTreeCutoverMigrationProbe(LOCAL_TREE)
        : makeGitCutoverMigrationProbe(localCap),
    });
    ok(`rollback floor: ${verdict.reason}`);
  } catch (err) {
    if (err instanceof RollbackFloorError) {
      die(
        `ROLLBACK REFUSED [${err.code}] — ${err.message}\n` +
          `  The speaker cutover (spec 012, EARS-24) makes a pre-cutover image\n` +
          `  database-INCOMPATIBLE once migration 0036 has dropped \`event_speakers\`.\n` +
          `  Prod was not touched. Roll FORWARD to a release at or above the floor,\n` +
          `  or restore the database from pgbackrest first — see tools/deploy/README.md.`,
      );
    }
    throw err;
  }

  // #3054: a rollback ships no tree, so the entrypoint comes from the operator
  // checkout's HEAD — every run, like the forward path (tech spec §5 Entrypoint) —
  // and a box the forward path never reached still gets it before its first call.
  // The install is the one write before the read-only check below.
  // #2987: the box-side rollback installs nothing — it runs the installed entrypoints.
  if (!local) {
    let releaseSources;
    try {
      releaseSources = committedReleaseSources();
    } catch (e) {
      die(`--rollback: ${e.message}`);
    }
    // #3313: ds-data-prod takes no script; it keeps the entrypoints its last forward
    // release installed (the floor read above already reached its verbs).
    try {
      await sshScript(API_PROD, releaseInstallFromSourceScript(releaseSources), {
        label: "install ds-release",
      });
    } catch (e) {
      die(`--rollback: cannot install ds-release on ${API_PROD} (${e.message}); prod was not rolled back`);
    }
    ok("ds-release + ds-deploy-entrypoint installed on ds-api-prod from the operator checkout");
  }

  // #2982: a release step outlives the operator session that started it. A
  // rollback racing a still-running `migrate` (whose `up -d` would put the SHA
  // being rolled off back) is refused, read-only, before the first state change.
  for (const host of [API_PROD, DATA_PROD]) {
    try {
      if (host === DATA_PROD) await dataProd().call(["check", ...dataProdExcept(own)]);
      else await sshCapture(host, releaseCheckScript(RELEASE_ENV, own), { stderr: "pipe" });
    } catch (e) {
      die(`--rollback refused on ${host}: ${e.message}`);
    }
  }
  ok("no release step is running on either box");

  // The target images are normally still on the box (retention keeps the last
  // 3). A target older than that is pulled from ITS recorded release manifest
  // (#2981, spec rollback floor) — never rebuilt; a target without one (no
  // `main`/`hotfix/*` runtime-images run, expired artifact) refuses with that cause.
  const present = await sshCapture(
    API_PROD,
    `for img in ${services.map((svc) => `${svc.image}:${sha}`).join(" ")}; do
  if sudo docker image inspect "$img" >/dev/null 2>&1; then echo "$img OK"; else echo "$img MISSING"; fi
done`,
  );
  if (/MISSING/.test(present)) {
    console.log(
      `  ℹ target image(s) not on api-prod (pruned by retention):\n${present}\n` +
        `    pulling them from the target's recorded \`main\` digests…`,
    );
    // The box-side rollback pulls the digests of the manifest the driver checked.
    const images = local ? localRelease.images : await resolveProdImages(sha);
    await pullRecordedImages(sha, images, { label: "rollback pull" });
    ok("target images pulled by their recorded digests");
  } else {
    ok("target images present on api-prod");
  }

  // #1997: a rollback ships NO tree and re-runs NO provisioning. The
  // `provision.sh` converge steps are FORWARD-ONLY — read-before-write toward a
  // target state, with no record of the prior state to restore — so the IdP
  // instance keeps the configuration the LAST forward deploy converged it to.
  // Implication: an app image is put back, its identity-provider contract is
  // not. If the rollback target genuinely needs the older IdP configuration,
  // revert the `provision.sh` change on `main` and deploy FORWARD; hand-running
  // the older script (README step 9) is the emergency-only alternative.
  console.log(
    "  ℹ IdP provisioning is NOT rolled back (converge steps are forward-only) —" +
      "\n    the instance keeps what the last forward deploy converged it to.",
  );

  // #3274: the rollback puts back the target's runtime configs too — validated before
  // the swap, applied after it, the configs running now kept as the restore source.
  // Both paths read them from the target commit (the fetched tree, or `git show`).
  step("#3274: target Caddy + Centrifugo configs → api-prod, validated (BEFORE the swap)");
  let targetConfigs;
  try {
    targetConfigs = targetRuntimeConfigs(sha);
  } catch (e) {
    die(`--rollback: cannot read the target's runtime configs (${e.message}); prod was not rolled back`);
  }
  await backupRuntimeConfigs(sha, { rollback: true });
  try {
    await sshScript(API_PROD, runtimeConfigInstallScript(targetConfigs), {
      label: "rollback runtime configs",
    });
  } catch (e) {
    const restored = await restoreRuntimeConfigsOnDisk();
    die(
      `--rollback: cannot write the target's runtime configs (${e.message}); nothing was rolled back;` +
        ` restore of the running configs on disk: ${restored}`,
    );
  }
  await assertRuntimeConfigsValid(targetConfigs, { swapped: "Nothing was rolled back" });

  // #2982: the rollback moves prod off the SHAs the boxes recorded, so it
  // supersedes their release records under the env lock (refused while a step
  // unit runs): a later deploy of the SHA rolled off then runs every step again
  // instead of answering from verdicts that no longer describe the containers.
  // #3274: the target's configs are on disk from here; a supersede or `up -d` that
  // fails puts the running ones back, so the tree matches what still runs.
  try {
    await dataProd().call(["supersede", ...dataProdExcept(own)], { stream: true });
    step("api-prod: up -d previous tag (NO build, NO migrate — app tier only)");
    await sshScript(
      API_PROD,
      releaseSupersedeScript(
        RELEASE_ENV,
        `cd ${API_COMPOSE}
# Same DEPLOY_SHA-only rewrite as the deploy path — never clobber the other
# non-secret interpolation vars (SMARTCAPTCHA_SITE_KEY, #729/#186).
${deployShaEnvScript(sha)}
sudo docker compose up -d
`,
        own,
      ),
      { label: "rollback up" },
    );
  } catch (e) {
    die(`--rollback: the supersede / up -d failed (${e.message}); ${await rollbackSwapFailureReport()}`);
  }

  step("api-prod: apply the target's bind-mounted Caddy + Centrifugo configs (#3274)");
  await applyRuntimeConfigsOrDie();
  ok("Caddy + Centrifugo run with the target's configs");

  step("Verify the RUNNING containers carry the rollback SHA");
  await verifyRunningSha(sha, services);

  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha, services);

  console.log(
    `\n✓ ROLLBACK OK — app tier reverted to ${sha.slice(0, 12)}.` +
      `\n  DB was NOT touched (expand/contract migrations keep prior app code` +
      ` compatible). A bad migration needs a pgbackrest restore — see README.`,
  );
}

// --- entry ----------------------------------------------------------------

async function main() {
  // #3157: the prod release driver's box-local run takes no operator flag at all.
  const localUsage = parseLocalFlags(process.argv.slice(2));
  if (localUsage.error) die(localUsage.error);
  if (localUsage.local) {
    useLocalHosts();
    if (localUsage.local.rollback) await rollback(localUsage.local.rollback, localUsage.local);
    else await deploy(null, localUsage.local);
    return;
  }

  // Validate CLI usage FIRST — a mistyped/bare `--release-gate-exempt` must
  // fail fast, not after the clean-tree, fetch, green-CI and эфир probes have
  // already run (the same contract `--rollback` validates its argument under).
  const exemptUsage = parseReleaseGateExempt(process.argv);
  if (exemptUsage.error) die(exemptUsage.error);

  // `--ref <sha>` (#1881) validates under the same contract: a bare, mistyped or
  // `--rollback`-combined flag dies BEFORE the clean-tree / fetch / CI probes.
  const refUsage = parseRefFlag(process.argv);
  if (refUsage.error) die(refUsage.error);

  const rbIdx = process.argv.indexOf("--rollback");
  if (rbIdx !== -1) {
    const sha = process.argv[rbIdx + 1];
    if (!sha) die("--rollback requires a <sha> argument");
    await rollback(sha);
  } else {
    await deploy(refUsage.ref);
  }
}

// Run main only when invoked directly (same guard as tools/gh/dispatch-probe.mjs),
// so the pure watchdog/ssh-args helpers can be imported in unit tests without
// firing the deploy pipeline. `pathToFileURL` yields canonical `file:///C:/…` on
// Windows too.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const selfPath = resolve(fileURLToPath(import.meta.url));
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => {
    die(err.stack || err.message);
  });
}
