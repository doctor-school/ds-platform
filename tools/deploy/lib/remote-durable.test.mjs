// tools/deploy/lib/remote-durable.test.mjs — the operator half of the durable box
// steps (Issue #2982; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §5): the command builders that drive `/usr/local/bin/ds-release` and the
// start-then-poll loop. The entrypoint's own decision table is exercised for real
// in tools/deploy/ds-release.test.mjs; here the box is a scripted `capture`.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import {
  DS_RELEASE_BIN,
  releaseFinishScript,
  releaseForgetArgv,
  DS_DEPLOY_ENTRYPOINT_BIN,
  RELEASE_DRIVER_BIN,
  POSTGRES_PROBE_BIN,
  releaseInstallFromSourceScript,
  releaseInstallScript,
  releaseStartScript,
  releaseStatusScript,
  releaseStepVerdict,
  releaseUnitName,
  runDurableStep,
  treeSymlinkCheckLines,
} from "./remote.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("2982: unit names are ds-<env>-<sha12>-<step> and refuse anything else", () => {
  assert.equal(
    releaseUnitName("prod", SHA, "migrate"),
    "ds-prod-0123456789ab-migrate",
  );
  assert.equal(
    releaseUnitName("stage-pr-42", SHA, "pull-api"),
    "ds-stage-pr-42-0123456789ab-pull-api",
  );
  assert.throws(() => releaseUnitName("production", SHA, "up"), /env/);
  assert.throws(() => releaseUnitName("prod", "abc", "up"), /sha/);
  assert.throws(() => releaseUnitName("prod", SHA, "up;rm"), /step/);
});

test("2982/2984/2985: every box entrypoint is installed from the shipped tree, idempotently", () => {
  assert.equal(
    releaseInstallScript(),
    [
      "sudo install -d -m 0755 -o root -g root /usr/local/lib/ds-platform",
      `sudo install -m 0755 "/home/deploy/ds-platform/infra/deploy/bin/ds-release" ${DS_RELEASE_BIN}`,  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
      `sudo install -m 0755 "/home/deploy/ds-platform/infra/deploy/bin/ds-deploy-entrypoint" ${DS_DEPLOY_ENTRYPOINT_BIN}`,  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
      `sudo install -m 0755 "/home/deploy/ds-platform/infra/deploy/bin/release-driver" ${RELEASE_DRIVER_BIN}`,  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
      `sudo install -m 0755 "/home/deploy/ds-platform/tools/deploy/postgres-artifact-probe.py" ${POSTGRES_PROBE_BIN}`,  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
    ].join("\n"),
  );
  assert.equal(RELEASE_DRIVER_BIN, "/usr/local/lib/ds-platform/release-driver");
  const slot = releaseInstallScript("$HOME/ds-platform.slots/pr-7");
  assert.match(slot, /"\$HOME\/ds-platform\.slots\/pr-7\/infra\/deploy\/bin\/ds-release"/);
  assert.match(slot, /"\$HOME\/ds-platform\.slots\/pr-7\/infra\/deploy\/bin\/ds-deploy-entrypoint"/);
});

// #3054: a rollback ships no tree, so it installs the entrypoint from the
// operator checkout's bytes, streamed over the ssh channel. The script runs for
// real here against a `sudo` stand-in that copies the installed file out, so a
// box with no /usr/local/bin/ds-release is shown to end up with the exact bytes.
const HAS_BASH =
  spawnSync("bash", ["-c", "command -v base64 && command -v sha256sum"]).status === 0;
const NO_BASH = !HAS_BASH && "no bash/base64/sha256sum on this machine";

