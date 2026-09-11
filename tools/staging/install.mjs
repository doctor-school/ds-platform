#!/usr/bin/env node
// tools/staging/install.mjs — ships the slot tooling to `stage-1` (Issue #2064 part
// 2a, staging tech spec §3 «Host runtime» / §8 step 4).
//
// The WORKSTATION half of the install. It owns exactly two decisions — what the
// payload is, and how it reaches the box — and nothing else: every idempotence
// question is `install-host.sh`'s, on the far side of the pipe.
//
//   node tools/staging/install.mjs deploy@203.0.113.10
//   node tools/staging/install.mjs deploy@203.0.113.10 --dry-run
//
// ONE ssh session, with a tar on its stdin. Not `scp` and not a file-per-round-trip
// loop: the payload is a set that must land together (a `slot.mjs` newer than the
// `golden-db.mjs` it imports is a broken box), and a single stream either arrives
// whole or fails before anything is unpacked.
//
// The box needs no git, no rsync and no checkout: `/srv/ds-platform` on `stage-1` is
// the stg-infra bring-up's own clone and is NOT this tooling's home (§3). What lands
// here lands under /opt.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SlotError } from "./slot.mjs";

/**
 * Everything the box needs, as repository-relative paths.
 *
 * `golden-db.mjs` is in the list because `slot.mjs` imports it: shipping one without
 * the other produces a host that fails at `import`, which on a timer looks like the
 * deployer silently doing nothing. `install-host.sh` ships as part of the payload
 * rather than being piped separately so the script and the files it installs are
 * always the same generation.
 */
export const PAYLOAD = Object.freeze([
  "tools/staging/slot.mjs",
  "tools/staging/golden-db.mjs",
  "tools/staging/deployer.mjs",
  "tools/staging/install-host.sh",
  "infra/deploy/compose/slot",
  "infra/deploy/systemd",
]);

/** The repository root, derived from this file — never from `process.cwd()`. */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Keepalive on the ssh channel.
 *
 * The same flags and the same reasoning as `tools/deploy/prod.mjs` (#905): without
 * them a half-open TCP connection — a NAT table flush, a Wi-Fi flap, a box-side reset
 * the client never saw — hangs the install forever on a socket nobody will write to.
 * COPIED rather than imported: `prod.mjs` is the production deploy driver, and a
 * staging install must not be one edit away from pulling that module's pre-flight,
 * its release gate or its `die()` into this process.
 */
export function sshBaseArgs(host) {
  return ["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", host];
}

/**
 * The remote side, in POSIX sh — it is executed by the login shell, not by a `bash
 * -c` we control, so it uses nothing `dash` lacks (no `pipefail`).
 *
 * `tar -xzf -` reads the payload from the ssh channel's stdin. The temp directory is
 * removed on every exit path including a failed install: what stays behind on the box
 * is whatever `install-host.sh` put under /opt, /etc and /var, never a scratch copy of
 * the repository.
 */
export const REMOTE_INSTALL_SCRIPT = [
  "set -eu",
  'd=$(mktemp -d)',
  "trap 'rm -rf \"$d\"' EXIT INT TERM",
  'tar -xzf - -C "$d"',
  'sudo bash "$d/tools/staging/install-host.sh"',
].join("; ");

/** `tar` argv for the payload stream. `-C` keeps the archive paths repo-relative. */
export function tarArgs(repoRoot = REPO_ROOT) {
  return ["-czf", "-", "-C", repoRoot, ...PAYLOAD];
}

/** `ssh` argv for the one session. The script is an ARGUMENT; stdin carries the tar. */
export function sshArgs(host) {
  return [...sshBaseArgs(host), REMOTE_INSTALL_SCRIPT];
}

/**
 * `user@host`, validated.
 *
 * Not cosmetic: the value is spliced into an `ssh` argv, and a bare hostname would
 * silently install as whatever local username the operator happens to have. The box's
 * account is `deploy`, and naming it is how the command stays reproducible between
 * two people's machines.
 */
export function assertTarget(target) {
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$/.test(String(target ?? ""))) {
    throw new SlotError(
      `expected <user@host>, got ${JSON.stringify(target)} — e.g. deploy@203.0.113.10`,
    );
  }
  return target;
}

export function parseArgs(argv) {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== "--dry-run");
  if (unknown.length) throw new SlotError(`unknown option: ${unknown[0]}`);
  if (positional.length !== 1) {
    throw new SlotError("usage: node tools/staging/install.mjs <user@host> [--dry-run]");
  }
  return { target: assertTarget(positional[0]), dryRun: flags.includes("--dry-run") };
}

/** What `--dry-run` prints — a pure function, so the test reads exactly what ships. */
export function describePlan(target, repoRoot = REPO_ROOT) {
  return [
    `payload (relative to ${repoRoot}):`,
    ...PAYLOAD.map((path) => `  ${path}`),
    `local:  tar ${tarArgs(repoRoot).join(" ")}`,
    `remote: ssh ${sshBaseArgs(target).join(" ")} '${REMOTE_INSTALL_SCRIPT}'`,
  ].join("\n");
}

function ship(target) {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", tarArgs(), { stdio: ["ignore", "pipe", "inherit"] });
    const ssh = spawn("ssh", sshArgs(target), { stdio: ["pipe", "inherit", "inherit"] });
    let tarFailed = null;
    tar.on("error", reject);
    ssh.on("error", reject);
    tar.stdout.pipe(ssh.stdin);
    tar.on("close", (code) => {
      // A tar that dies mid-stream closes ssh's stdin, and the remote `tar -xzf -`
      // then reports a truncated archive — a confusing error for a local failure.
      // Remember the real cause and report it when ssh finishes.
      if (code !== 0) tarFailed = new Error(`tar exited ${code} — payload not shipped`);
    });
    ssh.on("close", (code) => {
      if (tarFailed) return reject(tarFailed);
      if (code === 0) resolve();
      else reject(new Error(`install on ${target} exited ${code}`));
    });
  });
}

async function main() {
  const { target, dryRun } = parseArgs(process.argv.slice(2));
  if (dryRun) {
    console.log(describePlan(target));
    return;
  }
  await ship(target);
  console.log(`slot tooling installed on ${target}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
