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
//     pnpm deploy:prod --rollback <sha>   app-only rollback to a prior SHA tag
//     pnpm deploy:prod --skip-ci-check    (escape hatch; logs a loud warning)
//
// Pipeline (deploy):
//   pre-flight  clean tree · HEAD==origin/main · green CI for the SHA (gh)
//   ship        git archive <sha> → api-prod + data-prod over ssh (no registry)
//   data-prod   up -d --build (idempotent; attestations off → no-op ≠ recreate, #486)
//   checkpoint  pgbackrest pre-migrate incr backup  (DSO-129 — BEFORE migrate)
//   api-prod    migrate → build (ds-api:<sha>, ds-portal:<sha>, ds-admin:<sha>) → up -d
//   caddy       reload the bind-mounted Caddyfile (`up -d` never re-reads it, #751)
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
import { join } from "node:path";

import { envFooter } from "../ci/post-product-note.mjs";
import { createDeploymentRecord } from "./deployment-record.mjs";
import { composeDigest } from "./release-notes.mjs";

// Prod health endpoint — the status record's `log_url` and the verify-over-HTTP
// pointer (#942/#927). Kept in one place so the record and the printed hint agree.
const PROD_HEALTH_URL = "https://api.doctor.school/v1/health";

// --- config (env-overridable; SSH aliases live in ~/.ssh/config) ----------

const API_PROD = process.env.DS_API_PROD_SSH || "ds-api-prod";
const DATA_PROD = process.env.DS_DATA_PROD_SSH || "ds-data-prod";
const REMOTE_TREE = "~/ds-platform";
const VPC_IP = process.env.DS_DATA_PROD_VPC_IP || "192.168.0.10";
const IMAGE_RETENTION = 3;

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

function preflight() {
  step("Pre-flight: clean tree · HEAD==origin/main · green CI");

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
  localCap("git", ["fetch", "origin", "main"]);
  const head = localCap("git", ["rev-parse", "HEAD"]);
  const originMain = localCap("git", ["rev-parse", "origin/main"]);
  if (head !== originMain) {
    console.log(
      `  ⚠ HEAD (${head.slice(0, 12)}) != origin/main (${originMain.slice(0, 12)}) —` +
        ` deploying origin/main, NOT your local HEAD.`,
    );
  } else {
    ok(`HEAD == origin/main @ ${originMain.slice(0, 12)}`);
  }

  // 3. green CI for this exact SHA
  if (process.argv.includes("--skip-ci-check")) {
    console.log(
      "  ⚠ --skip-ci-check: SKIPPING the green-CI gate (escape hatch)",
    );
  } else {
    assertGreenCi(originMain);
  }
  return originMain;
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

function sshScript(host, script, { label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [host, REMOTE_BASH], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label || "ssh"} on ${host} exited ${code}`)),
    );
    child.stdin.write(script);
    child.stdin.end();
  });
}

// Capture a box's stdout (small commands: image inspect, pgbackrest info).
// Same stdin-drain contract as sshScript (see REMOTE_BASH).
function sshCapture(host, script) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [host, REMOTE_BASH], {
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

// Truthful-success gate (DSO-127 rework): after `up -d`, prove the RUNNING
// api + portal containers actually carry the deployed SHA-tagged images and
// reach healthy — a "DEPLOY OK" line must never outrun the box's reality
// again. Polls on-box (one ssh channel) up to ~4 min to cover the containers'
// healthcheck start_period + retries after a real image swap.
async function verifyRunningSha(sha) {
  const out = await sshCapture(
    API_PROD,
    `deadline=$(( $(date +%s) + 240 ))
while true; do
  api_img=$(sudo docker inspect ds-api-prod-api-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent)
  portal_img=$(sudo docker inspect ds-api-prod-portal-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent)
  admin_img=$(sudo docker inspect ds-api-prod-admin-1 --format '{{.Config.Image}}' 2>/dev/null || echo absent)
  api_h=$(sudo docker inspect ds-api-prod-api-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)
  portal_h=$(sudo docker inspect ds-api-prod-portal-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)
  admin_h=$(sudo docker inspect ds-api-prod-admin-1 --format '{{.State.Health.Status}}' 2>/dev/null || echo absent)
  state="api=$api_img($api_h) portal=$portal_img($portal_h) admin=$admin_img($admin_h)"
  if [ "$api_img" = "ds-api:${sha}" ] && [ "$portal_img" = "ds-portal:${sha}" ] \\
     && [ "$admin_img" = "ds-admin:${sha}" ] \\
     && [ "$api_h" = healthy ] && [ "$portal_h" = healthy ] && [ "$admin_h" = healthy ]; then
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
  ok(`api + portal + admin RUN ds-*:${sha.slice(0, 12)} and are healthy`);
}

// Ship the committed tree to a box: git archive <sha> | ssh box 'rm -rf && tar x'.
// Streams are piped in-process (Windows-safe — no shell pipe / redirection).
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
      const child = spawn(
        "ssh",
        [host, `rm -rf ${REMOTE_TREE} && mkdir -p ~ && tar xzf - -C ~`],
        { stdio: ["pipe", "inherit", "inherit"] },
      );
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

async function deploy() {
  const sha = preflight();

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

  step(`Ship origin/main @ ${sha.slice(0, 12)} → both boxes`);
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
    { label: "data-prod up" },
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

  step("api-prod: migrate → build → up -d");
  t = Date.now();
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
# Rewrite ONLY the DEPLOY_SHA line — this .env also carries other non-secret
# compose-interpolation vars (SMARTCAPTCHA_SITE_KEY, #729/#186: the portal's
# BUILD-time captcha site key) that a clobbering '>' would silently wipe,
# baking an empty site key into the very portal image built two lines below.
{ { [ -f .env ] && grep -v '^DEPLOY_SHA=' .env; } || true; printf 'DEPLOY_SHA=%s\\n' '${sha}'; } > .env.next && mv .env.next .env
echo '── migrate (drizzle-kit; idempotent) ──'
# --build: rebuild the migrate image from the freshly shipped tree, else the
#   run reuses a stale ds-api-migrate:local and applies OLD migrations.
# </dev/null: compose run attaches the container's stdin by default — never
#   let it read this shell's stdin (see REMOTE_BASH; defense in depth).
# ${NO_ATTEST}: reproducible image IDs so a same-SHA re-run is a true no-op (#486).
sudo ${NO_ATTEST} docker compose --profile migrate run --build --rm migrate </dev/null
echo '── build ds-api:${sha.slice(0, 12)}… + ds-portal + ds-admin ──'
sudo ${NO_ATTEST} docker compose build
echo '── up -d ──'
sudo docker compose up -d
`,
    { label: "api-prod deploy" },
  );
  ok("migrate + build + up -d", t);

  step("caddy: reload config (bind-mounted Caddyfile, #751)");
  t = Date.now();
  // The Caddyfile is a read-only BIND MOUNT (compose.yml), so `up -d` sees an
  // unchanged container definition and does NOT recreate caddy when only the
  // Caddyfile changed — new vhosts/routes stay unloaded until a reload (#729
  // wave-1: the fresh admin.doctor.school vhost drew a Caddy 404 until a manual
  // `docker compose restart caddy`). Always reload via caddy's admin API; if the
  // exec fails (container just (re)created and not up yet, or stopped), fall
  // back to a full `restart caddy` — either way the shipped Caddyfile is live.
  await sshScript(
    API_PROD,
    `cd ${API_COMPOSE}
sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \\
  || { echo '  ⚠ caddy reload failed — falling back to: docker compose restart caddy'; sudo docker compose restart caddy; }
`,
    { label: "caddy reload" },
  );
  ok("caddy serves the shipped Caddyfile", t);

  step("Verify the RUNNING containers carry the deployed SHA");
  await verifyRunningSha(sha);

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
prune_repo ds-api ${IMAGE_RETENTION}
prune_repo ds-portal ${IMAGE_RETENTION}
prune_repo ds-admin ${IMAGE_RETENTION}
echo "retained ds-api tags:"; sudo docker images ds-api --format '  {{.Tag}} ({{.CreatedAt}})'
`,
    { label: "retention" },
  );
  ok("old images pruned", t);

  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha);

  step("Post the aggregated release note to Mattermost (#868)");
  await postReleaseNotes(prevSha, sha);

  step("Record the deploy as a GitHub Deployment (#927/#942)");
  await recordDeployment(prevSha, sha);

  console.log(
    `\n✓ DEPLOY OK — origin/main @ ${sha.slice(0, 12)} live on prod` +
      ` (${((Date.now() - t0All) / 1000).toFixed(1)}s total).`,
  );
  console.log(`  Verify over HTTP:  curl -s ${PROD_HEALTH_URL} | jq .version`);
}

