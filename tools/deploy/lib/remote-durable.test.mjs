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
  releaseInstallFromSourceScript,
  releaseInstallScript,
  releaseStartScript,
  releaseStatusScript,
  releaseStepVerdict,
  releaseUnitName,
  runDurableStep,
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

test("2982: the entrypoint is installed from the shipped tree, idempotently", () => {
  assert.equal(
    releaseInstallScript(),
    `sudo install -m 0755 "$HOME/ds-platform/infra/deploy/bin/ds-release" ${DS_RELEASE_BIN}`,
  );
  assert.match(
    releaseInstallScript("$HOME/ds-platform.slots/pr-7"),
    /"\$HOME\/ds-platform\.slots\/pr-7\/infra\/deploy\/bin\/ds-release"/,
  );
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
        'cp "$4" "$DS_TEST_OUT"',
        'printf %s "$5" > "$DS_TEST_OUT.dest"',
        "",
      ].join("\n"),
    );
    chmodSync(sudo, 0o755);
    const run = spawnSync("bash", ["--norc", "-euo", "pipefail", "-c", script], {
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, DS_TEST_OUT: out },
      encoding: "utf8",
    });
    if (run.status !== 0) {
      return { status: run.status, stderr: run.stderr, installed: existsSync(out) };
    }
    return { status: 0, bytes: readFileSync(out), dest: readFileSync(`${out}.dest`, "utf8") };
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