function runInstall(script) {
  const dir = mkdtempSync(join(tmpdir(), "ds-release-install-"));
  try {
    const out = join(dir, "installed");
    const sudo = join(dir, "sudo");
    writeFileSync(
      sudo,
      [
        "#!/usr/bin/env bash",
        '[ "$1 $2 $3" = "install -m 0755" ] || exit 9',
        'n=$(cat "$DS_TEST_OUT.n" 2>/dev/null || echo 0)',
        'cp "$4" "$DS_TEST_OUT.$n"',
        'printf %s "$5" > "$DS_TEST_OUT.$n.dest"',
        'echo $((n + 1)) > "$DS_TEST_OUT.n"',
        "",
      ].join("\n"),
    );
    chmodSync(sudo, 0o755);
    const run = spawnSync("bash", ["--norc", "-euo", "pipefail", "-c", script], {
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, DS_TEST_OUT: out },
      encoding: "utf8",
    });
    if (run.status !== 0) {
      return { status: run.status, stderr: run.stderr, installed: existsSync(`${out}.n`) };
    }
    const files = Array.from({ length: Number(readFileSync(`${out}.n`, "utf8")) }, (_, i) => ({
      bytes: readFileSync(`${out}.${i}`),
      dest: readFileSync(`${out}.${i}.dest`, "utf8"),
    }));
    return { status: 0, files, bytes: files[0].bytes, dest: files[0].dest };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("3054: the entrypoint installs from the operator's bytes onto a box without it", { skip: NO_BASH }, () => {
  const source = Buffer.concat([
    Buffer.from("#!/usr/bin/env bash\r\necho \"$HOME\" '$x' `id`\nDS_RELEASE_B64\nEOF\n", "utf8"),
    Buffer.from([0xc3, 0xa9, 0x00, 0xff]),
    Buffer.from("tail-without-newline", "utf8"),
  ]);
  const script = releaseInstallFromSourceScript(source);
  assert.doesNotMatch(script, /infra\/deploy\/bin|ds-platform/, "no shipped tree is read");
  const result = runInstall(script);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.bytes.equals(source), "the installed bytes are exactly the operator's");
  assert.equal(result.dest, DS_RELEASE_BIN);
});

test("3054: bytes damaged in transit are refused before anything is installed", { skip: NO_BASH }, () => {
  const script = releaseInstallFromSourceScript(Buffer.from("#!/bin/sh\necho ok\n"));
  const damaged = script.replace(
    /\n([A-Za-z0-9+/=]+)\nDS_RELEASE_B64\n/,
    (_m, line) => `\n${line.startsWith("A") ? "B" : "A"}${line.slice(1)}\nDS_RELEASE_B64\n`,
  );
  assert.notEqual(damaged, script);
  const result = runInstall(damaged);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum/);
  assert.equal(result.installed, false, "the stand-in install never ran");
});

test("3054: an empty entrypoint source is refused", () => {
  assert.throws(() => releaseInstallFromSourceScript(Buffer.alloc(0)), /empty/);
  assert.throws(() => releaseInstallFromSourceScript([]), /no entrypoint source/);
});

test("2984: the rollback install carries both entrypoints, each byte-exact at its own path", { skip: NO_BASH }, () => {
  const release = Buffer.from("#!/usr/bin/env bash\necho release\n");
  const entry = Buffer.from("#!/usr/bin/env bash\necho entry\nDS_RELEASE_B64\n");
  const result = runInstall(
    releaseInstallFromSourceScript([
      { source: release, dest: DS_RELEASE_BIN },
      { source: entry, dest: DS_DEPLOY_ENTRYPOINT_BIN },
    ]),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.files.length, 2);
  assert.ok(result.files[0].bytes.equals(release));
  assert.equal(result.files[0].dest, DS_RELEASE_BIN);
  assert.ok(result.files[1].bytes.equals(entry));
  assert.equal(result.files[1].dest, DS_DEPLOY_ENTRYPOINT_BIN);
});

test("2984: one damaged file refuses the whole install, before either binary is touched", { skip: NO_BASH }, () => {
  const script = releaseInstallFromSourceScript([
    { source: Buffer.from("#!/bin/sh\necho one\n"), dest: DS_RELEASE_BIN },
    { source: Buffer.from("#!/bin/sh\necho two\n"), dest: DS_DEPLOY_ENTRYPOINT_BIN },
  ]);
  // Damage the SECOND file's payload: the first must not be installed either.
  const parts = script.split("\nDS_RELEASE_B64\n");
  assert.equal(parts.length, 3);
  const payload = parts[1].split("\n");
  const last = payload.length - 1;
  payload[last] = (payload[last].startsWith("A") ? "B" : "A") + payload[last].slice(1);
  const damaged = [parts[0], payload.join("\n"), parts[2]].join("\nDS_RELEASE_B64\n");
  assert.notEqual(damaged, script);
  const result = runInstall(damaged);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ds-deploy-entrypoint install: checksum mismatch/);
  assert.equal(result.installed, false, "the first file was not installed either");
});

