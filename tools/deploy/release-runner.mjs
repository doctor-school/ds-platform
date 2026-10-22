#!/usr/bin/env node
// tools/deploy/release-runner.mjs — the runner-side halves of the release workflow
// `.github/workflows/deploy-prod.yml` (#3158). Spec:
// apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md
// §3 item 3 and §5 «Prod release driver.».
//
//   preflight --sha <sha>
//       Before the box is touched: the SHA is in `main`, its `stage-suite` status is
//       success, CI is green, the release gate and the live-broadcast gate pass, and
//       the recorded `images-<sha>.json` exists. Prints one status line per check;
//       the first refusal exits 1. Writes `images-run-id=<id>` to $GITHUB_OUTPUT.
//   record --sha <sha> --state succeeded|failed|unknown [--previous-sha <sha>]
//       After a terminal status of the prod release driver: on success the release
//       cut, then (success and failure alike) the ONE GitHub Deployment record with
//       the owner quote ($OWNER_QUOTE — env only, never an argument). `unknown` (the
//       runner lost contact) records `error`; a success already recorded for the SHA
//       writes nothing. Writes `recorded=existing|new` to $GITHUB_OUTPUT; a record
//       that could not be written exits 1.
//
// Rollback mode (#2987; spec §3 item 3 «Rollback mode», §5 «Prod rollback»):
//
//   rollback-preflight --sha <sha>
//       Before the box is touched: the reason ($REASON — env only) is not blank, the
//       SHA is the target of one of the latest 3 `release-*` Releases, a strict
//       ancestor of the live SHA (the latest successful production Deployment's;
//       compare `<live>...<sha>` = `behind`), and its `images-<sha>.json` is
//       recorded. No stage-suite, release-gate or live-broadcast check: the target
//       passed them when it shipped. Writes `images-run-id=<id>` to $GITHUB_OUTPUT.
//   rollback-verdict --sha <sha>
//       Reads one `rollback-status prod <sha>` reply on stdin and prints one line:
//       `<running|succeeded|failed|unreadable> <from-sha|-> <status line>`.
//   rollback-record --sha <sha> --state succeeded|failed|unknown [--from-sha <sha>]
//       The ONE Deployment record of the rollback, `rollback to <sha12> — <reason>`;
//       no release cut. Exits 1 when it could not be written.
//   rollback-notice --sha <sha> --state succeeded|failed|unknown
//       The Mattermost notice «откат прода на <sha12>: <reason>» with the outcome,
//       through the digest's poster ($MATTERMOST_WEBHOOK_URL; unset skips green).
//
// Every check is the workstation path's own module (ci-gate, release-gate,
// live-broadcast-check, lib/registry, deployment-record, cut-release); this file
// only orders them for a runner, which holds no box access. There is no escape
// hatch: the break-glass flags stay on `pnpm deploy:prod`.

import { spawnSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cutDeployRelease } from "../release/cut-release.mjs";
import {
  DEPLOY_PROD_WORKFLOW_PATH,
  ciVerdictProblem,
  classifyDeployCheckRuns,
  fetchDeployCiBoard,
} from "./ci-gate.mjs";
import {
  createDeploymentRecord,
  recordDeployment,
} from "./deployment-record.mjs";
import {
  PROD_MANIFEST_POLICY,
  resolveRecordedImagesViaGh,
} from "./lib/registry.mjs";
import { PROD_HEALTH_URL } from "./lib/remote.mjs";
import {
  evaluateReleaseGate,
  formatReleaseGateClear,
  formatReleaseGateHold,
  probeReleaseGate,
} from "./release-gate.mjs";
import { postToMattermost } from "./release-notes.mjs";

/** The `stage.yml` commit status the release requires (spec §3 item 3). */
export const STAGE_SUITE_CONTEXT = "stage-suite";

export const PREFLIGHT_ORDER = Object.freeze([
  "sha-in-main",
  "stage-suite",
  "ci",
  "release-gate",
  "live-broadcast",
  "recorded-images",
]);

const FULL_SHA = /^[0-9a-f]{40}$/;
const RECORD_STATES = Object.freeze({
  succeeded: "success",
  failed: "failure",
  // The runner lost contact with the driver (ssh down, or the 60-min time-out):
  // GitHub's «could not determine» state; a re-dispatch of the SHA records the verdict.
  unknown: "error",
});

