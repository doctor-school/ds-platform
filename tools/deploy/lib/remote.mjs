// tools/deploy/lib/remote.mjs — the SSH + ship-a-committed-tree primitives that
// drive a box from an operator's machine.
//
// Lifted VERBATIM out of `tools/deploy/prod.mjs` (Issue #2194): production was
// the only caller until the staging slot delivery adopted the same shape (tech
// spec 2026-09-08-staging-previews-and-regression-contour-en.md §3 «Host
// runtime» / §5 step 1). `prod.mjs` imports every symbol from here and
// re-exports the ones it used to define, so its importers — the guard tests
// `tools/lint/guard-tests/deploy-stall.spec.ts` and
// `tools/lint/guard-tests/deploy-ship-tree.spec.ts` — keep working untouched.
//
// The only generalization is parameterization, never behaviour: `shipTreeCommand`
// and `shipTree` take the live directory and the preserved-file list as options
// whose DEFAULTS are production's exact values, so the default call renders the
// byte-identical remote script it rendered before the move.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// Prod health endpoint — the verify-over-HTTP pointer of the stall message
// (#942/#927). `tools/deploy/prod.mjs` re-exports it: the status record's
// `log_url` and the printed hint must agree, so it is defined once.
export const PROD_HEALTH_URL = "https://api.doctor.school/v1/health";

// Keepalive on EVERY ssh channel (#905). Without these flags a half-open TCP
// connection (NAT table flush, Wi-Fi/VPN flap, box-side reset the client never
// saw) hangs the deploy silently forever — the local process just waits on a
// socket nobody will ever write to. With them the client probes the server
// every 15s and gives up after 4 missed probes (~60s): the channel dies LOUDLY
// (non-zero ssh exit → the existing die() path) instead of hanging half-open.
// `extraOptions` are per-call `-o` flags (a read-only probe wants a short
// ConnectTimeout and BatchMode; a deploy deliberately does not).
export function sshBaseArgs(host, extraOptions = []) {
  return [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    ...(HOP_OPTIONS.get(host) ?? []),
    ...extraOptions,
    host,
  ];
}

// #3157: the VPC hop of the prod release driver. A run ON ds-api-prod (`prod.mjs
// --local`) reaches ds-data-prod as `deploy@<data-prod VPC IP>` with the dedicated key
// `/home/deploy/.ssh/data-prod-hop` — the hop the operator's `ds-data-prod` alias
// takes through its ProxyJump, so data-prod keeps no public ssh and no CI key (tech
// spec 2026-10-16 release pipeline §4, §5 «Prod release driver»). The key is
// deploy-owned 0600 beside deploy's `known_hosts` (which pins data-prod): the driver
// unit runs as `deploy`, and `/etc/ds-platform` is root-only 0700. The destination
// carries its own identity flags on every channel `sshBaseArgs` opens to it.
export const DATA_PROD_HOP_KEY = "/home/deploy/.ssh/data-prod-hop";
const HOP_OPTIONS = new Map();

/**
 * The ssh destination `<user>@<address>` reached with `identityFile` only: no agent,
 * no other key, no password prompt, and a host key that must already be known (fail
 * closed — the box's `known_hosts` entry is provisioned with the key).
 */
export function hopDestination({ user, address, identityFile }) {
  const destination = `${user}@${address}`;
  HOP_OPTIONS.set(destination, [
    "-i",
    identityFile,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
  ]);
  return destination;
}

// Per-step no-output budgets for the sshScript inactivity watchdog (#905).
// Long-silence steps legitimately go minutes between log lines: the api-prod image
// pull (#2981 — `docker pull` of each recorded digest, a multi-hundred-MB layer
// download prints nothing until it completes), the data-prod `up -d --build`, the
// migrate/up swap, the IdP converge and the stage slot builds. Everything else
// (pgbackrest, caddy reload, retention) prints within seconds when healthy.
export const STALL_BUDGET_BUILD_MS = 5 * 60 * 1000;
export const STALL_BUDGET_DEFAULT_MS = 2 * 60 * 1000;