test("2982: the start script hands the step script over a quoted heredoc, never streams it", () => {
  const step = 'cd ~/x\nsudo docker compose up -d "$svc"\n';
  const script = releaseStartScript({
    env: "prod",
    sha: SHA,
    step: "up",
    script: step,
  });
  const delimiter = script.match(/<<'(DS_RELEASE_STEP_[0-9a-f]{16})'/)?.[1];
  assert.ok(delimiter, script);
  assert.ok(
    script.includes(`\n${step}${delimiter}\n`),
    "the body is verbatim, closed by its delimiter",
  );
  assert.ok(
    script.endsWith(`
sudo ${DS_RELEASE_BIN} release prod ${SHA} up "$f"`),
    script,
  );
  assert.doesNotMatch(script, /--retry-failed/);
  assert.match(
    releaseStartScript({
      env: "prod",
      sha: SHA,
      step: "up",
      script: step,
      retryFailed: true,
    }),
    /release --retry-failed prod /,
  );
});

test("2982: status / finish / forget builders", () => {
  assert.equal(
    releaseStatusScript("stage-main", SHA),
    `sudo ${DS_RELEASE_BIN} status stage-main ${SHA}`,
  );
  assert.equal(
    releaseFinishScript("prod", SHA, "succeeded"),
    `sudo ${DS_RELEASE_BIN} finish prod ${SHA} succeeded`,
  );
  assert.throws(
    () => releaseFinishScript("prod", SHA, "done"),
    /succeeded or failed/,
  );
  assert.deepEqual(releaseForgetArgv("stage-pr-9"), [
    "sudo",
    DS_RELEASE_BIN,
    "forget",
    "stage-pr-9",
  ]);
});

const doc = (steps, state = "running") => ({
  env: "prod",
  sha: SHA,
  unit: "u",
  state,
  step: steps.at(-1)?.name ?? "pull",
  steps,
  startedAt: "t",
  updatedAt: "t",
  error: null,
});
const item = (name, endedAt, rc) => ({
  name,
  unit: `ds-prod-0123456789ab-${name}`,
  startedAt: "t",
  endedAt,
  rc,
});

test("2982: the poll decision table — absent / running / lost / succeeded / failed", () => {
  assert.equal(
    releaseStepVerdict({ release: null, unitAlive: null }, "pull").state,
    "absent",
  );
  assert.equal(
    releaseStepVerdict(
      { release: doc([item("pull", "t", 0)]), unitAlive: null },
      "migrate",
    ).state,
    "absent",
  );
  assert.equal(
    releaseStepVerdict(
      { release: doc([item("pull", null, null)]), unitAlive: true },
      "pull",
    ).state,
    "running",
  );
  assert.equal(
    releaseStepVerdict(
      { release: doc([item("pull", null, null)]), unitAlive: false },
      "pull",
    ).state,
    "lost",
  );
  assert.equal(
    releaseStepVerdict(
      { release: doc([item("pull", "t", 0)]), unitAlive: null },
      "pull",
    ).state,
    "succeeded",
  );
  const failed = releaseStepVerdict(
    { release: doc([item("pull", "t", 3)], "failed"), unitAlive: null },
    "pull",
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.rc, 3);
  assert.equal(failed.unit, "ds-prod-0123456789ab-pull");
});

// A scripted box: `starts` answers each start call, `polls` each status call.
function fakeBox({ starts = [], polls = [] }) {
  const calls = [];
  const capture = async (host, script) => {
    const kind = script.includes(" status ") ? "status" : "start";
    calls.push({ host, kind, script });
    const next = (kind === "status" ? polls : starts).shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error(`unexpected ${kind} call`);
    return typeof next === "string" ? next : JSON.stringify(next);
  };
  return { calls, capture };
}

const base = (box, extra = {}) => ({
  env: "prod",
  sha: SHA,
  step: "pull",
  script: "true\n",
  label: "api-prod pull",
  capture: box.capture,
  sleep: async () => {},
  log: (line) => box.lines.push(line),
  pollMs: 1,
  ...extra,
});