/** The flags each command admits; anything else is refused. */
const COMMAND_FLAGS = Object.freeze({
  preflight: ["--sha"],
  record: ["--sha", "--state", "--previous-sha"],
  "rollback-preflight": ["--sha"],
  "rollback-verdict": ["--sha"],
  "rollback-record": ["--sha", "--state", "--from-sha"],
  "rollback-notice": ["--sha", "--state"],
});

/** Parse the CLI. Unknown flags are refused, so no escape hatch can be passed. */
export function parseRunnerArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(COMMAND_FLAGS, command ?? "")) {
    return {
      error: `unknown command ${command ?? "(none)"}: ${Object.keys(COMMAND_FLAGS).join(" | ")}`,
    };
  }
  const allowed = COMMAND_FLAGS[command];
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!allowed.includes(flag) || i + 1 >= rest.length) {
      return { error: `unknown argument ${flag} for ${command}` };
    }
    values[flag] = rest[i + 1];
  }
  const sha = values["--sha"];
  if (!FULL_SHA.test(sha ?? "")) {
    return {
      error: `--sha must be a full 40-hex commit sha, got: ${sha ?? "(none)"}`,
    };
  }
  if (!allowed.includes("--state")) return { command, sha };

  const state = values["--state"];
  if (!Object.hasOwn(RECORD_STATES, state ?? "")) {
    return {
      error: `--state must be succeeded|failed|unknown, got: ${state ?? "(none)"}`,
    };
  }
  if (command === "rollback-notice") return { command, sha, state };
  const shaFlag = command === "record" ? "--previous-sha" : "--from-sha";
  const other = values[shaFlag] || null;
  if (other !== null && !FULL_SHA.test(other)) {
    return {
      error: `${shaFlag} must be a full 40-hex commit sha, got: ${other}`,
    };
  }
  return command === "record"
    ? { command, sha, state, previousSha: other }
    : { command, sha, state, fromSha: other };
}

/**
 * The refusal for a combined-status payload (`commits/<sha>/status`), or `null`
 * when its `stage-suite` status is success. A missing status refuses: the stage
 * suite has not passed this SHA.
 */
export function stageSuiteProblem(combined) {
  const status = (combined?.statuses ?? []).find(
    (s) => s?.context === STAGE_SUITE_CONTEXT,
  );
  if (!status) {
    return `no \`${STAGE_SUITE_CONTEXT}\` status on this SHA — the stage suite has not run for it`;
  }
  if (status.state === "success") return null;
  const why = status.description ? `: ${status.description}` : "";
  return `\`${STAGE_SUITE_CONTEXT}\` is ${status.state}${why}`;
}

/**
 * The `stageSuiteProblem` of `sha`'s combined status, read through `read(sha)`
 * (the `commits/<sha>/status` payload). The release workflow and the workstation
 * release (`tools/deploy/prod.mjs`) share this read, so both refuse on one rule.
 */
export async function readStageSuiteProblem({ sha, read }) {
  return stageSuiteProblem(await read(sha));
}

/** `read` for `readStageSuiteProblem`: the combined status via `gh api`. */
export function combinedStatusViaGh({ repo, run }) {
  return (sha) =>
    JSON.parse(
      run("gh", ["api", `repos/${repo}/commits/${sha}/status?per_page=100`]),
    );
}

function capture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || "").trim().split(/\r?\n/)[0] ?? "";
    throw new Error(
      `\`${cmd} ${args.slice(0, 2).join(" ")}\` exited ${r.status}: ${detail}`,
    );
  }
  return (r.stdout || "").trim();
}

