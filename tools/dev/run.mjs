#!/usr/bin/env node
// DS Platform — dev-stand DX launcher (portable, cross-platform).
//
// Backs the `pnpm dev:*` scripts (setup-design §9). Reads the personal
// `.env.local`, picks a transport, and drives `docker compose` against the
// dev-stand. The same `.env.local` is the single secret source for compose
// interpolation (POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, IDP_SECRET_KEY, …) —
// both recipes feed it to `docker compose` so the stack comes up with real
// secrets, never empty (GH #70). Two recipes are supported from one launcher:
//
//   - SSH recipe   (DEV_SSH_HOST set)  — syncs infra/dev-stand/ to the remote
//                                        box, ships .env.local there as the
//                                        compose `.env`, and runs `docker
//                                        compose` over the native ssh client.
//   - host-only    (DEV_SSH_HOST empty)— runs `docker compose` on the local
//                                        Docker daemon, passing the parsed
//                                        `.env.local` through the subprocess
//                                        environment for interpolation.
//
// Recipe-specific snapshot/rollback logic lives in tools/dev/recipes/<recipe>/
// and is streamed to the box over ssh — the portable launcher stays
// recipe-agnostic (setup-design §9.1).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const STAND_DIR = join(REPO_ROOT, "infra", "dev-stand");
const RECIPE_DIR = join(HERE, "recipes", "truenas-hybrid");

const COMMANDS = [
  "up",
  "down",
  "logs",
  "restart",
  "psql",
  "snapshot",
  "rollback",
  "reset-db",
  "status",
  "config",
  "db-branch",
  "db-drop",
];

function fail(msg) {
  console.error(`dev: ${msg}`);
  process.exit(1);
}

function usage() {
  console.error(
    [
      "Usage: node tools/dev/run.mjs <command> [args]   (via `pnpm dev:<command>`)",
      "",
      "  up                 start the dev-stand (detached)",
      "  down               stop the dev-stand (volumes preserved)",
      "  logs [service]     follow logs (all services, or one)",
      "  restart [service]  restart all services, or one",
      "  psql [db]          open a psql shell (default: the shared ds_dev)",
      "  snapshot <desc>    take a pre-migration snapshot (recipe-specific, dataset-GLOBAL)",
      "  rollback <name>    roll the database back to a snapshot (recipe-specific, dataset-GLOBAL —",
      "                     coordination-gated while parallel sessions are live, #428)",
      "  reset-db           drop + recreate the database volume, then start",
      "  status             list dev-stand containers",
      "  config             validate compose + secret interpolation (no up)",
      "  db-branch <N|slug> create ds_dev_<n> + migrate it; prints the DATABASE_URL to export (#428)",
      "  db-drop <N|slug>   drop the ds_dev_<n> branch database (refuses the shared ds_dev)",
    ].join("\n"),
  );
  process.exit(2);
}

// --- env -------------------------------------------------------------------

function loadEnv() {
  const candidates = [
    process.env.DS_PLATFORM_ENV_FILE,
    join(homedir(), ".ds-platform", ".env.local"),
    join(STAND_DIR, ".env.local"),
  ].filter(Boolean);
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    fail(
      `no .env.local found. Looked in:\n  ${candidates.join("\n  ")}\n` +
        "Copy infra/dev-stand/.env.example to ~/.ds-platform/.env.local and fill it in.",
    );
  }
  const env = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return { file, env };
}

