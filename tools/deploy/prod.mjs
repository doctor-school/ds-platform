#!/usr/bin/env node
// DS Platform — idempotent prod deploy (DSO-126/127/128/129).
//
// One command reproducibly rolls `origin/main` onto the always-on Timeweb prod
// environment (api-prod public + data-prod private), formalising the manual
// runbook in infra/deploy/README.md §5–§10. The manual path stays valid as an
// appendix — this script does not replace first-time provisioning (Terraform,
// DNS, secrets, Zitadel first-boot bootstrap); it is the STEADY-STATE redeploy.
//
//   Usage:
//     pnpm deploy:prod                 deploy origin/main (default)
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
//                                          Stage-B hold — #1662; reason is
//                                          mandatory and loudly printed)
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
//   ship        git archive <sha> → api-prod + data-prod over ssh (no registry)
//   data-prod   up -d --build (idempotent; attestations off → no-op ≠ recreate, #486)
//   checkpoint  pgbackrest pre-migrate incr backup  (DSO-129 — BEFORE migrate)
//   api-prod    migrate → build the SHA-tagged images of the TARGET tree's
//               compose (ds-<svc>:<sha>; derived, #1896) → up -d
//   config      compare running bind mounts; restart only stale consumers (#1175)
//   retention   keep the last 3 SHA-tagged images per repo  (DSO-127)
//   smoke       tools/deploy/smoke-prod.mjs --expect-sha <sha>  (DSO-128)
//
// Fail-closed: it refuses a dirty tree / detached-from-main HEAD / red CI, and
// stops at the FIRST red step, printing a rollback pointer — never "fixes prod
// by hand". Idempotent + safe to re-run: archive overwrite, `up -d`, and
// `drizzle-kit migrate` are all no-ops when already current.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { envFooter } from "../ci/post-product-note.mjs";
import { cutDeployRelease } from "../release/cut-release.mjs";
import { createDeploymentRecord } from "./deployment-record.mjs";
import {
  REF_FLAG,
  hotfixPreflightVerdict,
  parseCherryOutput,
  parseRefFlag,
} from "./hotfix-ref.mjs";
import {
  RELEASE_GATE_EXEMPT_FLAG,
  evaluateReleaseGate,
  formatReleaseGateClear,
  formatReleaseGateHold,
  parseReleaseGateExempt,
  probeHealthSha,
  probeReleaseGate,
} from "./release-gate.mjs";
import { composeDigest } from "./release-notes.mjs";
import {
  assertRollbackAllowed,
  makeGitCutoverMigrationProbe,
  makeProdCutoverReader,
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

// Prod health endpoint — the status record's `log_url` and the verify-over-HTTP
// pointer (#942/#927). Kept in one place so the record and the printed hint agree.
export const PROD_HEALTH_URL = "https://api.doctor.school/v1/health";

// --- config (env-overridable; SSH aliases live in ~/.ssh/config) ----------

const API_PROD = process.env.DS_API_PROD_SSH || "ds-api-prod";
const DATA_PROD = process.env.DS_DATA_PROD_SSH || "ds-data-prod";
const REMOTE_TREE = "~/ds-platform";
const VPC_IP = process.env.DS_DATA_PROD_VPC_IP || "192.168.0.10";
const IMAGE_RETENTION = 3;
// #1419: build-cache cap. SINGLE SOURCE for the post-deploy prune below. The
// daemon-level policy in `infra/deploy/cloud-init/api-prod.yaml`
// (`builder.gc.defaultReservedSpace` in /etc/docker/daemon.json) MUST carry the
// same figure — the two enforce one cap from different sides, and a silent
// disagreement makes the box's real ceiling whichever is looser. Changing this
// constant means changing the cloud-init value and the `infra/deploy/README.md`
// "Build-cache GC" section in the same commit.
const BUILD_CACHE_RESERVED_SPACE = "10GB";

// Reproducible on-box builds (#486). By default `docker compose build` attaches a
// BuildKit *provenance* attestation whose metadata varies per build, so the image
// CONFIG digest (= the image ID) changes on every rebuild even when the Dockerfile
// and context are byte-identical and every layer is cache-hit. `up -d` compares the
// running container's image ID against the tag and RECREATES on any difference — so
// a no-op redeploy needlessly recreated the data-prod `postgres` container (a ~24s
// persistence blip) and would churn the SHA-tagged api/portal images on a same-SHA
// re-run too. Disabling default attestations makes the image ID a pure function of
// the build inputs: unchanged inputs → identical ID → `up -d` is a true no-op; a
// real Dockerfile/context change → new ID → recreate (both verified live on
// data-prod). We never consume the attestation (on-box build, no registry push, no
// signature verifier), so dropping it costs nothing.
//   Placement matters: this is `sudo VAR=val cmd` (var AFTER sudo — sudo's own
//   env-setting syntax, which it honors), NOT `VAR=val sudo cmd` (var before sudo,
//   which sudo's env_reset strips — the exact trap the VPC_IP `.env` sidesteps,
//   README §7). Verified stable across repeated builds on the box.
const NO_ATTEST = "BUILDX_NO_DEFAULT_ATTESTATIONS=1";

const API_COMPOSE = `${REMOTE_TREE}/infra/deploy/compose/api-prod`;
const DATA_COMPOSE = `${REMOTE_TREE}/infra/deploy/compose/data-prod`;

// `shipTree` replaces the remote tree, so single-file bind mounts stay pinned
// to the pre-deploy inodes until their containers restart. Compare the shipped
// host files with copies read through the RUNNING containers: `docker cp` is
// daemon-side, so this does not assume either image contains a shell/hash tool.
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
  if sudo docker cp "\${container_id}:\${mounted_path}" "$mounted_copy" >/dev/null 2>&1 \\
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
      ? `Pre-flight (HOTFIX ${REF_FLAG}): clean tree · target on origin · descendant of prod · cherry-picks of main · green CI · no live broadcast · release gate`
      : "Pre-flight: clean tree · HEAD==origin/main · green CI · no live broadcast · release gate",
  );

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

  return target;
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
  ok(`hotfix target ${sha.slice(0, 12)} on origin (${contains.split(/\r?\n/).length} branch(es))`);
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

  // `git cherry <upstream> <head> <limit>`: `-` = an equivalent commit exists on
  // origin/main (a cherry-pick of merged work), `+` = it does not.
  const cherry = spawnSync(
    "git",
    ["cherry", "origin/main", target, deployed],
    { encoding: "utf8" },
  );
  if (cherry.status !== 0) {
    die(
      `${REF_FLAG}: \`git cherry origin/main ${target.slice(0, 12)} ${deployed.slice(0, 12)}\`` +
        ` failed: ${(cherry.stderr || "").trim() || "(no output)"}`,
    );
  }
  const { unmatched } = parseCherryOutput(cherry.stdout);

  const verdict = hotfixPreflightVerdict({
    deployedSha: deployed,
    targetSha: target,
    targetIsDescendant: isDescendant,
    unmatched,
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
  ok(formatReleaseGateClear(probe.basisSha));
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

// The most reliable green-CI signal for a merged main SHA is its check-runs:
// group by check name, take the LATEST run per name (so a passing re-run wins
// over an older failure), and require every latest run completed successfully.
function assertGreenCi(sha) {
  const repo = localCap("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
  let raw;
  try {
    raw = localCap("gh", [
      "api",
      "--paginate",
      `repos/${repo}/commits/${sha}/check-runs`,
      "-q",
      ".check_runs[] | {name,status,conclusion,started_at,completed_at}",
    ]);
  } catch (e) {
    die(`could not query CI check-runs via gh: ${e.message}`);
  }
  const runs = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (runs.length === 0) {
    die(
      `no CI check-runs reported for ${sha.slice(0, 12)} yet — wait for CI to run.`,
    );
  }
  // latest run per check name
  const latest = new Map();
  for (const r of runs) {
    const key = r.name;
    const ts = Date.parse(r.completed_at || r.started_at || 0) || 0;
    const prev = latest.get(key);
    if (!prev || ts >= prev._ts) latest.set(key, { ...r, _ts: ts });
  }
  const good = new Set(["success", "neutral", "skipped"]);
  const bad = [];
  const pending = [];
  for (const r of latest.values()) {
    if (r.status !== "completed") pending.push(r.name);
    else if (!good.has(r.conclusion)) bad.push(`${r.name}=${r.conclusion}`);
  }
  if (pending.length)
    die(`CI still running for ${sha.slice(0, 12)}: ${pending.join(", ")}`);
  if (bad.length) die(`CI is RED for ${sha.slice(0, 12)}: ${bad.join(", ")}`);
  ok(`CI green — ${latest.size} check(s) passed for ${sha.slice(0, 12)}`);
}

// --- ssh helpers ----------------------------------------------------------

// Keepalive on EVERY ssh channel (#905). Without these flags a half-open TCP
// connection (NAT table flush, Wi-Fi/VPN flap, box-side reset the client never
// saw) hangs the deploy silently forever — the local process just waits on a
// socket nobody will ever write to. With them the client probes the server
// every 15s and gives up after 4 missed probes (~60s): the channel dies LOUDLY
// (non-zero ssh exit → the existing die() path) instead of hanging half-open.
export function sshBaseArgs(host) {
  return ["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", host];
}

// Per-step no-output budgets for the sshScript inactivity watchdog (#905).
// Build-class steps (docker compose build of three images) legitimately go
// minutes between log lines; everything else (compose up, pgbackrest, caddy
// reload, retention) prints within seconds when healthy.
export const STALL_BUDGET_BUILD_MS = 5 * 60 * 1000;
export const STALL_BUDGET_DEFAULT_MS = 2 * 60 * 1000;

// The loud STALLED line. A tripped watchdog proves only that the LOCAL channel
// went quiet — the remote docker/pgbackrest work may have completed (or still
// be running), so the message routes the operator to the box-reality probe
// before any re-run / rollback decision.
export function formatStallMessage(label, budgetMs, host) {
  const mins = budgetMs / 60000;
  const n = Number.isInteger(mins) ? String(mins) : mins.toFixed(1);
  return (
    `STALLED: ${label} — no output for ${n}m; remote work MAY have completed.\n` +
    `  Verify by hand: pnpm deploy:probe\n` +
    `  (or: curl -fsS ${PROD_HEALTH_URL} ; ssh ${host} docker ps)`
  );
}

// Inactivity watchdog: arms on creation, `touch()` on every data chunk resets
// the timer, `stop()` disarms for good (close/error paths). Fires `onStall`
// with the formatted STALLED message at most once. Pure timer logic — unit
// tested on fake timers (tools/lint/guard-tests/deploy-stall.spec.ts).
export function createStallWatchdog({ label, budgetMs, host, onStall }) {
  let timer = null;
  let done = false;
  const arm = () => {
    timer = setTimeout(() => {
      done = true;
      timer = null;
      onStall(formatStallMessage(label, budgetMs, host));
    }, budgetMs);
  };
  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  arm();
  return {
    touch() {
      if (done) return;
      disarm();
      arm();
    },
    stop() {
      done = true;
      disarm();
    },
  };
}

// Run a bash script on a box, fed over stdin (no shell-quoting hell). Streams
// the box's stdout/stderr live. Rejects on non-zero exit.
//
// The remote command DRAINS the whole script into a variable first
// (`script=$(cat)`) and only then executes it. Never use a bare `bash -s`
// here: bash -s reads the script from stdin INCREMENTALLY, so any command
// that itself reads stdin — `docker compose run` attaches the container's
// stdin by default — silently EATS the rest of the script and bash exits 0
// at EOF. That exact failure skipped the `build` + `up -d` lines after the
// migrate step and made every deploy a silent no-op (DSO-127 rework: prod
// kept running :local while the script reported "DEPLOY OK").
// --norc: with stdin on the ssh channel, bash's remote-shell heuristic would
// source /etc/bash.bashrc (PS1 unbound under -u → stderr noise); inhibit it.
const REMOTE_BASH =
  'script=$(cat); exec bash --norc -euo pipefail -c "$script"';

// Inactivity watchdog (#905): stdout/stderr are PIPED (not inherited) so the
// parent observes every remote byte — chunks are forwarded verbatim to the
// local streams (same live-streaming UX as before) and each one resets the
// per-step no-output timer. A step whose channel goes quiet past its budget is
// killed and the deploy exits non-zero with the loud STALLED message — it
// never hangs silently again. Callers pass `stallBudgetMs` per step
// (build-class → STALL_BUDGET_BUILD_MS, default → STALL_BUDGET_DEFAULT_MS).
function sshScript(host, script, { label, stallBudgetMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshBaseArgs(host), REMOTE_BASH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stalled = false;
    const watchdog = createStallWatchdog({
      label: label || "ssh",
      budgetMs: stallBudgetMs ?? STALL_BUDGET_DEFAULT_MS,
      host,
      onStall: (msg) => {
        stalled = true;
        console.error(`\n✗ ${msg}`);
        child.kill();
        reject(new Error(msg));
      },
    });
    child.stdout.on("data", (d) => {
      watchdog.touch();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      watchdog.touch();
      process.stderr.write(d);
    });
    child.on("error", (e) => {
      watchdog.stop();
      reject(e);
    });
    child.on("close", (code) => {
      watchdog.stop();
      if (stalled) return; // already rejected with the STALLED message
      if (code === 0) resolve();
      else reject(new Error(`${label || "ssh"} on ${host} exited ${code}`));
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

// Capture a box's stdout (small commands: image inspect, pgbackrest info).
// Same stdin-drain contract as sshScript (see REMOTE_BASH). Keepalive flags
// only, no inactivity watchdog: verifyRunningSha's on-box poll is legitimately
// silent for up to ~4 min (it prints once, at the end) — a dead channel is
// caught by ServerAlive (~60s), a quiet-but-alive one is normal here.
function sshCapture(host, script) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshBaseArgs(host), REMOTE_BASH], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(`ssh capture on ${host} exited ${code}`)),
    );
    child.stdin.write(script);
    child.stdin.end();
  });
}

// Container-name prefix compose derives from the project name (`name:
// ds-api-prod` in the api-prod compose file): `<project>-<service>-1`.
const CONTAINER_PREFIX = "ds-api-prod-";

// #1896: the per-service verify set of a deploy is READ from the TARGET tree's
// compose file, not from the local checkout. `--ref <sha>` ships that commit's
// tree, so its compose is what the on-box `docker compose build` consumes and
// therefore the only truthful source for "which SHA-tagged images must boot and
// must be running afterwards". Fail-closed: an unreadable or empty derivation
// dies here, before any ssh — never "probe nothing".
function resolveTargetServiceSet(sha, label = sha.slice(0, 12)) {
  let composeText;
  try {
    composeText = localCap("git", ["show", `${sha}:${API_PROD_COMPOSE_PATH}`]);
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
    .map((s) => `${s.name}=$${shellVarName(s.name)}_img($${shellVarName(s.name)}_h)`)
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
// This runs the freshly built images BEFORE anything is swapped, as throwaway
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
      `freshly built image(s) do NOT boot: ${bad
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

// Ship the committed tree to a box through a sibling staging directory. The
// committed archive is extracted completely before the live tree is swapped,
// carrying forward only the documented api-prod compose interpolation file.
// Streams are piped in-process (Windows-safe — no shell pipe / redirection).
export function shipTreeCommand() {
  return `set -eu
live="$HOME/ds-platform"
work=$(mktemp -d "$HOME/ds-platform.ship.XXXXXX")
stage="$work/stage"
previous="$work/previous"
preserved_rel="infra/deploy/compose/api-prod/.env"
swapping=0
restore_live() {
  status="$1"
  trap - EXIT HUP INT TERM
  if [ "$swapping" -eq 1 ] && [ ! -e "$live" ] && [ -e "$previous" ]; then
    if ! mv "$previous" "$live"; then
      printf 'EMERGENCY: previous deploy tree remains recoverable at %s\\n' "$previous" >&2
      exit "$status"
    fi
  fi
  rm -rf "$work"
  exit "$status"
}
trap 'restore_live $?' EXIT
trap 'restore_live 129' HUP
trap 'restore_live 130' INT
trap 'restore_live 143' TERM

mkdir -p "$stage"
tar xzf - --strip-components=1 -C "$stage"
if [ -f "$live/$preserved_rel" ]; then
  mkdir -p "$stage/infra/deploy/compose/api-prod"
  cp -p "$live/$preserved_rel" "$stage/$preserved_rel"
fi

if [ -e "$live" ]; then
  swapping=1
  mv "$live" "$previous"
fi
mv "$stage" "$live"
swapping=0
rm -rf "$work"
trap - EXIT HUP INT TERM`;
}

async function shipTree(sha, host) {
  const tmp = join(tmpdir(), `ds-deploy-${sha.slice(0, 12)}.tar.gz`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(tmp);
    const gitp = spawn("git", [
      "archive",
      "--format=tar.gz",
      "--prefix=ds-platform/",
      sha,
    ]);
    gitp.stdout.pipe(out);
    gitp.on("error", reject);
    gitp.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error(`git archive exited ${c}`)),
    );
  });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("ssh", [...sshBaseArgs(host), shipTreeCommand()], {
        stdio: ["pipe", "inherit", "inherit"],
      });
      child.on("error", reject);
      child.on("close", (c) =>
        c === 0 ? resolve() : reject(new Error(`tar x on ${host} exited ${c}`)),
      );
      createReadStream(tmp).pipe(child.stdin);
    });
  } finally {
    await rm(tmp, { force: true });
  }
}

// --- deploy ---------------------------------------------------------------

async function deploy(hotfixRef = null) {
  const sha = await preflight(hotfixRef);
  // #1896: everything per-service below (build banner, pre-swap boot probe,
  // truthful-success verify, smoke scope) is derived from THIS set.
  const services = resolveTargetServiceSet(
    sha,
    hotfixRef ? `hotfix ${sha.slice(0, 12)}` : "origin/main",
  );
  // What the banners call the thing being shipped: `origin/main` for the normal
  // train, an explicit «hotfix @ <sha>» for `--ref` (#1881) — a deploy log that
  // says "origin/main" while shipping a cherry-pick branch is a lie the next
  // reader would act on.
  const targetLabel = hotfixRef
    ? `hotfix @ ${sha.slice(0, 12)}`
    : `origin/main @ ${sha.slice(0, 12)}`;

  // Capture the previously-deployed prod SHA BEFORE the build/up swap — the
  // durable deploy record IS the running api-prod container's image tag
  // `ds-api:<sha>` (no separate persistence file). This is the anchor the
  // release-notes digest ranges from (Issue #868). Non-fatal: any ssh error →
  // prevSha=null (the digest then skips green — it never breaks the deploy).
  let prevSha;
  try {
    const img = await sshCapture(
      API_PROD,
      `sudo docker inspect ds-api-prod-api-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent`,
    );
    const m = img.trim().match(/^ds-api:([0-9a-f]{7,40})$/i);
    prevSha = m ? m[1] : null;
    console.log(
      `  ↩ previous prod SHA (from running ds-api image): ${prevSha ? prevSha.slice(0, 12) : "none"}`,
    );
  } catch (e) {
    prevSha = null;
    console.log(
      `  ⚠ could not read the previous prod SHA (${e.message}) — release-notes range disabled for this deploy.`,
    );
  }

  const shipLabel =
    hotfixRef && prevSha
      ? `${targetLabel} (base ${prevSha.slice(0, 12)})`
      : targetLabel;
  step(`Ship ${shipLabel} → both boxes`);
  let t = Date.now();
  await shipTree(sha, API_PROD);
  ok(`archive → ${API_PROD}`, t);
  t = Date.now();
  await shipTree(sha, DATA_PROD);
  ok(`archive → ${DATA_PROD}`, t);

  step("data-prod: bring up persistence plane (idempotent)");
  t = Date.now();
  await sshScript(
    DATA_PROD,
    `cd ${DATA_COMPOSE}
printf 'VPC_IP=%s\\n' '${VPC_IP}' > .env
sudo ${NO_ATTEST} docker compose up -d --build
`,
    { label: "data-prod up", stallBudgetMs: STALL_BUDGET_BUILD_MS },
  );
  ok("postgres + redis + pgbackrest up", t);

  step("DSO-129: pgbackrest pre-migrate checkpoint (BEFORE migrate)");
  t = Date.now();
  // Reuse the on-box-proven wrapper (same one cron runs); `incr` is the fast,
  // correct pre-migrate anchor at the pre-pilot's near-zero write volume —
  // combined with synchronous WAL archiving it yields PITR to just-before-migrate
  // so an app-only rollback never needs a DB rollback.
  await sshScript(
    DATA_PROD,
    `cd ${DATA_COMPOSE}
sudo docker compose exec -T pgbackrest /usr/local/bin/backup.sh incr
`,
    { label: "pgbackrest checkpoint" },
  );
  const info = await sshCapture(
    DATA_PROD,
    `cd ${DATA_COMPOSE}
sudo docker compose exec -T pgbackrest gosu postgres pgbackrest --stanza=ds info | sed -n '1,20p'
`,
  );
  ok("pre-migrate incr backup taken", t);
  console.log(
    info
      .split(/\r?\n/)
      .map((l) => `      ${l}`)
      .join("\n"),
  );

  // ORDER (#1410): build → boot-verify → migrate → up -d. The app images are
  // built and PROVEN TO BOOT before the database is migrated and before any
  // container is swapped, so a #1407-class non-booting image aborts the deploy
  // with prod untouched — no 502, and no migration applied for a build that was
  // never going to serve. (The pre-migrate pgbackrest checkpoint above still
  // anchors PITR for the migrate step itself.)
  step(
    `api-prod: build ${formatServiceImages(services, "/")} :${sha.slice(0, 12)}…`,
  );
  t = Date.now();
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
# Rewrite ONLY the DEPLOY_SHA line — this .env also carries other non-secret
# compose-interpolation vars (SMARTCAPTCHA_SITE_KEY, #729/#186: the portal's and
# — since #1723 — the doctor storefront's BUILD-time captcha site key) that a
# clobbering '>' would silently wipe, baking an empty site key into the very
# images built two lines below.
{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env
echo '── build ${sha.slice(0, 12)}… : ${formatServiceImages(services)} ──'
# ${NO_ATTEST}: reproducible image IDs so a same-SHA re-run is a true no-op (#486).
sudo ${NO_ATTEST} docker compose build
`,
    { label: "api-prod build", stallBudgetMs: STALL_BUDGET_BUILD_MS },
  );
  ok("images built", t);

  step("#1410: PRE-SWAP boot verify (old containers still serving)");
  // No `t = Date.now()` here: verifyImagesBoot() prints its own `ok(...)` line
  // and takes no elapsed argument, so timing it would be a dead assignment.
  await verifyImagesBoot(sha, services);

  step("api-prod: migrate → up -d");
  t = Date.now();
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
echo '── migrate (drizzle-kit; idempotent) ──'
# --build: rebuild the migrate image from the freshly shipped tree, else the
#   run reuses a stale ds-api-migrate:local and applies OLD migrations.
# </dev/null: compose run attaches the container's stdin by default — never
#   let it read this shell's stdin (see REMOTE_BASH; defense in depth).
sudo ${NO_ATTEST} docker compose --profile migrate run --build --rm migrate </dev/null
echo '── up -d ──'
sudo docker compose up -d
`,
    { label: "api-prod deploy", stallBudgetMs: STALL_BUDGET_BUILD_MS },
  );
  ok("migrate + up -d", t);

  step("api-prod: apply bind-mounted Caddy + Centrifugo configs (#1175)");
  t = Date.now();
  await applyRuntimeConfigs();
  ok("Caddy + Centrifugo run with the shipped configs", t);

  step("Verify the RUNNING containers carry the deployed SHA");
  await verifyRunningSha(sha, services);

  step(`DSO-127: image retention (keep last ${IMAGE_RETENTION} SHA tags/repo)`);
  t = Date.now();
  await sshScript(
    API_PROD,
    `prune_repo() {
  repo="$1"; keep="$2"
  # \`|| true\` on grep: under pipefail a grep that filters out EVERY line (e.g.
  # only \`:local\` tags exist yet — no SHA tags) exits 1, which would abort the
  # whole deploy. "nothing to prune" is success, not failure.
  sudo docker images "$repo" --format '{{.CreatedAt}}\\t{{.Tag}}' \\
    | { grep -vP '\\tlocal$' || true; } \\
    | sort -r \\
    | awk -v k="$keep" -F'\\t' 'NR>k{print $2}' \\
    | while IFS= read -r tag; do
        [ -n "$tag" ] && sudo docker rmi "$repo:$tag" >/dev/null 2>&1 || true
      done
}
# NOT target-derived on purpose (#1896): retention must reclaim tags of every
# repo the box has EVER built, including one absent from a hotfix target's
# compose — pruning only the target's set would leak that repo's old tags.
# \`prune_repo\` is a no-op for a repo with no images.
prune_repo ds-api ${IMAGE_RETENTION}
prune_repo ds-portal ${IMAGE_RETENTION}
prune_repo ds-admin ${IMAGE_RETENTION}
prune_repo ds-doctor ${IMAGE_RETENTION}
echo "retained ds-api tags:"; sudo docker images ds-api --format '  {{.Tag}} ({{.CreatedAt}})'
`,
    { label: "retention" },
  );
  ok("old images pruned", t);

  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha, services);

  // #1419: build-cache GC. The on-box build leaves 1-3 GB of BuildKit cache per
  // deploy and nothing ever reclaimed it — api-prod reached 54.6 GB of cache /
  // 77% disk before the 2026-08-21 manual cleanup. This caps the cache at the
  // same figure the daemon-level `builder.gc.defaultReservedSpace` policy uses
  // (`/etc/docker/daemon.json`, provisioned by cloud-init/api-prod.yaml) — one
  // constant, `BUILD_CACHE_RESERVED_SPACE`; the step keeps the cap enforced on a
  // box whose daemon config predates the policy.
  //
  // Placed AFTER the smoke gate on purpose: until smoke passes, the build cache
  // is a rollback asset — a failed deploy is re-built or reverted on-box, and a
  // cold cache turns that into a 10-20 min rebuild. Prune only once the deploy
  // is verified good.
  //
  // `buildx prune --reserved-space`, NOT `builder prune --filter until=`: this
  // daemon runs the containerd snapshotter (driver=overlayfs), where the
  // `until=` filter can silently reclaim 0 bytes.
  //
  // NON-FATAL by contract: the deploy has already succeeded and been smoked, so
  // a prune failure must never fail it — hence `|| true` plus the try/catch.
  step(
    `#1419: build-cache GC (cap BuildKit cache at ${BUILD_CACHE_RESERVED_SPACE})`,
  );
  t = Date.now();
  try {
    await sshScript(
      API_PROD,
      `sudo docker buildx prune -f --reserved-space ${BUILD_CACHE_RESERVED_SPACE} || true
echo "build cache after prune:"; sudo docker system df --format '  {{.Type}}: {{.Size}} (reclaimable {{.Reclaimable}})' || true
`,
      // Build-class stall budget, not the 2-min default: pruning tens of GB of
      // BuildKit cache walks the snapshotter's content store and can go minutes
      // without writing a line — the first prune on a box that has never been
      // GC'd is the slowest one. A stall abort here would only add noise to a
      // deploy that has already passed its smoke gate.
      { label: "build-cache prune", stallBudgetMs: STALL_BUDGET_BUILD_MS },
    );
    ok(`build cache capped at ${BUILD_CACHE_RESERVED_SPACE}`, t);
  } catch (e) {
    console.log(
      `  ⚠ build-cache prune errored (deploy already succeeded): ${e?.message ?? String(e)}`,
    );
  }

  step("Cut the release at the deployed SHA (#996/§10.5 — Option A)");
  cutReleaseAtDeployedSha(sha, { hotfix: Boolean(hotfixRef) });

  step("Record the deploy as a GitHub Deployment (#927/#942)");
  await recordDeployment(prevSha, sha);

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
// status, persisting the release-notes digest into the Deployment payload (#942,
// spec §D3). NON-FATAL by contract: the deploy has already succeeded here, so any
// gh/compose failure only WARNS — the deploy exit code stays 0. This record uses
// the ONE composeDigest seam (#847) to persist the notes; the Mattermost chat POST
// is now fired from CI (`release-digest.yml`) off this Deployment's `success`
// status — `deploy:prod` no longer posts the digest itself (#968).
async function recordDeployment(prevSha, sha) {
  try {
    // Release tag shipped, if any (null until the first Release exists — expected).
    let releaseTag = null;
    try {
      const raw = localCap("gh", [
        "release",
        "list",
        "--limit",
        "1",
        "--json",
        "tagName",
      ]);
      const arr = JSON.parse(raw || "[]");
      releaseTag =
        Array.isArray(arr) && arr[0] && arr[0].tagName ? arr[0].tagName : null;
    } catch (e) {
      console.log(
        `  ⚠ could not resolve the latest release tag (recording untagged): ${e.message}`,
      );
    }

    // Release-notes digest text — the SAME seam the Mattermost post uses (#847).
    // Only computable with a real range; a first deploy / same-SHA redeploy has
    // no range and records empty notes (spec: notesText may be null/"").
    let notesText = "";
    if (prevSha && prevSha !== sha) {
      try {
        const digest = await composeDigest({
          prevSha,
          newSha: sha,
          footer: envFooter("prod"),
          cwd: process.cwd(),
        });
        if (digest) notesText = digest.text;
      } catch (e) {
        console.log(
          `  ⚠ could not compose release notes for the Deployment record (deploy already succeeded): ${e.message}`,
        );
      }
    }

    const res = createDeploymentRecord({
      sha,
      releaseTag,
      notesText,
      healthUrl: PROD_HEALTH_URL,
      cwd: process.cwd(),
    });
    if (res.ok) {
      ok(`GitHub Deployment recorded (#${res.deploymentId})`);
    } else {
      console.log(
        `  ⚠ could not record the GitHub Deployment (deploy already succeeded): ${res.error}`,
      );
    }
  } catch (e) {
    console.log(
      `  ⚠ deployment-record step failed (deploy already succeeded): ${e.message}`,
    );
  }
}

// `services` is the TARGET-derived set (#1896): a hotfix based on a SHA that
// predates the doctor storefront ships no `ds-doctor` image and no doctor vhost,
// so probing new.doctor.school would red a healthy deploy. Reuse the smoke's own
// documented opt-out (`PROD_DOCTOR_HOST=skip`, #1723) rather than a second
// mechanism.
//
// The `ds-doctor` string stays LITERAL on purpose: it is not a service list but
// the one end of the smoke's own `service -> env opt-out` contract, whose other
// end (`PROD_DOCTOR_HOST`) lives in `smoke-prod.mjs`. Deriving it would mean
// inventing a naming convention between the two files. When a SECOND optional
// vhost appears, export that mapping from `smoke-prod.mjs` and read it here —
// do not grow this into a second hard-coded service list (#1896).
function runSmoke(sha, services) {
  const shipsDoctor = (services ?? []).some((s) => s.image === "ds-doctor");
  if (!shipsDoctor) {
    console.log(
      `  ℹ the deploy target ships no ds-doctor image — the doctor storefront` +
        ` probes are skipped for this smoke (#1896).`,
    );
  }
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "smoke-prod.mjs"), "--expect-sha", sha],
      {
        stdio: "inherit",
        env: shipsDoctor
          ? process.env
          : { ...process.env, PROD_DOCTOR_HOST: "skip" },
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

// --- rollback (app-only; DSO-127) -----------------------------------------

async function rollback(shaArg) {
  if (!/^[0-9a-f]{7,40}$/.test(shaArg)) {
    die(`--rollback needs a git SHA (7–40 hex chars), got: ${shaArg}`);
  }
  // Images are tagged with the FULL commit SHA — expand a short prefix via
  // local git so `--rollback 88514b6` matches `ds-api:88514b60c93d…`.
  let sha;
  try {
    sha = localCap("git", ["rev-parse", "--verify", `${shaArg}^{commit}`]);
  } catch {
    die(`cannot resolve ${shaArg} to a commit in the local repo`);
  }
  // #1896: the rollback target's OWN compose says which SHA-tagged images that
  // commit produced — rolling back below a service's introduction must not
  // demand an image that never existed at that SHA.
  const services = resolveTargetServiceSet(sha, `rollback ${sha.slice(0, 12)}`);

  // …but a rollback ships NO tree: the `up -d` below runs against the compose
  // the LAST DEPLOY left on the box, which is newer than the target. A service
  // the target predates is still declared there WITH a `build:` section, so
  // Compose would rebuild it from the current on-box source and tag it with the
  // rollback SHA — a green "ROLLBACK OK" over the very code being reverted.
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
  step("EARS-24: rollback compatibility floor (speaker cutover, migration 0036)");
  try {
    const verdict = await assertRollbackAllowed({
      sha,
      readProdCutoverState: makeProdCutoverReader({
        sshCapture,
        host: DATA_PROD,
        composeDir: DATA_COMPOSE,
      }),
      targetCarriesMigration: makeGitCutoverMigrationProbe(localCap),
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

  // The target images must still be on the box (retention keeps the last 3).
  const present = await sshCapture(
    API_PROD,
    `for img in ${services.map((svc) => `${svc.image}:${sha}`).join(" ")}; do
  if sudo docker image inspect "$img" >/dev/null 2>&1; then echo "$img OK"; else echo "$img MISSING"; fi
done`,
  );
  if (/MISSING/.test(present)) {
    die(
      `target image(s) not on api-prod (pruned by retention?):\n${present}\n` +
        `  Roll forward instead: check out that commit's main and run \`pnpm deploy:prod\`.`,
    );
  }
  ok("target images present on api-prod");

  step("api-prod: up -d previous tag (NO rebuild, NO migrate — app tier only)");
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
# Same DEPLOY_SHA-only rewrite as the deploy path — never clobber the other
# non-secret interpolation vars (SMARTCAPTCHA_SITE_KEY, #729/#186).
{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env
sudo docker compose up -d
`,
    { label: "rollback up" },
  );

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