/** The pre-flight checks in the spec order, wired to the shared modules. */
export function preflightChecks({ sha, repo, cwd = process.cwd() }) {
  const short = sha.slice(0, 12);
  const checks = {
    "sha-in-main": async () => {
      const r = spawnSync(
        "git",
        ["merge-base", "--is-ancestor", sha, "origin/main"],
        {
          cwd,
          encoding: "utf8",
        },
      );
      if (r.status === 1) throw new Error(`${short} is not contained in main`);
      if (r.status !== 0) {
        throw new Error(
          `cannot tell whether ${short} is in main: git exited ${r.status}: ${(r.stderr || "").trim()}`,
        );
      }
      return { line: `${short} is contained in main` };
    },
    "stage-suite": async () => {
      const problem = await readStageSuiteProblem({
        sha,
        read: combinedStatusViaGh({
          repo,
          run: (cmd, args) => capture(cmd, args, cwd),
        }),
      });
      if (problem) throw new Error(problem);
      return { line: `\`${STAGE_SUITE_CONTEXT}\` is success for ${short}` };
    },
    ci: async () => {
      const board = fetchDeployCiBoard({
        sha,
        repo,
        run: (cmd, args) => capture(cmd, args, cwd),
      });
      const verdict = classifyDeployCheckRuns(
        board.checkRuns,
        board.workflowRuns,
        {
          ignoreWorkflowPaths: [DEPLOY_PROD_WORKFLOW_PATH],
        },
      );
      const problem = ciVerdictProblem(verdict, sha);
      if (problem) throw new Error(problem);
      return {
        line: `CI green — ${verdict.count} check(s); ${verdict.dropped.length} non-CI check(s) ignored`,
      };
    },
    "release-gate": async () => {
      const probe = await probeReleaseGate({
        targetSha: sha,
        cwd,
        healthUrl: PROD_HEALTH_URL,
      });
      const hold = formatReleaseGateHold(evaluateReleaseGate(probe));
      if (hold) throw new Error(hold);
      return { line: formatReleaseGateClear(probe.basisSha) };
    },
    "live-broadcast": async () => {
      // The CLI's exit code is its contract (0 CLEAR; 1 LIVE or UNKNOWN — both hold).
      const script = fileURLToPath(
        new URL("./live-broadcast-check.mjs", import.meta.url),
      );
      const r = spawnSync(process.execPath, [script], {
        cwd,
        encoding: "utf8",
      });
      const line = `${r.stdout || ""}${r.stderr || ""}`.trim() || "(no output)";
      if (r.status !== 0) throw new Error(`live-broadcast gate: ${line}`);
      return { line };
    },
    "recorded-images": async () => {
      const resolved = await resolveRecordedImagesViaGh({
        ...PROD_MANIFEST_POLICY,
        sha,
      });
      return {
        line: `recorded \`${resolved.ref}\` images for ${short} (run ${resolved.run.url})`,
        imagesRunId: resolved.run.databaseId,
      };
    },
  };
  return PREFLIGHT_ORDER.map((name) => ({ name, run: checks[name] }));
}

/**
 * Run the checks in order; the first refusal (a throw) stops the pre-flight. The
 * recorded-images check must name its run, or the deploy job has no manifest.
 *
 * @returns {Promise<{ok: true, imagesRunId: number} | {ok: false, failed: string, reason: string}>}
 */
