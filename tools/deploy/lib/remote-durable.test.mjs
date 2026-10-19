// tools/deploy/lib/remote-durable.test.mjs — the operator half of the durable box
// steps (Issue #2982; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §5): the command builders that drive `/usr/local/bin/ds-release` and the
// start-then-poll loop. The entrypoint's own decision table is exercised for real
// in tools/deploy/ds-release.test.mjs; here the box is a scripted `capture`.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DS_RELEASE_BIN,
  releaseFinishScript,
  releaseForgetArgv,
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
    runDurableStep("api", base(box)),
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