test("2982: start, then one status line per poll until the step succeeds", async () => {
  const box = fakeBox({
    starts: ["ds-release: ds-prod-0123456789ab-pull started"],
    polls: [
      { release: doc([item("pull", null, null)]), unitAlive: true },
      new Error("ssh capture on api exited 255"),
      { release: doc([item("pull", null, null)]), unitAlive: true },
      { release: doc([item("pull", "t", 0)]), unitAlive: null },
    ],
  });
  box.lines = [];
  const verdict = await runDurableStep("api", base(box));
  assert.equal(verdict.state, "succeeded");
  assert.deepEqual(
    box.calls.map((c) => c.kind),
    ["start", "status", "status", "status", "status"],
  );
  assert.equal(box.lines.length, 5, box.lines.join("\n"));
  assert.match(box.lines.at(-1), /ds-prod-0123456789ab-pull succeeded/);
  assert.ok(
    box.lines.every((l) => !l.includes("\n")),
    "one line per poll, never a log tail",
  );
});

test("2982: a failed step throws with the journal pointer, without re-starting it", async () => {
  const box = fakeBox({
    starts: ["started"],
    polls: [
      { release: doc([item("pull", "t", 2)], "failed"), unitAlive: null },
    ],
  });
  box.lines = [];
  await assert.rejects(
    runDurableStep("api", base(box)),
    /rc 2.*journalctl -u ds-prod-0123456789ab-pull/s,
  );
  assert.equal(box.calls.filter((c) => c.kind === "start").length, 1);
});

test("2982: a lost unit is settled through the entrypoint and fails the step", async () => {
  const box = fakeBox({
    starts: [
      "started",
      new Error(
        "ssh capture on api exited 1: ds-release: ds-prod-0123456789ab-pull failed",
      ),
    ],
    polls: [{ release: doc([item("pull", null, null)]), unitAlive: false }],
  });
  box.lines = [];
  await assert.rejects(
    runDurableStep("api", base(box, { maxLostReads: 1 })),
    /ended without a verdict/,
  );
  assert.deepEqual(
    box.calls.map((c) => c.kind),
    ["start", "status", "start"],
  );
});

test("2982: a refused start (lease / lock / recorded failure) fails before any poll", async () => {
  const box = fakeBox({
    starts: [
      new Error(
        "ssh capture on api exited 3: ds-release: refused: env prod is leased by release aaaaaaaaaaaa",
      ),
    ],
  });
  box.lines = [];
  await assert.rejects(
    runDurableStep("api", base(box)),
    /leased by release aaaaaaaaaaaa/,
  );
  assert.equal(box.calls.length, 1);
});

test("2982: losing the box only stops the WAIT — the unit keeps running and a re-run reattaches", async () => {
  const lost = () => new Error("ssh capture on api exited 255");
  const box = fakeBox({ starts: ["started"], polls: [lost(), lost(), lost()] });
  box.lines = [];
  await assert.rejects(
    runDurableStep("api", base(box, { maxPollFailures: 3 })),
    /still runs on the box.*re-run the same SHA to reattach/s,
  );
});

test("2982: a step past its deadline is left running and reported, not killed", async () => {
  let clock = 0;
  const running = { release: doc([item("pull", null, null)]), unitAlive: true };
  const box = fakeBox({
    starts: ["started"],
    polls: [running, running, running],
  });
  box.lines = [];
  await assert.rejects(
    runDurableStep(
      "api",
      base(box, { timeoutMs: 15, now: () => (clock += 10) }),
    ),
    /still running after .*re-run the same SHA to reattach/s,
  );
});

test("2982: a step the box already recorded as succeeded resolves at once, without a poll", async () => {
  const box = fakeBox({
    starts: [
      "ds-release: ds-prod-0123456789ab-pull succeeded (recorded verdict; not re-run)",
    ],
  });
  box.lines = [];
  let slept = 0;
  const verdict = await runDurableStep(
    "api",
    base(box, { sleep: async () => void (slept += 1) }),
  );
  assert.equal(verdict.state, "succeeded");
  assert.equal(slept, 0, "no poll wait for a recorded verdict");
  assert.deepEqual(box.calls.map((c) => c.kind), ["start"]);
});

test("2982: a corrupt status file is reported as such, never as lost contact", async () => {
  const box = fakeBox({
    starts: ["started"],
    polls: [
      new Error(
        "ssh capture on api exited 3: ds-release: corrupt status file /var/lib/ds-platform/release/prod/x.json",
      ),
    ],
  });
  box.lines = [];
  await assert.rejects(runDurableStep("api", base(box)), (error) => {
    assert.match(error.message, /corrupt status file \/var\/lib\/ds-platform\/release\/prod\/x\.json/);
    assert.doesNotMatch(error.message, /lost contact/);
    return true;
  });
  assert.equal(box.calls.filter((c) => c.kind === "status").length, 1);
});

