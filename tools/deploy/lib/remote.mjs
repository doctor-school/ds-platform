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
// `extraOptions` are per-call `-o` flags (a read-only probe wants a short
// ConnectTimeout and BatchMode; a deploy deliberately does not).
export function sshBaseArgs(host, extraOptions = []) {
  return [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    ...extraOptions,
    host,
  ];
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
    const child = spawn(
      "ssh",
      [...sshBaseArgs(host, sshOptions), REMOTE_BASH],
      { stdio: ["pipe", "pipe", stderr] },
    );
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

// --- durable box steps (Issue #2982; tech spec 2026-10-16 release pipeline §5) ---
//
// A long box step is never streamed over ssh: killing a streamed client kills the
// remote command within ~2 s. `/usr/local/bin/ds-release` runs each step in its own
// transient systemd unit (`ds-<env>-<sha12>-<step>`); the operator starts or
// attaches to it, then polls the box's status file, printing one status line per
// poll. The full step log stays in the unit's journal on the box.

export const DS_RELEASE_BIN = "/usr/local/bin/ds-release";
export const RELEASE_STATE_ROOT = "/var/lib/ds-platform/release";
export const RELEASE_POLL_MS = 10 * 1000;
export const RELEASE_POLL_MAX_FAILURES = 6;
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

/** Install the entrypoint from the tree just shipped to the box (every run). */
export function releaseInstallScript(liveDir = "$HOME/ds-platform") {
  return `sudo install -m 0755 "${liveDir}/infra/deploy/bin/ds-release" ${DS_RELEASE_BIN}`;
}

/**
 * Start (or attach to) one step. The step script reaches the box inside a quoted
 * heredoc — no expansion, its delimiter derived from the script itself — and
 * `ds-release` copies it root-only before the unit runs it.
 */
export function releaseStartScript({ env, sha, step, script, retryFailed = false }) {
  assertRelease(env, sha, step);
  const body = script.endsWith("\n") ? script : `${script}\n`;
  const delimiter = `DS_RELEASE_STEP_${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
  const retry = retryFailed ? " --retry-failed" : "";
  return [
    'f=$(mktemp)',
    `trap 'rm -f "$f"' EXIT`,
    `cat > "$f" <<'${delimiter}'`,
    `${body}${delimiter}`,
    `sudo ${DS_RELEASE_BIN} release${retry} ${env} ${sha} ${step} "$f"`,
  ].join("\n");
}

/** Read-only, no sudo: the status file is world-readable and replaced atomically. */
export function releaseStatusScript(env, sha) {
  assertRelease(env, sha);
  return `${DS_RELEASE_BIN} status ${env} ${sha}`;
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

/** The env's status-file directory — world-readable, so a probe needs no sudo. */
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
  log(`  ↳ ${host}: ${String(started).trim().split(/\r?\n/).at(-1)}`);
  const reattach = `re-run the same SHA to reattach (box status: ${releaseStatusScript(env, sha)})`;
  const t0 = now();
  let failures = 0;
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
    if (verdict.state === "lost") {
      // `release` settles a dead unit's step as failed under the env lock.
      let detail;
      try {
        detail = await start();
      } catch (error) {
        detail = error.message;
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
