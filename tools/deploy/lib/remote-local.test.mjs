// tools/deploy/lib/remote-local.test.mjs — the box-local executor (Issue #2985; tech
// spec 2026-10-16-release-pipeline-off-workstation-en.md §5). On the box the release
// driver addresses the box as LOCAL_EXECUTOR: the command an ssh session hands the
// box's shell runs through a local `bash -c` instead, with the same stdin and
// watchdog. The live runs need a POSIX bash/tar — CI Linux; skipped on Windows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { committedReleaseSources } from "../prod.mjs";
import {
  BOX_ENTRYPOINTS,
  LOCAL_EXECUTOR,
  boxSpawnArgs,
  releaseInstallFromSourceScript,
  remoteBash,
  shipTree,
  shipTreeCommand,
  sshBaseArgs,
  sshCapture,
  sshScript,
} from "./remote.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const POSIX =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v tar && command -v mktemp && command -v base64 && command -v sha256sum"], {
    stdio: "ignore",
  }).status === 0;
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

test("2987: asRoot hands the drained script whole to `sudo -n bash`; the plain form is unchanged", () => {
  const drain = `f=$(mktemp) && trap 'rm -f "$f"' EXIT && cat >"$f" && `;
  assert.equal(remoteBash(), `${drain}bash --norc -euo pipefail "$f"`);
  assert.equal(remoteBash({ asRoot: false }), remoteBash());
  assert.equal(remoteBash({ asRoot: true }), `${drain}sudo -n bash --norc -euo pipefail "$f"`);
});

test("2987: an asRoot script and capture run through sudo with the script intact", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-asroot-"));
  const path = process.env.PATH;
  try {
    // A sudo stand-in: records its argv, drops `-n`, runs the rest.
    writeFileSync(
      join(dir, "sudo"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$1" "$2" >>"${dir}/sudo.log"\n[[ $1 == -n ]] && shift\nexec "$@"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}:${path}`;
    assert.equal(await sshCapture(LOCAL_EXECUTOR, 'x="a b"; echo "$x"', { asRoot: true }), "a b");
    await sshScript(LOCAL_EXECUTOR, "true\n", { label: "root", asRoot: true });
    await assert.rejects(sshScript(LOCAL_EXECUTOR, "false\n", { label: "root", asRoot: true }), /root on local exited 1/);
    assert.equal(readFileSync(join(dir, "sudo.log"), "utf8"), "-n\nbash\n".repeat(3));
    await sshCapture(LOCAL_EXECUTOR, "true");
    assert.equal(readFileSync(join(dir, "sudo.log"), "utf8"), "-n\nbash\n".repeat(3), "the plain form never calls sudo");
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
});

// #3338: a script larger than one argv string (Linux MAX_ARG_STRLEN, 128 KiB) — the
// data-prod transition install of every BOX_ENTRYPOINT among them — runs whole,
// through both command forms, from a temp file removed on exit, its rc kept.
test("3338: both command forms run a script past 128 KiB, the real transition install included", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-big-script-"));
  const scratch = join(dir, "tmp");
  mkdirSync(scratch);
  const saved = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
  try {
    // A sudo stand-in: `-n …` runs the rest (the root form); any other call is
    // only recorded (the install script's `sudo install` lines).
    writeFileSync(
      join(dir, "sudo"),
      `#!/usr/bin/env bash\nif [[ $1 == -n ]]; then shift; exec "$@"; fi\nprintf '%s\\n' "$*" >>"${dir}/sudo.log"\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}:${saved.PATH}`;
    process.env.TMPDIR = scratch;
    const install = releaseInstallFromSourceScript(committedReleaseSources());
    const big = `${": ".concat("x".repeat(200)).concat("\n").repeat(1000)}echo "big $((6 * 7))"\n`;
    assert.ok(Buffer.byteLength(big) > 131072);
    for (const asRoot of [false, true]) {
      assert.equal(await sshCapture(LOCAL_EXECUTOR, big, { asRoot }), "big 42");
      await sshScript(LOCAL_EXECUTOR, install, { label: "install", asRoot });
      await assert.rejects(sshScript(LOCAL_EXECUTOR, `${big}exit 7\n`, { label: "rc", asRoot }), /rc on local exited 7/);
    }
    const installs = readFileSync(join(dir, "sudo.log"), "utf8").split("\n").filter((l) => /^install -m 0755 /.test(l));
    assert.deepEqual(
      installs.map((l) => l.split(" ").at(-1)),
      [...BOX_ENTRYPOINTS, ...BOX_ENTRYPOINTS].map(({ dest }) => dest),
    );
    assert.deepEqual(readdirSync(scratch), [], "no script file is left behind");
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.TMPDIR === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved.TMPDIR;
    rmSync(dir, { recursive: true, force: true });
  }
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
