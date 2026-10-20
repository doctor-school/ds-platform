// tools/deploy/lib/remote-local.test.mjs — the box-local executor (Issue #2985; tech
// spec 2026-10-16-release-pipeline-off-workstation-en.md §5). On the box the release
// driver addresses the box as LOCAL_EXECUTOR: the command an ssh session hands the
// box's shell runs through a local `bash -c` instead, with the same stdin and
// watchdog. The live runs need a POSIX bash/tar — CI Linux; skipped on Windows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCAL_EXECUTOR,
  boxSpawnArgs,
  shipTree,
  shipTreeCommand,
  sshBaseArgs,
  sshCapture,
  sshScript,
} from "./remote.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const POSIX =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v tar && command -v mktemp"], { stdio: "ignore" }).status === 0;
const SKIP = !POSIX && "needs a POSIX bash and tar";

test("2985: the local executor hands the box's shell the very command ssh would", () => {
  const command = shipTreeCommand({ liveDir: "$HOME/ds-platform.slots/main", preserved: [] });
  const [ssh, sshArgv] = boxSpawnArgs("ds-stage-1", command, ["-o", "ConnectTimeout=15"]);
  assert.equal(ssh, "ssh");
  assert.deepEqual(sshArgv, [...sshBaseArgs("ds-stage-1", ["-o", "ConnectTimeout=15"]), command]);
  const [bash, bashArgv] = boxSpawnArgs(LOCAL_EXECUTOR, command, ["-o", "ConnectTimeout=15"]);
  assert.equal(bash, "bash");
  assert.deepEqual(bashArgv, ["-c", command]);
  assert.equal(bashArgv.at(-1), sshArgv.at(-1), "the remote command is byte-identical");
});

test("2985: sshCapture runs the script locally, stdin-drained, and rejects on a non-zero exit", { skip: SKIP }, async () => {
  assert.equal(await sshCapture(LOCAL_EXECUTOR, 'x=$(printf ok); echo "$x"; read -r y || true; echo "[$y]"'), "ok\n[]");
  await assert.rejects(sshCapture(LOCAL_EXECUTOR, "echo nope >&2; exit 4", { stderr: "pipe" }), /exited 4: nope/);
});

test("2985: sshScript runs locally under -euo pipefail, the semantics of a streamed step", { skip: SKIP }, async () => {
  await sshScript(LOCAL_EXECUTOR, "true\n", { label: "ok" });
  await assert.rejects(sshScript(LOCAL_EXECUTOR, "false\necho never\n", { label: "step" }), /step on local exited 1/);
  await assert.rejects(sshScript(LOCAL_EXECUTOR, 'echo "$UNSET_VARIABLE_2985"\n', { label: "u" }), /exited 1/);
});

test("2985: a local ship installs the given tree as the live tree", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-local-ship-"));
  const home = process.env.HOME;
  try {
    const tree = join(dir, "work", "tree");
    mkdirSync(join(tree, "tools/staging"), { recursive: true });
    writeFileSync(join(tree, "tools/staging/slot.mjs"), "// shipped\n");
    mkdirSync(join(dir, "home"));
    process.env.HOME = join(dir, "home");
    await shipTree(SHA, LOCAL_EXECUTOR, {
      liveDir: "$HOME/ds-platform.slots/main",
      preserved: [],
      tmpPrefix: "ds-local-ship-test",
      sourceDir: tree,
    });
    const live = join(dir, "home/ds-platform.slots/main");
    assert.equal(readFileSync(join(live, "tools/staging/slot.mjs"), "utf8"), "// shipped\n");
    await assert.rejects(shipTree(SHA, LOCAL_EXECUTOR, { liveDir: "$HOME/x" }), /needs the tree directory/);
  } finally {
    process.env.HOME = home;
    rmSync(dir, { recursive: true, force: true });
  }
});