export async function runPreflight({ checks, log = (l) => console.log(l) }) {
  let imagesRunId = null;
  for (const { name, run } of checks) {
    let result;
    try {
      result = await run();
    } catch (e) {
      return {
        ok: false,
        failed: name,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
    log(`✓ ${name}: ${result.line}`);
    if (name === "recorded-images") imagesRunId = result.imagesRunId ?? null;
  }
  if (!imagesRunId) {
    return {
      ok: false,
      failed: "recorded-images",
      reason: "the recorded images check named no runtime-images run",
    };
  }
  return { ok: true, imagesRunId };
}

/**
 * Whether a production Deployment of `sha` already carries a `success` status
 * (#3179): a re-dispatch answered `already-succeeded` after an earlier dispatch
 * recorded it. A success a later release made `inactive` still counts. A Deployment
 * that only holds `error` (the earlier dispatch lost contact) or `failure` does not:
 * the re-dispatch records the verdict (spec §9 «Runner dies mid-step»).
 *
 * @param {{sha: string, gh?: (args: string[]) => string}} args `gh` returns stdout.
 */
export async function successRecordExistsViaGh({
  sha,
  gh = (args) => capture("gh", args),
}) {
  const deployments = JSON.parse(
    gh([
      "api",
      `repos/{owner}/{repo}/deployments?sha=${sha}&environment=production&per_page=100`,
    ]) || "[]",
  );
  for (const d of deployments) {
    const statuses = JSON.parse(
      gh([
        "api",
        `repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=100`,
      ]) || "[]",
    );
    if (statuses.some((s) => s?.state === "success")) return true;
  }
  return false;
}

/**
 * After a terminal driver status: the release cut on success (its own base
 * selection), then the ONE Deployment record for success and failure alike, with
 * the owner quote; `previousSha` (the driver's `previousSha`) is the basis of the
 * Deployment-record notes. `unknown` records `error` with no cut. A success whose
 * record already exists writes nothing (`recorded: "existing"`).
 *
 * @returns {Promise<{ok: boolean, recorded: "existing"|"new", error?: string, deploymentId?: number}>}
 */
export async function runRecord({
  sha,
  state,
  previousSha,
  ownerQuote,
  cut = (args) => cutDeployRelease(args),
  record = (args) => recordDeployment(args),
  successRecorded = (s) => successRecordExistsViaGh({ sha: s }),
  log = (l) => console.log(l),
}) {
  if (!String(ownerQuote ?? "").trim()) {
    throw new Error(
      "owner_quote is empty — a release record needs the owner's word",
    );
  }
  const deploymentState = RECORD_STATES[state];
  if (state === "succeeded" && (await successRecorded(sha))) {
    log(
      `↷ already recorded: a success Deployment exists for ${sha.slice(0, 12)} — no cut, no second record`,
    );
    return { ok: true, recorded: "existing" };
  }
  if (state === "succeeded") {
    try {
      const res = cut({ targetSha: sha });
      log(
        res?.cut
          ? `✓ release ${res.tag} cut at ${sha.slice(0, 12)}`
          : `↷ no release cut (${res?.reason})`,
      );
    } catch (e) {
      log(
        `⚠ release cut errored (the release already succeeded): ${e?.message ?? e}`,
      );
    }
  }
  const res = await record({
    prevSha: previousSha,
    sha,
    state: deploymentState,
    ownerQuote,
    healthUrl: PROD_HEALTH_URL,
    log,
  });
  return { ...res, recorded: "new" };
}

/**
 * The CLI verdict of a `runRecord` result: a record that could not be written
 * fails the job (#3179) — the release's one record is its audit trail.
 */
export function reportRecord(res) {
  if (!res.ok) {
    return {
      exitCode: 1,
      output: null,
      message: `::error::the Deployment record was not written: ${res.error}`,
    };
  }
  return { exitCode: 0, output: `recorded=${res.recorded}\n`, message: null };
}

// --- #2987: rollback mode -------------------------------------------------------

/** The rollback pre-flight, in order (spec §3 item 3 «Rollback mode»). */
export const ROLLBACK_PREFLIGHT_ORDER = Object.freeze([
  "reason",
  "recent-release",
  "behind-live",
  "recorded-images",
]);

/** The registry keeps the images of exactly the latest 3 releases (spec §8 (a)). */
export const ROLLBACK_RELEASES = 3;

const RELEASE_TAG = /^release-(\d{4})\.(\d{2})\.(\d{2})-([1-9]\d*)$/;

/**
 * The targets of the latest `keep` `release-YYYY.MM.DD-N` Releases, newest first,
 * ordered by date and sequence (never by listing order); drafts are not releases.
 * The box driver's `check_recent_release` applies the same rule as the boundary.
 */
export function recentReleaseTargets(releases, keep = ROLLBACK_RELEASES) {
  const ranked = [];
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || typeof r !== "object" || r.draft) continue;
    const m = RELEASE_TAG.exec(String(r.tag_name ?? ""));
    if (m) {
      ranked.push({
        key: m.slice(1).map(Number),
        target: String(r.target_commitish ?? ""),
      });
    }
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < 4; i += 1) {
      if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
    }
    return 0;
  });
  return ranked.slice(0, keep).map((r) => r.target);
}

/**
 * The live prod SHA: the SHA of the newest production Deployment that carries a
 * `success` status (a later release's `inactive` does not unmake it), or null.
 */
