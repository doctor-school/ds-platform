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
// whose DEFAULTS are production's values (the fixed live tree PROD_LIVE_TREE, #2987).

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
// deploy-owned 0600 beside deploy's `known_hosts` (which pins data-prod) and is named
// with it on every hop, whichever user the driver unit runs as (root on ds-api-prod,
// #2987). The destination
// carries its own identity flags on every channel `sshBaseArgs` opens to it.
export const DATA_PROD_HOP_KEY = "/home/deploy/.ssh/data-prod-hop";  // no-hardcoded-path-ok: a fixed path on the prod box (deploy's home), not on this machine
// #2987: on ds-api-prod the driver unit runs as root (spec §4 «sudo on prod»), whose
// own known_hosts does not pin data-prod; the hop names deploy's file explicitly.
export const DATA_PROD_HOP_KNOWN_HOSTS = "/home/deploy/.ssh/known_hosts";  // no-hardcoded-path-ok: a fixed path on the prod box (deploy's home), not on this machine
const HOP_OPTIONS = new Map();

/**
 * The ssh destination `<user>@<address>` reached with `identityFile` only: no agent,
 * no other key, no password prompt, and a host key that must already be known (fail
 * closed — the box's `known_hosts` entry is provisioned with the key).
 */
export function hopDestination({ user, address, identityFile, knownHostsFile }) {
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
    ...(knownHostsFile ? ["-o", `UserKnownHostsFile=${knownHostsFile}`] : []),
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
// The remote command DRAINS the whole script into a temp file first
// (`cat >"$f"`) and only then executes it. Never use a bare `bash -s`
// here: bash -s reads the script from stdin INCREMENTALLY, so any command
// that itself reads stdin — `docker compose run` attaches the container's
// stdin by default — silently EATS the rest of the script and bash exits 0
// at EOF. That exact failure skipped the `build` + `up -d` lines after the
// migrate step and made every deploy a silent no-op (DSO-127 rework: prod
// kept running :local while the script reported "DEPLOY OK").
// --norc: with stdin on the ssh channel, bash's remote-shell heuristic would
// source /etc/bash.bashrc (PS1 unbound under -u → stderr noise); inhibit it.
// #3338: the script runs from a file, never as one `-c` argument — Linux caps a single
// argv string at 128 KiB (MAX_ARG_STRLEN), and the workstation `--rollback` from-source
// install of every BOX_ENTRYPOINT to ds-api-prod is larger (E2BIG before a line ran).
// mktemp makes the file user-only; no `exec`, so the EXIT trap removes it, and the shell exits with bash's rc.
const drained = (bash) => `f=$(mktemp) && trap 'rm -f "$f"' EXIT && cat >"$f" && ${bash} --norc -euo pipefail "$f"`;
const REMOTE_BASH = drained("bash");

// #2987: the same command run as root — the script still drained first, then handed
// whole to `sudo -n bash`. The break-glass operator `breakglass` reaches ds-api-prod
// as itself, and the live tree there (PROD_LIVE_TREE) is root's; every script it
// sends that box goes through this form (`asRoot` on sshScript / sshCapture).
const REMOTE_BASH_ROOT = drained("sudo -n bash");

/** The command a box's shell is handed for a stdin-fed script: as the user, or as root. */
export function remoteBash({ asRoot = false } = {}) {
  return asRoot ? REMOTE_BASH_ROOT : REMOTE_BASH;
}

// #2985: the box-local executor. A run ON the box (the stage release driver,
// `infra/deploy/bin/release-driver`) addresses the box as this host: `boxSpawnArgs`
// then runs the very command an ssh session would hand the box's login shell —
// `REMOTE_BASH` for a script, `shipTreeCommand` for a ship — through a local
// `bash -c`, with the same stdin, quoting and watchdog. Nothing above the transport
// knows the difference: the plan, its steps and its ds-release units are the same.
// (`local` is not an ssh destination this repository uses; `DS_STAGE_SSH` names one.)
export const LOCAL_EXECUTOR = "local";

// #2987: production's live tree on both prod boxes — a fixed path, never `~` or
// `$HOME`: the root release unit (HOME=/root) and the break-glass operator
// `breakglass` (its own home) address the tree deploy's runs always used, with
// `compose/api-prod/.env` carried forward inside it.
export const PROD_LIVE_TREE = "/home/deploy/ds-platform"; // no-hardcoded-path-ok: a fixed path on the prod boxes, not on this machine

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
  { label, stallBudgetMs, probeHint, asRoot = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(...boxSpawnArgs(host, remoteBash({ asRoot })), {
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
//                  diagnostics into the rejection instead of the caller's tty;
//   `asRoot`     - run the script as root (`remoteBash`, #2987).
export function sshCapture(host, script, options = {}) {
  const { sshOptions = [], signal, stderr = "inherit", asRoot = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(...boxSpawnArgs(host, remoteBash({ asRoot }), sshOptions), {
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
// values (#2194): production ships into the fixed PROD_LIVE_TREE, while a staging
// slot ships into `$HOME/ds-platform.slots/<slot>` and preserves nothing - its
// compose interpolation comes from `/etc/ds-platform/*.env`, never from a file
// inside the tree (tech spec 2026-09-08 staging contour, SS3 "Host runtime").
//
// `preserved` entries are repo-relative paths carried forward from the previous
// tree; an empty list renders no preserve section at all.
//
// `asRoot` (#2987, ds-api-prod) runs the whole script under `sudo -n bash -c`: the
// tree there is written by the root release unit or by the break-glass operator
// `breakglass`, neither of which owns deploy's home. The staging directory of an
// absolute `liveDir` is its sibling, so the swap is a rename on one filesystem
// whatever `$HOME` the writer has.
export function shipTreeCommand({
  liveDir = PROD_LIVE_TREE,
  preserved = ["infra/deploy/compose/api-prod/.env"],
  asRoot = false,
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
  // before the swap `mv`. Production's fixed tree sits in deploy's existing home,
  // so it emits nothing here.
  const homeRelative = liveDir.startsWith("$HOME/");
  const ensureParent =
    homeRelative && liveDir.slice("$HOME/".length).includes("/")
      ? 'mkdir -p "$(dirname "$live")"\n'
      : "";
  const workParent = homeRelative ? "$HOME" : liveDir.slice(0, liveDir.lastIndexOf("/"));
  const script = `set -eu
live="${liveDir}"
work=$(mktemp -d "${workParent}/ds-platform.ship.XXXXXX")
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
  return asRoot ? `sudo -n bash -c ${shellQuote(script)}` : script;
}

function shellQuote(s) {
  return `'${s.replaceAll("'", `'\\''`)}'`;
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
  { liveDir, preserved, asRoot, tmpPrefix = "ds-deploy", sourceDir, remoteCommand } = {},
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
      // #3313: ds-data-prod takes the archive through its `ship <sha>` verb instead.
      const command = remoteCommand ?? shipTreeCommand({ liveDir, preserved, asRoot });
      const child = spawn(...boxSpawnArgs(host, command), {
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
export const POSTGRES_PROBE_BIN = "/usr/local/lib/ds-platform/postgres-artifact-probe.py";
export const HARDEN_SSH_BIN = "/usr/local/lib/ds-platform/harden-ssh.sh";
/** Box binary → its path in the repository tree, in install order. */
export const BOX_ENTRYPOINTS = [
  { dest: DS_RELEASE_BIN, path: "infra/deploy/bin/ds-release" },
  { dest: DS_DEPLOY_ENTRYPOINT_BIN, path: "infra/deploy/bin/ds-deploy-entrypoint" },
  { dest: RELEASE_DRIVER_BIN, path: "infra/deploy/bin/release-driver" },
  // #3313: the data box runs the PostgreSQL probe only from this root-owned copy
  // (spec §5 «Data-prod verbs.»); the other boxes carry it unused.
  { dest: POSTGRES_PROBE_BIN, path: "tools/deploy/postgres-artifact-probe.py" },
  // #3320: the prod release converges ds-data-prod by running this root-owned copy
  // (`--role data --from-release`); the other boxes carry it unused.
  { dest: HARDEN_SSH_BIN, path: "infra/deploy/bin/harden-ssh.sh" },
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
export function releaseInstallScript(liveDir = PROD_LIVE_TREE, { sha } = {}) {
  if (sha !== undefined) assertRelease("prod", sha);
  return [
    ...installDirLines(BOX_ENTRYPOINTS.map(({ dest }) => dest)),
    ...BOX_ENTRYPOINTS.map(({ dest, path }) => `sudo install -m 0755 "${liveDir}/${path}" ${dest}`),
    ...(sha === undefined ? [] : installedTreeLines(liveDir, sha)),
  ].join("\n");
}

// #2987: the tooling tree of the box-side rollback (spec §5 «Prod rollback», «Two
// trees»). A forward install keeps a copy of the tree it installed the entrypoints
// from — the shipped tree is replaced by the next ship, this copy only by the next
// install — and records its SHA and path in INSTALLED_TREE_FILE (one line,
// `<sha> <path>`). The copy is in place before the record names it.
//
// The root entrypoint execs from this copy (spec §4 «sudo on prod»), so it is
// root-owned and not group/other-writable — never the deploy-owned shipped tree's
// modes (`cp -a` would keep them). Each SHA gets its own directory under
// INSTALLED_TREES_DIR, filled under `.new` and renamed whole; INSTALLED_TREE_DIR is
// a symlink to it, switched by one rename (`mv -T`), so a reader sees the old tree
// or the new one, never a half-copied one. The current and the previous version are
// kept: a rollback unit that resolved the previous tree keeps its files.
export const INSTALLED_TREE_DIR = "/usr/local/lib/ds-platform/tree";
export const INSTALLED_TREES_DIR = "/usr/local/lib/ds-platform/trees";
export const INSTALLED_TREE_FILE = "/usr/local/lib/ds-platform/installed-tree";

function installedTreeLines(liveDir, sha) {
  const tree = INSTALLED_TREE_DIR;
  const version = `${INSTALLED_TREES_DIR}/${sha}`;
  return [
    `sudo install -d -m 0755 -o root -g root ${INSTALLED_TREES_DIR}`,
    `if ! sudo test -d "${version}"; then`,
    `  sudo rm -rf -- "${version}.new"`,
    `  sudo cp -R -- "${liveDir}/." "${version}.new"`,
    ...treeSymlinkCheckLines(`${version}.new`).map((l) => `  ${l}`),
    `  sudo chown -R root:root -- "${version}.new"`,
    `  sudo chmod -R go-w -- "${version}.new"`,
    `  sudo mv -T -- "${version}.new" "${version}"`,
    `fi`,
    // The pre-symlink layout kept a plain directory here; a rename cannot replace it.
    `if sudo test -d "${tree}" && ! sudo test -L "${tree}"; then sudo rm -rf -- "${tree}"; fi`,
    `prev=$(sudo readlink -- "${tree}" || true)`,
    `sudo ln -sfn -- "${version}" "${tree}.new"`,
    `sudo mv -T -- "${tree}.new" "${tree}"`,
    `for d in ${INSTALLED_TREES_DIR}/*; do [ "$d" = "${version}" ] || [ "$d" = "$prev" ] || sudo rm -rf -- "$d"; done`,
    `printf '%s %s\\n' ${sha} "${tree}" | sudo tee "${INSTALLED_TREE_FILE}.new" >/dev/null`,
    `sudo mv -- "${INSTALLED_TREE_FILE}.new" "${INSTALLED_TREE_FILE}"`,
  ];
}

/**
 * #2987: refuse a copied tree that holds a symlink resolving outside it. `cp -R`
 * copies a symlink as a symlink, and `chown -R` does not follow it, so a link in the
 * deploy-owned shipped tree could point root, which execs from the copy, at a
 * deploy-writable file. Every link is resolved by root (`readlink -f`, which fails
 * closed on an unresolvable link) against the canonical copy directory; any escape
 * removes the copy and exits 1 before the copy is chowned or renamed.
 */
export function treeSymlinkCheckLines(dir) {
  return [
    `escaped=$(sudo find "${dir}" -type l -exec sh -c 'top=$(readlink -f -- "$0") || exit 1; for l; do t=$(readlink -f -- "$l") || t=; case $t in "$top"|"$top"/*) ;; *) printf "%s -> %s\\n" "$l" "\${t:-unresolvable}" ;; esac; done' "${dir}" {} +) || escaped="the symlink check failed"`,
    `if [ -n "$escaped" ]; then`,
    `  printf 'install refused: a symlink in the shipped tree resolves outside it:\\n%s\\n' "$escaped" >&2`,
    `  sudo rm -rf -- "${dir}"`,
    `  exit 1`,
    `fi`,
  ];
}

/** #2987: the box-side rollback's own unit (spec §5 «Own unit and record»). */
export function rollbackUnitName(sha) {
  assertRelease("prod", sha);
  return `ds-prod-${sha.slice(0, 12)}-rollback`;
}

const ROLLBACK_UNIT_RE = /^ds-prod-[0-9a-f]{12}-rollback$/;

// `--except <unit>`: only the rollback's own unit — a step unit of the same SHA
// (a stale `migrate`) still refuses.
function exceptArg(exceptUnit) {
  if (exceptUnit === undefined) return "";
  if (!ROLLBACK_UNIT_RE.test(String(exceptUnit))) {
    throw new Error(`only a rollback unit is excluded from the live-unit check, not ${JSON.stringify(exceptUnit)}`);
  }
  return ` --except ${exceptUnit}`;
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

/**
 * Read-only: refuses (exit 3, naming the unit) while any step unit of `env` runs —
 * except `exceptUnit`, the box-side rollback's own unit (#2987).
 */
export function releaseCheckScript(env, { exceptUnit } = {}) {
  assertRelease(env, "0".repeat(40));
  return `sudo ${DS_RELEASE_BIN} check${exceptArg(exceptUnit)} ${env}`;
}

/**
 * Supersede every recorded attempt of `env` under its lock — refused while a step
 * unit still runs — then run `script` (streamed) still holding the lock. The
 * app-only rollback's `up -d` goes through it, so a later release of the SHA rolled
 * off starts a fresh attempt instead of answering from stale verdicts.
 */
export function releaseSupersedeScript(env, script, { exceptUnit } = {}) {
  assertRelease(env, "0".repeat(40));
  const command = `sudo ${DS_RELEASE_BIN} supersede${exceptArg(exceptUnit)} ${env}`;
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
    // #3313: ds-data-prod starts and reads its units through its own verbs.
    startStep,
    readStatus,
  },
) {
  const unit = releaseUnitName(env, sha, step);
  const start =
    startStep ??
    (() => capture(host, releaseStartScript({ env, sha, step, script, retryFailed }), { stderr: "pipe" }));
  const readStatusLine =
    readStatus ??
    (() =>
      capture(host, releaseStatusScript(env, sha), {
        sshOptions: ["-o", "ConnectTimeout=15"],
        stderr: "pipe",
      }));
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
      status = parseReleaseStatus(await readStatusLine());
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