// Resolve the active recipe config from .env.local. Memoised — the first
// command that needs it triggers the (possibly failing) env load.
let cfgCache = null;
function cfg() {
  if (cfgCache) return cfgCache;
  const { file: envFile, env } = loadEnv();
  const sshHost = (env.DEV_SSH_HOST || "").trim();
  const remoteDir = (env.DEV_REMOTE_DIR || "~/ds-platform-dev-stand").trim();
  // remoteDir is interpolated unquoted into a remote `rm -rf` — the leading `~`
  // must stay unquoted to expand, so it cannot be naively shell-quoted.
  // Constrain it hard instead: a `/`- or `~/`-rooted path of safe characters
  // only, no `..`, no spaces, no shell metacharacters.
  if (
    sshHost &&
    (!/^~?\/[A-Za-z0-9._/-]+$/.test(remoteDir) || remoteDir.includes(".."))
  ) {
    fail(
      'DEV_REMOTE_DIR must be a plain absolute or ~/ path — no spaces, no "..", ' +
        `no shell metacharacters: "${remoteDir}"`,
    );
  }
  const overrideFile = (
    env.DEV_COMPOSE_OVERRIDE ||
    join(homedir(), ".ds-platform", "compose.override.yml")
  ).trim();
  cfgCache = {
    sshHost,
    remoteDir,
    useSudo: /^(1|true|yes)$/i.test((env.DEV_DOCKER_SUDO || "").trim()),
    overrideFile,
    hasOverride: existsSync(overrideFile),
    pgDataset: (env.DEV_PG_DATASET || "").trim(),
    // The resolved `.env.local` path (transport + secrets) and its parsed map.
    // SSH recipe ships the file verbatim as the remote compose `.env`; host-only
    // passes the parsed map through the `docker compose` subprocess env (GH #70).
    envFile,
    serviceEnv: env,
  };
  return cfgCache;
}

// --- shell helpers ---------------------------------------------------------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) fail(`could not spawn ${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}

// Single-quote a value for a POSIX remote shell.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const composeFileFlags = () =>
  cfg().hasOverride
    ? "-f compose.core.yml -f compose.override.yml"
    : "-f compose.core.yml";