export async function liveProdShaViaGh({ repo, gh }) {
  const deployments = JSON.parse(
    gh([
      "api",
      `repos/${repo}/deployments?environment=production&per_page=30`,
    ]) || "[]",
  );
  for (const d of deployments) {
    const statuses = JSON.parse(
      gh(["api", `repos/${repo}/deployments/${d.id}/statuses?per_page=100`]) ||
        "[]",
    );
    if (statuses.some((s) => s?.state === "success")) return d.sha ?? null;
  }
  return null;
}

/** The rollback pre-flight checks, wired to `gh` and the recorded-images reader. */
export function rollbackPreflightChecks({
  sha,
  repo,
  reason,
  cwd = process.cwd(),
  gh = (args) => capture("gh", args, cwd),
  resolveImages = (args) => resolveRecordedImagesViaGh(args),
}) {
  const short = sha.slice(0, 12);
  const checks = {
    reason: async () => {
      if (!String(reason ?? "").trim()) {
        throw new Error(
          "reason is empty — a rollback records why production is rolled back",
        );
      }
      return { line: `reason present (${String(reason).length} chars)` };
    },
    "recent-release": async () => {
      const releases = JSON.parse(
        gh(["api", `repos/${repo}/releases?per_page=100`]) || "[]",
      );
      if (!recentReleaseTargets(releases).includes(sha)) {
        throw new Error(
          `${short} is not the target of one of the latest ${ROLLBACK_RELEASES} release-* Releases`,
        );
      }
      return {
        line: `${short} is the target of one of the latest ${ROLLBACK_RELEASES} releases`,
      };
    },
    "behind-live": async () => {
      const live = await liveProdShaViaGh({ repo, gh });
      if (!FULL_SHA.test(live ?? "")) {
        throw new Error(
          "the live prod SHA is unknown (no successful production Deployment)",
        );
      }
      const status = JSON.parse(
        gh(["api", `repos/${repo}/compare/${live}...${sha}`]) || "{}",
      )?.status;
      if (status !== "behind") {
        throw new Error(
          `${short} is not behind the live prod SHA ${live.slice(0, 12)} (compare status: ${status ?? "unknown"}) — a rollback never moves production forward`,
        );
      }
      return {
        line: `${short} is behind the live prod SHA ${live.slice(0, 12)}`,
      };
    },
    "recorded-images": async () => {
      const resolved = await resolveImages({ ...PROD_MANIFEST_POLICY, sha });
      return {
        line: `recorded \`${resolved.ref}\` images for ${short} (run ${resolved.run.url})`,
        imagesRunId: resolved.run.databaseId,
      };
    },
  };
  return ROLLBACK_PREFLIGHT_ORDER.map((name) => ({ name, run: checks[name] }));
}

const TERMINAL_UNIT = new Set(["inactive", "failed", "absent"]);

/**
 * The verdict of one `rollback-status prod <sha>` reply. The unit state decides
 * as well as the record: a finished, dead or absent `-rollback` unit is succeeded
 * only with rc 0 AND a `succeeded` record — a unit that died before writing its
 * verdict leaves the record `running`, and that is a failure.
 *
 * @returns {{terminal: null|"succeeded"|"failed", line: string, from: string|null}}
 */
export function rollbackVerdict(text, sha) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = null;
  }
  const driver = doc?.driver;
  const record = doc?.rollback ?? null;
  if (
    !doc ||
    typeof driver !== "object" ||
    driver === null ||
    (record !== null && record.sha !== sha)
  ) {
    return { terminal: null, line: "unreadable reply", from: null };
  }
  const active = String(driver.active ?? "?");
  const rc = driver.rc ?? null;
  const state = record?.state ?? null;
  const from = FULL_SHA.test(record?.from ?? "") ? record.from : null;
  const line = `driver=${active} rc=${rc ?? "-"} state=${state ?? "-"}`;
  if (!TERMINAL_UNIT.has(active)) return { terminal: null, line, from };
  const terminal = rc === 0 && state === "succeeded" ? "succeeded" : "failed";
  return { terminal, line, from };
}

/**
 * After a terminal rollback status: the ONE Deployment record, no release cut.
 *
 * @returns {Promise<{ok: boolean, recorded: "new", error?: string, deploymentId?: number}>}
 */