test("2982: transient «lost» reads are tolerated; the poll goes on", async () => {
  const lostRead = { release: doc([item("pull", null, null)]), unitAlive: false };
  const box = fakeBox({
    starts: ["started"],
    polls: [lostRead, lostRead, { release: doc([item("pull", "t", 0)]), unitAlive: null }],
  });
  box.lines = [];
  const verdict = await runDurableStep("api", base(box, { maxLostReads: 3 }));
  assert.equal(verdict.state, "succeeded");
  assert.deepEqual(box.calls.map((c) => c.kind), ["start", "status", "status", "status"]);
});

test("2982: «lost» reads that the box answers «running (attached)» leave the unit running", async () => {
  const lostRead = { release: doc([item("pull", null, null)]), unitAlive: false };
  const box = fakeBox({
    starts: ["started", "ds-release: ds-prod-0123456789ab-pull running (attached)"],
    polls: [lostRead, lostRead],
  });
  box.lines = [];
  await assert.rejects(
    runDurableStep("api", base(box, { maxLostReads: 2 })),
    /left running.*re-run the same SHA to reattach/s,
  );
  assert.deepEqual(box.calls.map((c) => c.kind), ["start", "status", "status", "start"]);
});

test("2982: the rollback builders — a read-only live-unit check and supersede under the env lock", async () => {
  const { releaseCheckScript, releaseSupersedeScript } = await import("./remote.mjs");
  assert.equal(releaseCheckScript("prod"), `sudo ${DS_RELEASE_BIN} check prod`);
  assert.equal(releaseSupersedeScript("prod"), `sudo ${DS_RELEASE_BIN} supersede prod`);
  const up = releaseSupersedeScript("prod", "cd x\nsudo docker compose up -d\n");
  assert.match(up, /cat > "\$f" <<'DS_RELEASE_STEP_[0-9a-f]{16}'\ncd x\nsudo docker compose up -d\nDS_RELEASE_STEP_/);
  assert.match(up, /sudo \/usr\/local\/bin\/ds-release supersede prod "\$f"$/);
  assert.throws(() => releaseCheckScript("production"));
});

test("2987: a forward install records its tree — a kept copy and its SHA — for the box-side rollback", async () => {
  const { INSTALLED_TREE_FILE, INSTALLED_TREE_DIR, INSTALLED_TREES_DIR } =
    await import("./remote.mjs");
  assert.equal(INSTALLED_TREES_DIR, "/usr/local/lib/ds-platform/trees");
  const V = `${INSTALLED_TREES_DIR}/${SHA}`;
  assert.equal(
    INSTALLED_TREE_FILE,
    "/usr/local/lib/ds-platform/installed-tree",
  );
  const lines = releaseInstallScript(undefined, { sha: SHA }).split(
    "\n",
  );
  // The binaries first, exactly as before; then the tree they came from: a
  // root-owned, not group/other-writable version directory filled under `.new` and
  // renamed whole, a `tree` symlink switched by one rename, current + previous kept.
  assert.equal(lines.slice(0, 5).join("\n"), releaseInstallScript());
  assert.deepEqual(lines.slice(5), [
    `sudo install -d -m 0755 -o root -g root ${INSTALLED_TREES_DIR}`,
    `if ! sudo test -d "${V}"; then`,
    `  sudo rm -rf -- "${V}.new"`,
    `  sudo cp -R -- "/home/deploy/ds-platform/." "${V}.new"`,  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
    ...treeSymlinkCheckLines(`${V}.new`).map((l) => `  ${l}`),
    `  sudo chown -R root:root -- "${V}.new"`,
    `  sudo chmod -R go-w -- "${V}.new"`,
    `  sudo mv -T -- "${V}.new" "${V}"`,
    `fi`,
    `if sudo test -d "${INSTALLED_TREE_DIR}" && ! sudo test -L "${INSTALLED_TREE_DIR}"; then sudo rm -rf -- "${INSTALLED_TREE_DIR}"; fi`,
    `prev=$(sudo readlink -- "${INSTALLED_TREE_DIR}" || true)`,
    `sudo ln -sfn -- "${V}" "${INSTALLED_TREE_DIR}.new"`,
    `sudo mv -T -- "${INSTALLED_TREE_DIR}.new" "${INSTALLED_TREE_DIR}"`,
    `for d in ${INSTALLED_TREES_DIR}/*; do [ "$d" = "${V}" ] || [ "$d" = "$prev" ] || sudo rm -rf -- "$d"; done`,
    `printf '%s %s\\n' ${SHA} "${INSTALLED_TREE_DIR}" | sudo tee "${INSTALLED_TREE_FILE}.new" >/dev/null`,
    `sudo mv -- "${INSTALLED_TREE_FILE}.new" "${INSTALLED_TREE_FILE}"`,
  ]);
  assert.throws(
    () => releaseInstallScript("$HOME/ds-platform", { sha: "abc" }),
    /sha/,
  );
});