// The loud STALLED line. A tripped watchdog proves only that the LOCAL channel
// went quiet — the remote docker/pgbackrest work may have completed (or still
// be running), so the message routes the operator to the box-reality probe
// before any re-run / rollback decision.
// The default probe hint of a stalled PRODUCTION step. A slot passes its own
// (`tools/staging/slot.mjs`): the box-reality probe of a staging slot is not
// `pnpm deploy:probe` and its health URL is not production's.
export function defaultProbeHint(host) {
  return (
    `  Verify by hand: pnpm deploy:probe\n` +
    `  (or: curl -fsS ${PROD_HEALTH_URL} ; ssh ${host} docker ps)`
  );
}

export function formatStallMessage(
  label,
  budgetMs,
  host,
  probeHint = defaultProbeHint(host),
) {
  const mins = budgetMs / 60000;
  const n = Number.isInteger(mins) ? String(mins) : mins.toFixed(1);
  return (
    `STALLED: ${label} — no output for ${n}m; remote work MAY have completed.\n` +
    `${probeHint}`
  );
}

// Inactivity watchdog: arms on creation, `touch()` on every data chunk resets
// the timer, `stop()` disarms for good (close/error paths). Fires `onStall`
// with the formatted STALLED message at most once. Pure timer logic — unit
// tested on fake timers (tools/lint/guard-tests/deploy-stall.spec.ts).
export function createStallWatchdog({
  label,
  budgetMs,
  host,
  probeHint,
  onStall,
}) {
  let timer = null;
  let done = false;
  const arm = () => {
    timer = setTimeout(() => {
      done = true;
      timer = null;
      onStall(formatStallMessage(label, budgetMs, host, probeHint));
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

// #2985: the box-local executor. A run ON the box (the stage release driver,
// `infra/deploy/bin/release-driver`) addresses the box as this host: `boxSpawnArgs`
// then runs the very command an ssh session would hand the box's login shell —
// `REMOTE_BASH` for a script, `shipTreeCommand` for a ship — through a local
// `bash -c`, with the same stdin, quoting and watchdog. Nothing above the transport
// knows the difference: the plan, its steps and its ds-release units are the same.
// (`local` is not an ssh destination this repository uses; `DS_STAGE_SSH` names one.)
export const LOCAL_EXECUTOR = "local";

/** `[command, argv]` that hand `remoteCommand` to the box's shell — over ssh, or locally. */
export function boxSpawnArgs(host, remoteCommand, extraOptions = []) {
  if (host === LOCAL_EXECUTOR) return ["bash", ["-c", remoteCommand]];
  return ["ssh", [...sshBaseArgs(host, extraOptions), remoteCommand]];
}

// Inactivity watchdog (#905): stdout/stderr are PIPED (not inherited) so the
// parent observes every remote byte — chunks are forwarded verbatim to the
// local streams (same live-streaming UX as before) and each one resets the
// per-step no-output timer. A step whose channel goes quiet past its budget is
// killed and the deploy exits non-zero with the loud STALLED message — it
// never hangs silently again. Callers pass `stallBudgetMs` per step
// (build-class → STALL_BUDGET_BUILD_MS, default → STALL_BUDGET_DEFAULT_MS).
export function sshScript(
  host,
  script,
  { label, stallBudgetMs, probeHint } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(...boxSpawnArgs(host, REMOTE_BASH), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stalled = false;
    const watchdog = createStallWatchdog({
      label: label || "ssh",
      budgetMs: stallBudgetMs ?? STALL_BUDGET_DEFAULT_MS,
      host,
      probeHint,
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
//
// `options` is opt-in and defaults to the historical behaviour:
//   `sshOptions` - extra `-o` flags for this call only;
//   `signal`     - an AbortSignal that KILLS the child (a caller-side timeout
//                  that only stops waiting leaves a live ssh holding the event
//                  loop open, which is what hung the SessionStart hook, #2233);
//   `stderr`     - "inherit" (default) or "pipe", which folds ssh's own
//                  diagnostics into the rejection instead of the caller's tty.
export function sshCapture(host, script, options = {}) {
  const { sshOptions = [], signal, stderr = "inherit" } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(...boxSpawnArgs(host, REMOTE_BASH, sshOptions), {
      stdio: ["pipe", "pipe", stderr],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));

    let killed = false;
    const onAbort = () => {
      killed = true;
      child.kill();
      // SIGTERM can be ignored by a child stuck in connect(); escalate.
      const hard = setTimeout(() => child.kill("SIGKILL"), 2000);
      hard.unref?.();
      reject(new Error(`ssh capture on ${host} aborted`));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const done = () => signal?.removeEventListener("abort", onAbort);
    child.on("error", (e) => {
      done();
      reject(e);
    });
    child.on("close", (code) => {
      done();
      if (killed) return;
      if (code === 0) return resolve(out.trim());
      const detail = err.trim().split(/\r?\n/)[0];
      reject(
        new Error(
          `ssh capture on ${host} exited ${code}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

// Ship the committed tree to a box through a sibling staging directory. The
// committed archive is extracted completely before the live tree is swapped,
// carrying forward only the documented per-deployment interpolation files.
// Streams are piped in-process (Windows-safe - no shell pipe / redirection).
//
// `liveDir` and `preserved` are parameters whose DEFAULTS are production's own
// values (#2194): the default call renders the byte-identical script it
// rendered before this module existed, while a staging slot ships into
// `$HOME/ds-platform.slots/<slot>` and preserves nothing - its compose
// interpolation comes from `/etc/ds-platform/*.env`, never from a file inside
// the tree (tech spec 2026-09-08 staging contour, SS3 "Host runtime").
//
// `preserved` entries are repo-relative paths carried forward from the previous
// tree; an empty list renders no preserve section at all.
export function shipTreeCommand({
  liveDir = "$HOME/ds-platform",
  preserved = ["infra/deploy/compose/api-prod/.env"],
} = {}) {
  const varName = (i) => (i === 0 ? "preserved_rel" : `preserved_rel_${i}`);
  const preservedDecls = preserved
    .map((rel, i) => `${varName(i)}="${rel}"\n`)
    .join("");
  const preservedCopies = preserved
    .map((rel, i) => {
      const v = varName(i);
      // A repo-root-level preserved path has no directory of its own: emit no
      // `mkdir` for it rather than a truncated one ("x.env".lastIndexOf("/") is
      // -1). `$stage` itself is created by the caller before this runs.
      const slash = rel.lastIndexOf("/");
      const dir = slash === -1 ? "" : rel.slice(0, slash);
      return (
        `if [ -f "$live/$${v}" ]; then\n` +
        (dir ? `  mkdir -p "$stage/${dir}"\n` : "") +
        `  cp -p "$live/$${v}" "$stage/$${v}"\n` +
        `fi\n`
      );
    })
    .join("");
  // The live tree of a slot sits one level below $HOME; its parent must exist
  // before the swap `mv`. Production ships straight into $HOME, so the default
  // call emits nothing here and keeps the script byte-identical.
  const ensureParent = liveDir.replace(/^\$HOME\//, "").includes("/")
    ? 'mkdir -p "$(dirname "$live")"\n'
    : "";
  return `set -eu
live="${liveDir}"
work=$(mktemp -d "$HOME/ds-platform.ship.XXXXXX")
stage="$work/stage"
previous="$work/previous"
${preservedDecls}swapping=0
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

${ensureParent}mkdir -p "$stage"
tar xzf - --strip-components=1 -C "$stage"
${preservedCopies}
if [ -e "$live" ]; then
  swapping=1
  mv "$live" "$previous"
fi
mv "$stage" "$live"
swapping=0
rm -rf "$work"
trap - EXIT HUP INT TERM`;
}

/**
 * `git archive` of a committed SHA, piped into {@link shipTreeCommand} over ssh.
 *
 * `tmpPrefix` names the LOCAL temp tarball: two slots of the same operator
 * machine may be shipped at the same SHA, and one shared temp name would have
 * them overwrite each other mid-stream.
 *
 * #2985: on the {@link LOCAL_EXECUTOR} there is no checkout to `git archive` — the
 * release driver runs from the codeload tarball of the SHA, extracted into
 * `sourceDir` — so the archive is a `tar` of that directory (one top-level
 * directory, stripped by the same `--strip-components=1`) and the same
 * `shipTreeCommand` installs it. codeload and `git archive` both honour
 * `export-ignore`, so both carry the same files. #3157: a box-local run ships that
 * same `sourceDir` over its VPC hop too (`prod.mjs --local` → ds-data-prod), so the
 * tar is chosen by `sourceDir`, not by the destination.
 */
export async function shipTree(
  sha,
  host,
  { liveDir, preserved, tmpPrefix = "ds-deploy", sourceDir } = {},
) {
  const tmp = join(tmpdir(), `${tmpPrefix}-${sha.slice(0, 12)}.tar.gz`);
  if (host === LOCAL_EXECUTOR && !sourceDir) {
    throw new Error("a local ship needs the tree directory it ships");
  }
  await new Promise((resolve, reject) => {
    const out = createWriteStream(tmp);
    const [command, argv] = sourceDir
      ? ["tar", ["czf", "-", "-C", dirname(sourceDir), basename(sourceDir)]]
      : ["git", ["archive", "--format=tar.gz", "--prefix=ds-platform/", sha]];
    const archiver = spawn(command, argv);
    archiver.stdout.pipe(out);
    archiver.on("error", reject);
    archiver.on("close", (c) =>
      c === 0 ? resolve() : reject(new Error(`${command} ${argv[0]} exited ${c}`)),
    );
  });
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(...boxSpawnArgs(host, shipTreeCommand({ liveDir, preserved })), {
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

// --- durable box steps (Issue #2982; tech spec 2026-10-16 release pipeline §5) ---
//
// A long box step is never streamed over ssh: killing a streamed client kills the
// remote command within ~2 s. `/usr/local/bin/ds-release` runs each step in its own
// transient systemd unit (`ds-<env>-<sha12>-<step>`); the operator starts or
// attaches to it, then polls the box's status file, printing one status line per
// poll. The full step log stays in the unit's journal on the box.

export const DS_RELEASE_BIN = "/usr/local/bin/ds-release";
// #2984: the forced command of every CI key, installed beside ds-release by the
// same install step (its allowlisted verbs call ds-release).
export const DS_DEPLOY_ENTRYPOINT_BIN = "/usr/local/bin/ds-deploy-entrypoint";
// #2985: the box-side release driver the entrypoint's `release` verb execs.
export const RELEASE_DRIVER_BIN = "/usr/local/lib/ds-platform/release-driver";
/** Box binary → its path in the repository tree, in install order. */
export const BOX_ENTRYPOINTS = [
  { dest: DS_RELEASE_BIN, path: "infra/deploy/bin/ds-release" },
  { dest: DS_DEPLOY_ENTRYPOINT_BIN, path: "infra/deploy/bin/ds-deploy-entrypoint" },
  { dest: RELEASE_DRIVER_BIN, path: "infra/deploy/bin/release-driver" },
];
export const RELEASE_STATE_ROOT = "/var/lib/ds-platform/release";
export const RELEASE_POLL_MS = 10 * 1000;
export const RELEASE_POLL_MAX_FAILURES = 6;
export const RELEASE_POLL_MAX_LOST = 3;
export const RELEASE_STEP_TIMEOUT_MS = 60 * 60 * 1000;

const RELEASE_ENV_RE = /^(prod|stage-main|stage-pr-[1-9][0-9]*)$/;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const RELEASE_STEP_RE = /^[a-z][a-z0-9-]{0,31}$/;

function assertRelease(env, sha, step) {
  if (!RELEASE_ENV_RE.test(String(env))) {
    throw new Error(`ds-release env must be prod, stage-main or stage-pr-<N>, not ${JSON.stringify(env)}`);
  }
  if (!RELEASE_SHA_RE.test(String(sha))) {
    throw new Error(`ds-release sha must be the full 40-hex commit id, not ${JSON.stringify(sha)}`);
  }
  if (step !== undefined && !RELEASE_STEP_RE.test(String(step))) {
    throw new Error(`ds-release step name is unusable: ${JSON.stringify(step)}`);
  }
}

export function releaseUnitName(env, sha, step) {
  assertRelease(env, sha, step);
  return `ds-${env}-${sha.slice(0, 12)}-${step}`;
}

/**
 * Install the box entrypoints (ds-release, ds-deploy-entrypoint, release-driver) from
 * the tree just shipped to the box. Prod installs on every run (it ships only `main` /
 * `hotfix/*`); on ds-stage-1 only the `main` converge of a SHA contained in `main`
 * does (#3125, `tools/staging/slot.mjs`).
 */
export function releaseInstallScript(liveDir = "$HOME/ds-platform") {
  return [
    ...installDirLines(BOX_ENTRYPOINTS.map(({ dest }) => dest)),
    ...BOX_ENTRYPOINTS.map(({ dest, path }) => `sudo install -m 0755 "${liveDir}/${path}" ${dest}`),
  ].join("\n");
}

// A binary outside /usr/local/bin (the release driver, #2985) needs its directory
// first; /usr/local/bin exists on every box and gets no line.
function installDirLines(dests) {
  const dirs = [...new Set(dests.map((dest) => dest.slice(0, dest.lastIndexOf("/"))))];
  return dirs
    .filter((dir) => dir !== "/usr/local/bin")
    .map((dir) => `sudo install -d -m 0755 -o root -g root ${dir}`);
}

/**
 * Install the box entrypoints from bytes the operator holds, for a run that ships
 * no tree (`--rollback`, #3054). `sources` is `[{ source, dest }]` (a bare Buffer
 * means ds-release alone). The bytes travel base64-encoded in quoted heredocs — the
 * base64 alphabet cannot form a delimiter — and every file is checked against its
 * sha256 before `install` touches any binary, so a damaged transfer refuses instead
 * of installing a broken entrypoint.
 */
export function releaseInstallFromSourceScript(sources) {
  const files = Buffer.isBuffer(sources) ? [{ source: sources, dest: DS_RELEASE_BIN }] : sources;
  if (!Array.isArray(files) || files.length === 0) throw new Error("no entrypoint source to install");
  const lines = [];
  const vars = files.map((_, i) => `f${i}`);
  lines.push(...vars.map((v) => `${v}=$(mktemp)`));
  lines.push(`trap 'rm -f ${vars.map((v) => `"$${v}"`).join(" ")}' EXIT`);
  files.forEach(({ source, dest }, i) => {
    const bytes = Buffer.from(source);
    if (bytes.length === 0) throw new Error(`${dest} source is empty`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    lines.push(
      `base64 -d > "$${vars[i]}" <<'DS_RELEASE_B64'`,
      ...bytes.toString("base64").match(/.{1,76}/g),
      "DS_RELEASE_B64",
      `printf '%s  %s\\n' ${sha256} "$${vars[i]}" | sha256sum -c --status - ||` +
        ` { echo "${dest} install: checksum mismatch, nothing installed" >&2; exit 1; }`,
    );
  });
  lines.push(...installDirLines(files.map(({ dest }) => dest)));
  files.forEach(({ dest }, i) => lines.push(`sudo install -m 0755 "$${vars[i]}" ${dest}`));
  return lines.join("\n");
}

/**
 * Start (or attach to) one step. The step script reaches the box inside a quoted
 * heredoc — no expansion, its delimiter derived from the script itself — and
 * `ds-release` copies it root-only before the unit runs it.
 */
export function releaseStartScript({ env, sha, step, script, retryFailed = false }) {
  assertRelease(env, sha, step);
  const retry = retryFailed ? " --retry-failed" : "";
  return withScriptFile(script, `sudo ${DS_RELEASE_BIN} release${retry} ${env} ${sha} ${step} "$f"`);
}

function withScriptFile(script, command) {
  const body = script.endsWith("\n") ? script : `${script}\n`;
  const delimiter = `DS_RELEASE_STEP_${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
  return [
    'f=$(mktemp)',
    `trap 'rm -f "$f"' EXIT`,
    `cat > "$f" <<'${delimiter}'`,
    `${body}${delimiter}`,
    command,
  ].join("\n");
}

/** Read-only: refuses (exit 3, naming the unit) while any step unit of `env` runs. */
export function releaseCheckScript(env) {
  assertRelease(env, "0".repeat(40));
  return `sudo ${DS_RELEASE_BIN} check ${env}`;
}

/**
 * Supersede every recorded attempt of `env` under its lock — refused while a step
 * unit still runs — then run `script` (streamed) still holding the lock. The
 * app-only rollback's `up -d` goes through it, so a later release of the SHA rolled
 * off starts a fresh attempt instead of answering from stale verdicts.
 */
export function releaseSupersedeScript(env, script) {
  assertRelease(env, "0".repeat(40));
  const command = `sudo ${DS_RELEASE_BIN} supersede ${env}`;
  return script === undefined ? command : withScriptFile(script, `${command} "$f"`);
}

/**
 * Read-only and lock-free (the file is replaced atomically). Through sudo all the
 * same: a box's /var/lib/ds-platform may be root-only (ds-stage-1 keeps its e2e
 * reports there), and the read must not depend on a parent directory's mode.
 */
export function releaseStatusScript(env, sha) {
  assertRelease(env, sha);
  return `sudo ${DS_RELEASE_BIN} status ${env} ${sha}`;
}

export function releaseFinishArgv(env, sha, state) {
  assertRelease(env, sha);
  if (state !== "succeeded" && state !== "failed") {
    throw new Error(`a release finishes succeeded or failed, not ${JSON.stringify(state)}`);
  }
  return ["sudo", DS_RELEASE_BIN, "finish", env, sha, state];
}

export function releaseFinishScript(env, sha, state) {
  return releaseFinishArgv(env, sha, state).join(" ");
}

/** The env's status-file directory on the box. */
export function releaseStateDir(env) {
  assertRelease(env, "0".repeat(40));
  return `${RELEASE_STATE_ROOT}/${env}`;
}

export function releaseForgetArgv(env) {
  assertRelease(env, "0".repeat(40));
  return ["sudo", DS_RELEASE_BIN, "forget", env];
}

/** `{ release, unitAlive }` from one `ds-release status` line. */
export function parseReleaseStatus(stdout) {
  const parsed = JSON.parse(String(stdout).trim());
  if (!parsed || typeof parsed !== "object" || !("release" in parsed)) {
    throw new Error(`unreadable ds-release status: ${String(stdout).slice(0, 200)}`);
  }
  return parsed;
}

/**
 * The poller's decision for one step: `absent` (no record), `running`, `lost` (still
 * marked running but its unit is gone — `release` settles it as failed),
 * `succeeded` or `failed`.
 */
export function releaseStepVerdict(status, step) {
  const release = status?.release ?? null;
  const entry = [...(release?.steps ?? [])].reverse().find((s) => s.name === step);
  if (!entry) return { state: "absent", unit: undefined, rc: null, error: null };
  const base = { unit: entry.unit, rc: entry.rc ?? null, error: release.error ?? null };
  if (entry.endedAt == null) {
    return { ...base, state: status.unitAlive === false ? "lost" : "running" };
  }
  return { ...base, state: entry.rc === 0 ? "succeeded" : "failed" };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastLine = (text) => String(text).trim().split(/\r?\n/).at(-1);

/**
 * Run one long box step durably: start or attach through `ds-release release`, then
 * poll `ds-release status`, one status line per poll. A succeeded step resolves
 * (also when a re-run finds it already recorded — it is never repeated); a failed or
 * lost one rejects with the journal pointer. Losing the box, or the deadline, ends
 * only the WAIT: the unit keeps running and a re-run of the same SHA reattaches.
 */
export async function runDurableStep(
  host,
  {
    env,
    sha,
    step,
    script,
    label = step,
    retryFailed = false,
    capture = sshCapture,
    sleep = delay,
    log = (line) => console.log(line),
    pollMs = RELEASE_POLL_MS,
    timeoutMs = RELEASE_STEP_TIMEOUT_MS,
    maxPollFailures = RELEASE_POLL_MAX_FAILURES,
    maxLostReads = RELEASE_POLL_MAX_LOST,
    now = Date.now,
  },
) {
  const unit = releaseUnitName(env, sha, step);
  const start = () =>
    capture(host, releaseStartScript({ env, sha, step, script, retryFailed }), { stderr: "pipe" });
  let started;
  try {
    started = await start();
  } catch (error) {
    throw new Error(`${label}: ds-release on ${host} did not run ${unit}: ${error.message}`, {
      cause: error,
    });
  }
  const answer = lastLine(started);
  log(`  ↳ ${host}: ${answer}`);
  // A verdict the box already recorded for this attempt needs no poll.
  if (answer.endsWith(`${unit} succeeded (recorded verdict; not re-run)`)) {
    return { state: "succeeded", unit, rc: 0, error: null };
  }
  const reattach = `re-run the same SHA to reattach (box status: ${releaseStatusScript(env, sha)})`;
  const t0 = now();
  let failures = 0;
  let lostReads = 0;
  for (;;) {
    await sleep(pollMs);
    const elapsed = Math.round((now() - t0) / 1000);
    let status;
    try {
      status = parseReleaseStatus(
        await capture(host, releaseStatusScript(env, sha), {
          sshOptions: ["-o", "ConnectTimeout=15"],
          stderr: "pipe",
        }),
      );
      failures = 0;
    } catch (error) {
      // The box answered: its record is unreadable. Not lost contact, not transient.
      const corrupt = error.message.indexOf("ds-release: corrupt status file");
      if (corrupt >= 0) {
        throw new Error(`${label}: ${host}: ${error.message.slice(corrupt)}`, { cause: error });
      }
      failures += 1;
      log(`  ⋯ ${host} ${unit} poll failed (${failures}/${maxPollFailures}): ${error.message}`);
      if (failures >= maxPollFailures) {
        throw new Error(
          `${label}: lost contact with ${host} while polling ${unit}. The unit still runs on the box; ${reattach}`,
          { cause: error },
        );
      }
      continue;
    }
    const verdict = releaseStepVerdict(status, step);
    log(`  ⋯ ${host} ${unit} ${verdict.state} ${elapsed}s`);
    if (verdict.state === "succeeded") return verdict;
    if (verdict.state === "failed") {
      throw new Error(
        `${label}: ${unit} on ${host} failed (rc ${verdict.rc}${verdict.error ? `: ${verdict.error}` : ""}). ` +
          `Full log on the box: sudo journalctl -u ${unit}`,
      );
    }
    if (verdict.state !== "lost") lostReads = 0;
    if (verdict.state === "lost") {
      // A `systemctl show` hiccup on the box reads as «lost»: only N in a row count.
      lostReads += 1;
      if (lostReads < maxLostReads) continue;
      // `release` settles a dead unit's step as failed under the env lock — or
      // answers that it still runs, and then the unit is left running.
      let detail;
      try {
        detail = lastLine(await start());
      } catch (error) {
        detail = error.message;
      }
      if (detail.endsWith("running (attached)")) {
        throw new Error(
          `${label}: ${unit} on ${host} read as lost ${lostReads} times, but the box reports it running; it is left running; ${reattach}`,
        );
      }
      throw new Error(
        `${label}: ${unit} on ${host} ended without a verdict (${detail}). Full log on the box: sudo journalctl -u ${unit}`,
      );
    }
    if (verdict.state === "absent") {
      throw new Error(`${label}: ${host} holds no record of ${unit} after starting it`);
    }
    if (now() - t0 >= timeoutMs) {
      throw new Error(`${label}: ${unit} on ${host} is still running after ${elapsed}s and is left running; ${reattach}`);
    }
  }
}
