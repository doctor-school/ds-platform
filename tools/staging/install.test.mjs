// tools/staging/install.test.mjs — Issue #2064 part 2a.
//
// The regressions these lock: the payload never loses `golden-db.mjs` (which
// `slot.mjs` imports — shipping one without the other yields a box that fails at
// `import`, and on a timer that looks like a deployer doing nothing); the install is
// ONE ssh session with the tar on stdin, not a file-per-round-trip loop; a bare
// hostname is refused, so nobody installs as an accidental local username; and
// `--dry-run` prints the command that actually ships.
//
// No live ssh, no live tar: only the argv construction is asserted. The files that
// must exist are checked against the repository, path-agnostically.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SlotError } from "./slot.mjs";
import {
  PAYLOAD,
  REMOTE_INSTALL_SCRIPT,
  REPO_ROOT,
  assertTarget,
  describePlan,
  parseArgs,
  sshArgs,
  sshBaseArgs,
  tarArgs,
} from "./install.mjs";

const TARGET = "deploy@203.0.113.10";

test("EARS: the payload carries the three scripts, the compose project and the units", () => {
  assert.deepEqual(PAYLOAD, [
    "tools/staging/slot.mjs",
    "tools/staging/golden-db.mjs",
    "tools/staging/deployer.mjs",
    "tools/staging/install-host.sh",
    "infra/deploy/compose/slot",
    "infra/deploy/systemd",
  ]);
});

test("every payload path exists in the repository", () => {
  for (const path of PAYLOAD) {
    const absolute = fileURLToPath(new URL(path, new URL(`file://${REPO_ROOT.replace(/\\/g, "/")}`)));
    assert.ok(existsSync(absolute), `payload path is missing: ${path}`);
  }
});

test("`slot.mjs` never ships without the `golden-db.mjs` it imports", () => {
  assert.ok(PAYLOAD.includes("tools/staging/slot.mjs"));
  assert.ok(PAYLOAD.includes("tools/staging/golden-db.mjs"));
});

test("the tar streams to stdout with repository-relative paths", () => {
  const args = tarArgs("/repo");
  assert.deepEqual(args.slice(0, 4), ["-czf", "-", "-C", "/repo"]);
  assert.deepEqual(args.slice(4), [...PAYLOAD]);
});

test("EARS: the install is one ssh session — keepalive flags, host, then the script as an argument", () => {
  const args = sshArgs(TARGET);
  assert.deepEqual(sshBaseArgs(TARGET), [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    TARGET,
  ]);
  assert.equal(args.length, 6);
  assert.equal(args[4], TARGET);
  assert.equal(args[5], REMOTE_INSTALL_SCRIPT);
});

test("the remote script unpacks stdin into a temp dir it always removes, and sudos the host script", () => {
  assert.match(REMOTE_INSTALL_SCRIPT, /^set -eu;/);
  assert.match(REMOTE_INSTALL_SCRIPT, /tar -xzf - -C "\$d"/);
  assert.match(REMOTE_INSTALL_SCRIPT, /trap 'rm -rf "\$d"' EXIT INT TERM/);
  assert.match(REMOTE_INSTALL_SCRIPT, /sudo bash "\$d\/tools\/staging\/install-host\.sh"/);
  // `pipefail` is a bashism and the remote login shell is not guaranteed to be bash.
  assert.ok(!REMOTE_INSTALL_SCRIPT.includes("pipefail"));
});

test("a bare hostname is refused — the box account must be named", () => {
  assert.equal(assertTarget(TARGET), TARGET);
  assert.throws(() => assertTarget("203.0.113.10"), SlotError);
  assert.throws(() => assertTarget(undefined), SlotError);
  assert.throws(() => assertTarget("deploy@box; rm -rf /"), SlotError);
});

test("the CLI takes one target and the single `--dry-run` flag", () => {
  assert.deepEqual(parseArgs([TARGET]), { target: TARGET, dryRun: false });
  assert.deepEqual(parseArgs([TARGET, "--dry-run"]), { target: TARGET, dryRun: true });
  assert.throws(() => parseArgs([]), SlotError);
  assert.throws(() => parseArgs([TARGET, "extra"]), SlotError);
  assert.throws(() => parseArgs([TARGET, "--force"]), SlotError);
});

test("`--dry-run` prints the payload and both commands that would run", () => {
  const plan = describePlan(TARGET, "/repo");
  for (const path of PAYLOAD) assert.ok(plan.includes(path), `dry run omits ${path}`);
  assert.match(plan, /local: {2}tar -czf - -C \/repo /);
  assert.ok(plan.includes(REMOTE_INSTALL_SCRIPT));
});