// The check runs for real under bash, `sudo` stubbed to run its argv as the caller.
const SYMLINK_SKIP =
  spawnSync("bash", ["-c", "command -v find && readlink -f / && d=$(mktemp -d) && ln -s / \"$d/l\" && test -L \"$d/l\"; rc=$?; rm -rf \"$d\"; exit $rc"], {
    env: { ...process.env, MSYS: "winsymlinks:nativestrict" },
    stdio: "ignore",
  }).status !== 0 && "needs bash, find, readlink -f and real symlinks";

test("2987: a copied tree with a symlink leaving it is refused and removed before chown", { skip: SYMLINK_SKIP }, () => {
  const run = (setup) => {
    const dir = mkdtempSync(join(tmpdir(), "ds-tree-links-"));
    try {
      const stubs = join(dir, "stubs");
      const copy = join(dir, "trees", "v.new");
      spawnSync("bash", ["-c", `mkdir -p "$1" "$2/apps/docs/content/skills" "$2/.agents" && printf x > "$3/outside"`, "_", stubs, copy, dir]);
      writeFileSync(join(stubs, "sudo"), '#!/usr/bin/env bash\n"$@"\n');
      chmodSync(join(stubs, "sudo"), 0o755);
      spawnSync("bash", ["-c", setup], { cwd: copy, env: { ...process.env, MSYS: "winsymlinks:nativestrict" } });
      const script = [...treeSymlinkCheckLines(copy.replace(/\\/g, "/")), "echo checked"].join("\n");
      const r = spawnSync("bash", ["-c", script], {
        env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}` },
        encoding: "utf8",
      });
      return { status: r.status, out: r.stdout + r.stderr, kept: existsSync(copy) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  // The repo's own link (.agents/skills -> ../apps/docs/content/skills) stays inside.
  const inside = run("ln -s ../apps/docs/content/skills .agents/skills");
  assert.equal(inside.status, 0, inside.out);
  assert.match(inside.out, /checked/);
  assert.ok(inside.kept);
  for (const [what, setup] of [
    ["a relative escape", "ln -s ../../outside escape"],
    ["an absolute escape", "ln -s /etc/passwd escape"],
    ["a dangling escape", "ln -s /nonexistent/dir/file escape"],
  ]) {
    const r = run(setup);
    assert.equal(r.status, 1, `${what}: ${r.out}`);
    assert.match(r.out, /install refused: a symlink in the shipped tree resolves outside it/, what);
    assert.doesNotMatch(r.out, /checked/, `${what}: the install stops`);
    assert.ok(!r.kept, `${what}: the copy is removed`);
  }
});

test("2987: the rollback's check and supersede exclude exactly its own unit", async () => {
  const { releaseCheckScript, releaseSupersedeScript, rollbackUnitName } =
    await import("./remote.mjs");
  const own = rollbackUnitName(SHA);
  assert.equal(own, "ds-prod-0123456789ab-rollback");
  assert.equal(
    releaseCheckScript("prod", { exceptUnit: own }),
    `sudo ${DS_RELEASE_BIN} check --except ${own} prod`,
  );
  assert.equal(
    releaseSupersedeScript("prod", undefined, { exceptUnit: own }),
    `sudo ${DS_RELEASE_BIN} supersede --except ${own} prod`,
  );
  assert.ok(
    releaseSupersedeScript("prod", "true\n", { exceptUnit: own }).endsWith(
      `supersede --except ${own} prod "$f"`,
    ),
  );
  assert.throws(
    () =>
      releaseCheckScript("prod", {
        exceptUnit: "ds-prod-0123456789ab-migrate",
      }),
    /rollback unit/,
  );
  assert.throws(() => rollbackUnitName("abc"), /sha/);
});
