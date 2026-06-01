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
      "  psql               open a psql shell on the dev database",
      "  snapshot <desc>    take a pre-migration snapshot (recipe-specific)",
      "  rollback <name>    roll the database back to a snapshot (recipe-specific)",
      "  reset-db           drop + recreate the database volume, then start",
      "  status             list dev-stand containers",
      "  config             validate compose + secret interpolation (no up)",
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
    const remote = `cd ${remoteDir} && ${useSudo ? "sudo " : ""}docker compose ${composeFileFlags()} ${sub.join(" ")}`;
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

// --- commands --------------------------------------------------------------

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
      return compose(["exec", "postgres", "psql", "-U", "ds", "-d", "ds_dev"], {
        tty: true,
      });
    case "snapshot":
      return cmdSnapshot(rest[0]);
    case "rollback":
      return cmdRollback(rest[0]);
    case "reset-db":
      return cmdResetDb();
    case "config":
      return cmdConfig();
    default:
      return usage();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !COMMANDS.includes(cmd)) usage();
process.exit(dispatch(cmd, rest));
