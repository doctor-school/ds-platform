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
//   data-prod   up -d --build (idempotent)
//   checkpoint  pgbackrest pre-migrate incr backup  (DSO-129 — BEFORE migrate)
//   api-prod    migrate → build (ds-api:<sha>, ds-portal:<sha>) → up -d
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

// --- config (env-overridable; SSH aliases live in ~/.ssh/config) ----------

const API_PROD = process.env.DS_API_PROD_SSH || "ds-api-prod";
const DATA_PROD = process.env.DS_DATA_PROD_SSH || "ds-data-prod";
const REMOTE_TREE = "~/ds-platform";
const VPC_IP = process.env.DS_DATA_PROD_VPC_IP || "192.168.0.10";
const IMAGE_RETENTION = 3;

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
    console.log("  ⚠ --skip-ci-check: SKIPPING the green-CI gate (escape hatch)");
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
  if (bad.length)
    die(`CI is RED for ${sha.slice(0, 12)}: ${bad.join(", ")}`);
  ok(`CI green — ${latest.size} check(s) passed for ${sha.slice(0, 12)}`);
}

// --- ssh helpers ----------------------------------------------------------

// Run a bash script on a box, fed over stdin (no shell-quoting hell). Streams
// the box's stdout/stderr live. Rejects on non-zero exit.
function sshScript(host, script, { label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [host, "bash", "-euo", "pipefail", "-s"], {
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
function sshCapture(host, script) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [host, "bash", "-euo", "pipefail", "-s"], {
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
sudo docker compose up -d --build
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
printf 'DEPLOY_SHA=%s\\n' '${sha}' > .env
echo '── migrate (drizzle-kit; idempotent) ──'
sudo docker compose --profile migrate run --rm migrate
echo '── build ds-api:${sha.slice(0, 12)}… + ds-portal ──'
sudo docker compose build
echo '── up -d ──'
sudo docker compose up -d
`,
    { label: "api-prod deploy" },
  );
  ok("migrate + build + up -d", t);

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
echo "retained ds-api tags:"; sudo docker images ds-api --format '  {{.Tag}} ({{.CreatedAt}})'
`,
    { label: "retention" },
  );
  ok("old images pruned", t);

  step("DSO-128: prod smoke (--expect-sha)");
  await runSmoke(sha);

  console.log(
    `\n✓ DEPLOY OK — origin/main @ ${sha.slice(0, 12)} live on prod` +
      ` (${((Date.now() - t0All) / 1000).toFixed(1)}s total).`,
  );
  console.log(
    `  Verify over HTTP:  curl -s https://api.doctor.school/v1/health | jq .version`,
  );
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

async function rollback(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    die(`--rollback needs a git SHA (7–40 hex chars), got: ${sha}`);
  }
  step(`App-only rollback → ds-api:${sha.slice(0, 12)} / ds-portal:${sha.slice(0, 12)}`);

  // The target images must still be on the box (retention keeps the last 3).
  const present = await sshCapture(
    API_PROD,
    `for img in ds-api:${sha} ds-portal:${sha}; do
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
printf 'DEPLOY_SHA=%s\\n' '${sha}' > .env
sudo docker compose up -d
`,
    { label: "rollback up" },
  );
  ok("app tier swapped to previous image");

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
