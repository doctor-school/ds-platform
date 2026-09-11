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
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const child = spawn("ssh", [...sshBaseArgs(host), REMOTE_BASH], {
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
export function sshCapture(host, script) {
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
      const dir = rel.slice(0, rel.lastIndexOf("/"));
      return (
        `if [ -f "$live/$${v}" ]; then\n` +
        `  mkdir -p "$stage/${dir}"\n` +
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
 */
export async function shipTree(
  sha,
  host,
  { liveDir, preserved, tmpPrefix = "ds-deploy" } = {},
) {
  const tmp = join(tmpdir(), `${tmpPrefix}-${sha.slice(0, 12)}.tar.gz`);
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
        [...sshBaseArgs(host), shipTreeCommand({ liveDir, preserved })],
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