// Push infra/dev-stand/ (+ the personal override) to the remote box so the
// compose file and its bind-mounted config dirs exist on the daemon side, then
// provision the compose `.env` from the local secret source. Only `dev:up`,
// `dev:reset-db` and `dev:config` call this — the commands that (re)start or
// validate the stack. The tarball is unpacked into a staging dir and swapped in
// only once it is fully extracted, so a mid-transfer failure leaves the live dir
// (and any running container's :ro bind mounts) untouched.
//
// The tarball packs git-tracked infra/dev-stand/ only — `.env` is gitignored and
// absent there — so the swap would otherwise leave the remote with no `.env` and
// every `${SECRET}` interpolating to empty (a broken stack). We re-provision the
// `.env` from `.env.local` after the swap: docker compose auto-loads it from the
// project dir, so the same single local secret file drives the remote stack.
function syncToRemote() {
  const { sshHost, remoteDir, hasOverride, overrideFile, envFile } = cfg();
  const tar = spawnSync("tar", ["-czf", "-", "-C", STAND_DIR, "."], {
    stdio: ["inherit", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (tar.error) fail(`could not spawn tar: ${tar.error.message}`);
  if (tar.status !== 0) fail("packing infra/dev-stand/ failed");

  const stage = `${remoteDir}.stage`;
  const unpack =
    `rm -rf ${stage} && mkdir -p ${stage} && tar -xzf - -C ${stage} && ` +
    `rm -rf ${remoteDir} && mv ${stage} ${remoteDir}`;
  const push = spawnSync("ssh", [sshHost, unpack], {
    input: tar.stdout,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (push.error) fail(`could not spawn ssh: ${push.error.message}`);
  if (push.status !== 0)
    fail("syncing infra/dev-stand/ to the remote box failed");

  // Ship the local `.env.local` verbatim as the remote compose `.env`. Verbatim
  // (raw bytes, not a re-serialised parse) preserves quoting and comments, and
  // keeps the whole file — secrets, ports and transport keys — as one source of
  // truth on the trusted box. DOCKER_HOST/DEV_* keys in it are inert: compose
  // reads `.env` for interpolation only, not for the daemon connection. Write to
  // a temp then `mv` so an interrupted transfer never leaves a half-written
  // `.env` for the next `compose` to read (the bind-mount swap above is atomic
  // for the same reason).
  const envPush = spawnSync(
    "ssh",
    [
      sshHost,
      `cat > ${remoteDir}/.env.tmp && mv ${remoteDir}/.env.tmp ${remoteDir}/.env`,
    ],
    {
      input: readFileSync(envFile),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (envPush.error) fail(`could not spawn ssh: ${envPush.error.message}`);
  if (envPush.status !== 0) fail("provisioning the remote compose .env failed");

  if (hasOverride) {
    const ov = spawnSync(
      "ssh",
      [sshHost, `cat > ${remoteDir}/compose.override.yml`],
      {
        input: readFileSync(overrideFile),
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
    if (ov.status !== 0)
      fail("syncing compose.override.yml to the remote box failed");
  }
}

// Run a `docker compose <sub...>` invocation against the active recipe. The
// SSH recipe runs against the already-synced remote dir (see syncToRemote —
// only up/reset-db re-sync); if it is missing, `cd` fails with a clear error.
function compose(sub, { tty = false } = {}) {
  const { sshHost, remoteDir, useSudo, hasOverride, overrideFile, serviceEnv } =
    cfg();
  if (sshHost) {
    // Quote every arg for the remote POSIX shell — multi-word args (a psql -c
    // SQL statement, a snapshot description) must arrive as ONE argv element,
    // not be word-split by ssh's implicit shell (#428).
    const remote = `cd ${remoteDir} && ${useSudo ? "sudo " : ""}docker compose ${composeFileFlags()} ${sub.map(shq).join(" ")}`;
    return run("ssh", tty ? ["-t", sshHost, remote] : [sshHost, remote]);
  }
  const flags = hasOverride
    ? ["-f", "compose.core.yml", "-f", overrideFile]
    : ["-f", "compose.core.yml"];
  // Host-only has no remote `.env` to auto-load, so feed the parsed `.env.local`
  // through the subprocess env for compose interpolation (and a recipe-set
  // DOCKER_HOST, which here legitimately retargets the local docker client).
  // Skip blank values so a commented-out template key (e.g. DOCKER_HOST=) does
  // not clobber a real one already exported in the caller's shell.
  const composeEnv = { ...process.env };
  for (const [k, v] of Object.entries(serviceEnv))
    if (v !== "") composeEnv[k] = v;
  return run("docker", ["compose", ...flags, ...sub], {
    cwd: STAND_DIR,
    env: composeEnv,
  });
}

// Stream a recipe script to the remote box and run it with `bash -s`.
function runRecipeScript(name, scriptArgs) {
  const { sshHost, pgDataset } = cfg();
  const script = join(RECIPE_DIR, name);
  if (!existsSync(script)) fail(`recipe script missing: ${script}`);
  const quoted = scriptArgs.map(shq).join(" ");
  const envPrefix = pgDataset ? `DEV_PG_DATASET=${shq(pgDataset)} ` : "";
  const r = spawnSync("ssh", [sshHost, `${envPrefix}bash -s -- ${quoted}`], {
    input: readFileSync(script),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.error) fail(`could not spawn ssh: ${r.error.message}`);
  return r.status ?? 1;
}

// --- per-branch DB seams (#428, unit-tested in tools/lint/guard-tests) ------

/**
 * Derive the branch database name from an issue number or slug: lowercase,
 * dashes folded to underscores, must reduce to [a-z0-9_]+ — anything else is
 * refused (the value is interpolated into SQL identifiers).
 */
export function branchDbName(input) {
  const folded = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!/^[a-z0-9_]+$/.test(folded)) {
    throw new Error(
      `db-branch: "${input}" does not reduce to [a-z0-9_]+ — use the issue number or a plain slug`,
    );
  }
  // A full ds_dev_<x> name passes through (natural when copy-pasting the
  // db-branch output back into db-drop); the bare shared name "ds_dev" is NOT
  // in that shape and would derive ds_dev_ds_dev — structurally undroppable.
  return /^ds_dev_[a-z0-9_]+$/.test(folded) ? folded : `ds_dev_${folded}`;
}

/** Swap ONLY the database path of the recipe's DATABASE_URL. */
export function branchDatabaseUrl(baseUrl, dbName) {
  const url = new URL(baseUrl); // throws on garbage — intended
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Drop-safety gate: only the ds_dev_* branch namespace is droppable; the
 * shared ds_dev itself (and anything else — postgres, zitadel, …) is refused.
 */
export function assertDroppableDbName(name) {
  if (!/^ds_dev_[a-z0-9_]+$/.test(name)) {
    throw new Error(
      `db-drop: "${name}" is outside the droppable ds_dev_<branch> namespace — refusing`,
    );
  }
}

// --- commands --------------------------------------------------------------

// Run one SQL statement against a database in the stand's postgres container,
// non-interactively (`exec -T` keeps the tty out of the way on both
// transports). ON_ERROR_STOP makes psql's exit code the verdict. Identifiers
// interpolated into `sql` must come from branchDbName's [a-z0-9_]+ contract.
function psqlExec(db, sql) {
  return compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "ds",
    "-d",
    db,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

function cmdDbBranch(input) {
  if (!input) fail("usage: pnpm dev:db:branch <issue-N|slug>");
  const db = branchDbName(input);
  const baseUrl = (cfg().serviceEnv.DATABASE_URL || "").trim();
  if (!baseUrl)
    fail(
      "db-branch: DATABASE_URL is not set in your .env.local — the branch URL is derived from it.",
    );
  const url = branchDatabaseUrl(baseUrl, db);

  // Idempotent create. CREATE DATABASE supports neither transactions nor
  // IF NOT EXISTS, so let the duplicate error signal reuse: `psql` prints
  // `ERROR: database "…" already exists` and exits 1 — any OTHER error would
  // also fail the immediately-following migrate, which is the real gate.
  const create = psqlExec("postgres", `CREATE DATABASE ${db} OWNER ds`);
  if (create !== 0) {
    console.warn(
      `db-branch: CREATE DATABASE ${db} exited non-zero — "already exists" above means reuse (fine); ` +
        "anything else will fail the migrate below.",
    );
  }

  // Migrate through the sanctioned wrapper (chains the dataset-global
  // dev:snapshot first — harmless for a fresh branch DB, and keeps the
  // snapshot-before-migrate rule intact) with the branch DATABASE_URL.
  console.log(`db-branch: migrating ${db} …`);
  const mig = run("pnpm", ["--filter", "@ds/api", "run", "drizzle:migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    // Windows resolves pnpm via its .cmd shim — spawnSync needs a shell for it.
    shell: process.platform === "win32",
  });
  if (mig !== 0) fail(`db-branch: migration failed against ${db}`);

  console.log("");
  console.log("db-branch: ready. Boot this session's api with:");
  console.log(`DATABASE_URL=${url}`);
  return 0;
}

function cmdDbDrop(input) {
  if (!input) fail("usage: pnpm dev:db:drop <issue-N|slug>");
  const db = branchDbName(input);
  assertDroppableDbName(db);
  const term = psqlExec(
    "postgres",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()`,
  );
  if (term !== 0) fail(`db-drop: could not terminate connections to ${db}`);
  const drop = psqlExec("postgres", `DROP DATABASE IF EXISTS ${db}`);
  if (drop !== 0) fail(`db-drop: DROP DATABASE ${db} failed`);
  console.log(`db-drop: ${db} dropped.`);
  return 0;
}

function cmdSnapshot(desc) {
  if (!desc) fail("usage: pnpm dev:snapshot <description>");
  if (!cfg().sshHost) {
    console.warn(
      "dev:snapshot: host-only recipe has no snapshot support — skipping (setup-design §9.1).",
    );
    return 0;
  }
  return runRecipeScript("snapshot.sh", [desc]);
}

function cmdRollback(name) {
  if (!name) fail("usage: pnpm dev:rollback <snapshot-name>");
  if (!cfg().sshHost) {
    console.warn(
      "dev:rollback: host-only recipe has no snapshot support — skipping (setup-design §9.1).",
    );
    return 0;
  }
  if (compose(["stop", "postgres"]) !== 0)
    fail("could not stop postgres before rollback");
  const code = runRecipeScript("rollback.sh", [name]);
  const startCode = compose(["start", "postgres"]);
  if (startCode !== 0) {
    console.warn(
      "dev:rollback: postgres did not start cleanly after rollback — check `pnpm dev:status`.",
    );
  }
  return code || startCode;
}

function cmdUp() {
  if (cfg().sshHost) syncToRemote();
  return compose(["up", "-d"]);
}

function cmdResetDb() {
  console.warn("dev:reset-db: dropping the dev database volume.");
  if (cfg().sshHost) syncToRemote();
  compose(["down", "-v"]);
  const code = compose(["up", "-d"]);
  console.warn(
    "dev:reset-db: schema migrate + seed are wired once apps/api lands (setup-design §11 OQ-4).",
  );
  return code;
}

// Compose vars referenced without a default — `${VAR}`, not `${VAR:-x}` /
// `${VAR-x}` / `${VAR:?x}` — are the required ones. Parsed from the contract so
// the list tracks compose.core.yml automatically (no hardcoded secret names).
function requiredComposeVars() {
  const text = readFileSync(join(STAND_DIR, "compose.core.yml"), "utf8");
  const required = new Set();
  for (const m of text.matchAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)([:-]?[-?][^}]*)?\}/g,
  )) {
    if (!m[2]) required.add(m[1]); // no `:-default` / `:?err` suffix → required
  }
  return [...required];
}

// Dry-validate the resolved compose config without starting anything. Ships the
// contract + `.env` first, like `up`, so the SSH recipe validates the real
// remote inputs. `config --quiet` catches schema and `${VAR}` *syntax* errors —
// but docker compose substitutes a *blank* for a missing/empty required var and
// still exits 0, so a secretless stack would pass it. We assert the required
// vars resolve non-empty up front to catch exactly the empty-secret failure this
// command exists to surface (#70: empty POSTGRES_PASSWORD / IDP_SECRET_KEY).
function cmdConfig() {
  const { sshHost, serviceEnv } = cfg();
  const missing = requiredComposeVars().filter(
    (k) => !(serviceEnv[k] || "").trim(),
  );
  if (missing.length)
    fail(
      `compose .env is missing required value(s): ${missing.join(", ")} — ` +
        "fill them in your .env.local (see infra/dev-stand/.env.example).",
    );
  if (sshHost) syncToRemote();
  const code = compose(["config", "--quiet"]);
  if (code === 0)
    console.log(
      "dev:config: compose config valid — required variables resolved.",
    );
  return code;
}

function dispatch(cmd, rest) {
  switch (cmd) {
    case "up":
      return cmdUp();
    case "down":
      return compose(["down"]);
    case "status":
      return compose(["ps"]);
    case "logs":
      return compose(["logs", "-f", ...rest]);
    case "restart":
      return compose(["restart", ...rest]);
    case "psql":
      return compose(
        ["exec", "postgres", "psql", "-U", "ds", "-d", rest[0] || "ds_dev"],
        { tty: true },
      );
    case "snapshot":
      return cmdSnapshot(rest[0]);
    case "rollback":
      return cmdRollback(rest[0]);
    case "reset-db":
      return cmdResetDb();
    case "config":
      return cmdConfig();
    case "db-branch":
      return cmdDbBranch(rest[0]);
    case "db-drop":
      return cmdDbDrop(rest[0]);
    default:
      return usage();
  }
}

// Run only as the entry point — the #428 pure seams (branchDbName,
// branchDatabaseUrl, assertDroppableDbName) are importable from the guard-test
// harness without firing the CLI (mirrors task-worktree.mjs / pr-preflight.mjs).
const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || !COMMANDS.includes(cmd)) usage();
  process.exit(dispatch(cmd, rest));
}
