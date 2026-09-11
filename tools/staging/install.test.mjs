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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

test("EARS: the payload carries the four scripts, the compose project and the units", () => {
  assert.deepEqual(PAYLOAD, [
    "tools/staging/slot.mjs",
    "tools/staging/golden-db.mjs",
    "tools/staging/idp.mjs",
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

test("`slot.mjs` never ships without the modules it imports", () => {
  assert.ok(PAYLOAD.includes("tools/staging/slot.mjs"));
  // A `slot.mjs` that reaches /opt/ds-platform without one of its two sibling modules
  // is a box where every `ds-slot` invocation dies on an unresolved import.
  assert.ok(PAYLOAD.includes("tools/staging/golden-db.mjs"));
  assert.ok(PAYLOAD.includes("tools/staging/idp.mjs"));
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

// --- the host script's fail-hard contract (Mode (a) blocker, PR #2170) --------
//
// `copy_file` and `write_file` are invoked from errexit-ignoring contexts
// (`copy_file ... || true`, `if copy_file ...; then`), and bash documents that `-e`
// is disabled inside a function body executed in such a context. A failing
// `install(1)` — read-only mount, ENOSPC, an immutable unit file — must therefore
// still abort the whole run through the helper's own `|| die`, instead of falling
// through to `ensured` and leaving the box on the OLD file with an exit 0.
//
// These drive that branch for real: the helper section of `install-host.sh` is
// evaluated in a bash subshell whose `install` is a shell function that always
// fails, so no root, no box and no filesystem writes are involved.

const HOST_SCRIPT = fileURLToPath(new URL("./install-host.sh", import.meta.url));

const PRELUDE = `set -euo pipefail
ensured() { echo "ensured $*"; }
already() { echo "already $*"; }
die() { echo "install-host: $*" >&2; exit 1; }
install() { return 1; }
`;

function helperSection() {
  const source = readFileSync(HOST_SCRIPT, "utf8");
  const start = source.indexOf("# --- helpers");
  const end = source.indexOf("# --- 1. the pinned Node runtime");
  assert.ok(start > 0 && end > start, "install-host.sh no longer has a helper section");
  return source.slice(start, end);
}

function runHelpers(body) {
  const script = `${PRELUDE}${helperSection()}${body}
echo "REACHED THE END"
`;
  return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

function assertHardFailure(t, body) {
  const run = runHelpers(body);
  if (run.error) {
    t.skip(`bash is unavailable: ${run.error.message}`);
    return;
  }
  assert.equal(run.status, 1, `expected a non-zero exit, got ${run.status}`);
  assert.match(run.stderr, /install-host: failed to install/);
  assert.ok(!run.stdout.includes("ensured"), `reported success: ${run.stdout}`);
  assert.ok(!run.stdout.includes("REACHED THE END"), `kept going: ${run.stdout}`);
}

test("a failed `copy_file` aborts the install even behind `|| true`", (t) => {
  assertHardFailure(
    t,
    'copy_file /tmp/ds-2064-src /tmp/ds-2064-dst 0644 "script /tmp/ds-2064-dst" || true',
  );
});

test("a failed `copy_file` aborts the install even inside an `if` condition", (t) => {
  // This is the units loop: `if copy_file ...; then units_changed=1; fi`. A swallowed
  // failure there means `daemon-reload` + `restart` over units that were never written.
  assertHardFailure(
    t,
    'if copy_file /tmp/ds-2064-src /tmp/ds-2064-unit 0644 "unit /tmp/ds-2064-unit"; then :; fi',
  );
});

test("a failed `write_file` aborts the install even behind `|| true`", (t) => {
  assertHardFailure(
    t,
    'write_file /tmp/ds-2064-wrapper 0750 "wrapper /tmp/ds-2064-wrapper" "#!/usr/bin/env bash" || true',
  );
});

test("a failed `write_file` leaves no temp file behind", (t) => {
  // `die` exits the function, and bash runs NO RETURN trap on an exit (bash 5.3), so
  // the trap alone let every failed install strand a root-owned /tmp file — which the
  // round-1 NIT (PR #2170) asked to stop. This drives the real helper section with a
  // private TMPDIR and counts what survives the die path.
  const run = runHelpers(`TMPDIR="$(mktemp -d)"
export TMPDIR
( write_file /tmp/ds-2064-wrapper 0750 "wrapper /tmp/ds-2064-wrapper" "#!/usr/bin/env bash" ) || true
echo "LEFTOVER $(ls -A "$TMPDIR" | wc -l)"
rmdir "$TMPDIR" 2>/dev/null || true`);
  if (run.error) {
    t.skip(`bash is unavailable: ${run.error.message}`);
    return;
  }
  assert.match(run.stderr, /install-host: failed to install/, "the die path must still fire");
  assert.ok(
    run.stdout.includes("LEFTOVER 0"),
    `a temp file survived the die path: ${run.stdout}`,
  );
});

test("every mutating helper command carries its own `|| die`", () => {
  const helpers = helperSection();
  for (const command of ["install -o root -g root", "install -d -o root -g root", "ln -sfn"]) {
    // EVERY occurrence, not just the first: `indexOf` checked one call site and would
    // have passed a second, unguarded one added beside it (Mode (a) NIT, PR #2170).
    const occurrences = [...helpers.matchAll(new RegExp(command, "gu"))];
    assert.ok(occurrences.length > 0, `helper section lost ${command}`);
    for (const occurrence of occurrences) {
    // Collapsed, because `copy_file`'s die sits on a continuation line.
    const tail = helpers.slice(occurrence.index, occurrence.index + 200).split(/\s+/u).join(" ");
    // `|| die ...` or the cleanup form `|| { rm -f "$tmp"; die ...; }` — what matters
    // is that the failure reaches `die`, not which of the two spellings carries it.
    assert.ok(
      /\|\| (die|\{ rm -f "\$tmp"; die)/u.test(tail),
      `${command} may fail silently in an errexit-ignoring caller`,
    );
    }
  }
});