// Record a successful deploy as a GitHub Deployment(production, sha) + success
// status, persisting the release-notes digest into the Deployment payload (#942,
// spec §D3). NON-FATAL by contract: the deploy has already succeeded here, so any
// gh/compose failure only WARNS — the deploy exit code stays 0. The Mattermost
// post (postReleaseNotes) and this record share the ONE composeDigest seam (#847).
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

// Post the aggregated PROD release note (#868). NON-FATAL by contract: the deploy
// has already succeeded here, so a webhook/gh failure only warns and the deploy
// exit code stays 0 — a release-notes hiccup must never turn a good deploy red.
function postReleaseNotes(prevSha, sha) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(import.meta.dirname, "release-notes.mjs"),
        "--prev-sha",
        prevSha || "none",
        "--new-sha",
        sha,
      ],
      { stdio: "inherit", env: { ...process.env, DELIVERY_ENV: "prod" } },
    );
    child.on("error", (e) => {
      console.log(
        `  ⚠ release-notes digest failed to post (deploy already succeeded): ${e.message}`,
      );
      resolve();
    });
    child.on("close", (code) => {
      if (code === 0) ok("release note posted (or cleanly skipped)");
      else
        console.log(
          `  ⚠ release-notes digest failed to post (deploy already succeeded): exit ${code}`,
        );
      resolve();
    });
  });
}

function runSmoke(sha) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "smoke-prod.mjs"), "--expect-sha", sha],
      { stdio: "inherit" },
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
  step(
    `App-only rollback → ds-api:${sha.slice(0, 12)} / ds-portal:${sha.slice(0, 12)} / ds-admin:${sha.slice(0, 12)}`,
  );

  // The target images must still be on the box (retention keeps the last 3).
  const present = await sshCapture(
    API_PROD,
    `for img in ds-api:${sha} ds-portal:${sha} ds-admin:${sha}; do
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
  await verifyRunningSha(sha);

  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha);

  console.log(
    `\n✓ ROLLBACK OK — app tier reverted to ${sha.slice(0, 12)}.` +
      `\n  DB was NOT touched (expand/contract migrations keep prior app code` +
      ` compatible). A bad migration needs a pgbackrest restore — see README.`,
  );
}

// --- entry ----------------------------------------------------------------

async function main() {
  const rbIdx = process.argv.indexOf("--rollback");
  if (rbIdx !== -1) {
    const sha = process.argv[rbIdx + 1];
    if (!sha) die("--rollback requires a <sha> argument");
    await rollback(sha);
  } else {
    await deploy();
  }
}

main().catch((err) => {
  die(err.stack || err.message);
});