export async function runRollbackRecord({
  sha,
  state,
  fromSha = null,
  reason,
  create = (args) => createDeploymentRecord(args),
  log = (l) => console.log(l),
}) {
  if (!String(reason ?? "").trim()) {
    throw new Error("reason is empty — a rollback record needs its reason");
  }
  const deploymentState = RECORD_STATES[state];
  const res = create({
    sha,
    releaseTag: null,
    notesText: "",
    healthUrl: PROD_HEALTH_URL,
    state: deploymentState,
    rollback: { reason, from: fromSha },
  });
  if (res.ok) {
    log(
      `✓ GitHub Deployment recorded (#${res.deploymentId}, rollback ${deploymentState})`,
    );
  }
  return { ...res, recorded: "new" };
}

const NOTICE_OUTCOME = Object.freeze({
  succeeded: "итог: откат выполнен",
  failed: "итог: откат не удался",
  unknown: "итог неизвестен: связь с прод-сервером потеряна",
});

/** The Mattermost notice of a rollback: the spec's line first, the outcome below. */
export function buildRollbackNotice({ sha, state, reason }) {
  return `откат прода на ${sha.slice(0, 12)}: ${String(reason ?? "").trim()}\n${NOTICE_OUTCOME[state]}`;
}

/** Post the rollback notice; no webhook configured skips green, as the digest does. */
export async function runRollbackNotice({
  sha,
  state,
  reason,
  webhook,
  post = (args) => postToMattermost(args),
  log = (l) => console.log(l),
}) {
  if (!webhook) {
    log(
      "MATTERMOST_WEBHOOK_URL is not configured — no rollback notice (green).",
    );
    return;
  }
  await post({ webhook, text: buildRollbackNotice({ sha, state, reason }) });
  log("✓ rollback notice posted to Mattermost");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function writeOutput(text) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
}

function repoName() {
  return (
    process.env.GITHUB_REPOSITORY ||
    capture("gh", [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "-q",
      ".nameWithOwner",
    ])
  );
}

async function main() {
  const args = parseRunnerArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`::error::release-runner: ${args.error}`);
    process.exit(2);
  }
  if (args.command === "rollback-verdict") {
    const v = rollbackVerdict(await readStdin(), args.sha);
    const word =
      v.terminal ?? (v.line === "unreadable reply" ? "unreadable" : "running");
    console.log(`${word} ${v.from ?? "-"} ${v.line}`);
    return;
  }
  if (args.command === "rollback-record") {
    const verdict = reportRecord(
      await runRollbackRecord({
        sha: args.sha,
        state: args.state,
        fromSha: args.fromSha,
        reason: process.env.REASON,
      }),
    );
    if (verdict.message) console.error(verdict.message);
    if (verdict.exitCode !== 0) process.exit(verdict.exitCode);
    return;
  }
  if (args.command === "rollback-notice") {
    await runRollbackNotice({
      sha: args.sha,
      state: args.state,
      reason: process.env.REASON,
      webhook: process.env.MATTERMOST_WEBHOOK_URL,
    });
    return;
  }
  if (args.command === "preflight" || args.command === "rollback-preflight") {
    const repo = repoName();
    const res = await runPreflight({
      checks:
        args.command === "preflight"
          ? preflightChecks({ sha: args.sha, repo })
          : rollbackPreflightChecks({
              sha: args.sha,
              repo,
              reason: process.env.REASON,
            }),
    });
    if (!res.ok) {
      console.error(
        `::error::pre-flight refused (${res.failed}): ${res.reason}`,
      );
      process.exit(1);
    }
    writeOutput(`images-run-id=${res.imagesRunId}\n`);
    console.log(`pre-flight passed for ${args.sha.slice(0, 12)}`);
    return;
  }
  const res = await runRecord({
    sha: args.sha,
    state: args.state,
    previousSha: args.previousSha,
    ownerQuote: process.env.OWNER_QUOTE,
  });
  const verdict = reportRecord(res);
  if (verdict.message) console.error(verdict.message);
  if (verdict.output && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, verdict.output);
  }
  if (verdict.exitCode !== 0) process.exit(verdict.exitCode);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(
      `::error::release-runner: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  });
}
