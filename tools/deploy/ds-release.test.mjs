// Bash-level tests of infra/deploy/bin/ds-release (Issue #2982; tech spec
// 2026-10-16-release-pipeline-off-workstation-en.md §5). `systemd-run` and
// `systemctl` are stubbed on PATH: the stub runs the unit's command as a detached
// background process and answers `show` / `list-units` from its own records, so
// the entrypoint's decision table, lease and status-file writes run for real.
// Needs bash, flock, python3 and getent — CI Linux; skipped where they are absent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

const toolsPresent =
  spawnSync(
    "bash",
    ["-c", "command -v flock && command -v python3 && command -v getent"],
    {
      stdio: "ignore",
    },
  ).status === 0;

const SYSTEMD_RUN_STUB = `#!/usr/bin/env bash
unit=
while [[ $# -gt 0 ]]; do
  case $1 in
    --unit=*) unit=\${1#--unit=} ;;
    -p) shift ;;
    --*) ;;
    *) break ;;
  esac
  shift
done
echo "$unit" >> "$STUB_DIR/systemd-run.log"
[[ -z \${STUB_DEAD_ON_START:-} ]] || { echo $$ > "$STUB_DIR/units/$unit.pid"; echo 137 > "$STUB_DIR/units/$unit.rc"; exit 0; }
# Like systemd, the unit inherits none of the caller's fds — the env lock on fd 9
# above all — and never holds the caller's stdout open.
( "$@" > "$STUB_DIR/units/$unit.log" 2>&1; echo $? > "$STUB_DIR/units/$unit.rc" ) </dev/null >/dev/null 2>&1 9>&- &
echo $! > "$STUB_DIR/units/$unit.pid"
`;

const SYSTEMCTL_STUB = `#!/usr/bin/env bash
units=$STUB_DIR/units
case $1 in
  show)
    prop=$3 name=\${5%.service}
    if [[ ! -f $units/$name.pid ]]; then state=inactive/dead
    elif [[ ! -f $units/$name.rc ]]; then state=active/running
    elif [[ $(cat "$units/$name.rc") == 0 ]]; then state=active/exited
    else state=failed/failed; fi
    [[ $prop == ActiveState ]] && echo "\${state%/*}" || echo "\${state#*/}"
    ;;
  list-units)
    for pid in "$units"/*.pid; do
      [[ -e $pid ]] || continue
      name=$(basename "$pid" .pid)
      [[ $name == \${6%"*"}* ]] && echo "$name.service loaded active exited stub"
    done
    ;;
  stop | reset-failed)
    name=\${2%.service}
    echo "$1 $name" >> "$STUB_DIR/systemctl.log"
    [[ $1 == stop ]] && rm -f "$units/$name.pid" "$units/$name.rc"
    ;;
esac
exit 0
`;

// The real boxes run every step as the calling operator through `runuser -u`.
const RUNUSER_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/runuser.log"
[[ $1 == -u ]] && shift 2
[[ $1 == -- ]] && shift
exec "$@"
`;

let root;
let env;

function writeExecutable(path, text) {
  writeFileSync(path, text, { encoding: "utf8" });
  chmodSync(path, 0o755);
}

function setup() {
  root = mkdtempSync(join(tmpdir(), "ds-release-test-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  mkdirSync(join(root, "units"));
  writeExecutable(join(bin, "systemd-run"), SYSTEMD_RUN_STUB);
  writeExecutable(join(bin, "systemctl"), SYSTEMCTL_STUB);
  writeExecutable(join(bin, "runuser"), RUNUSER_STUB);
  env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    STUB_DIR: root,
    DS_RELEASE_STATE_ROOT: join(root, "state"),
    DS_RELEASE_LOCK_DIR: join(root, "lock"),
    DS_RELEASE_SELF: DS_RELEASE,
  };
}

function ds(args, extraEnv = {}) {
  const r = spawnSync("bash", [DS_RELEASE, ...args], {
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

function scriptFile(name, body) {
  const path = join(root, `${name}.sh`);
  writeFileSync(path, body, "utf8");
  return path;
}

function statusFile(releaseEnv, sha) {
  return join(root, "state", releaseEnv, `${sha}.json`);
}

function status(releaseEnv, sha) {
  const r = ds(["status", releaseEnv, sha]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
}

const pause = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The §5 shape — asserted on every read, so a torn or partial write would fail it.
function assertShape(doc, releaseEnv, sha) {
  assert.deepEqual(Object.keys(doc).sort(), [
    "env",
    "error",
    "sha",
    "startedAt",
    "state",
    "step",
    "steps",
    "unit",
    "updatedAt",
  ]);
  assert.equal(doc.env, releaseEnv);
  assert.equal(doc.sha, sha);
  assert.match(doc.state, /^(running|succeeded|failed|superseded)$/);
  assert.match(
    doc.unit,
    new RegExp(`^ds-${releaseEnv}-${sha.slice(0, 12)}-${doc.step}$`),
  );
  for (const item of doc.steps) {
    assert.deepEqual(Object.keys(item).sort(), [
      "endedAt",
      "name",
      "rc",
      "startedAt",
      "unit",
    ]);
  }
}

function readShape(releaseEnv, sha) {
  const doc = JSON.parse(readFileSync(statusFile(releaseEnv, sha), "utf8"));
  assertShape(doc, releaseEnv, sha);
  return doc;
}

function waitStep(releaseEnv, sha, step, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const doc = readShape(releaseEnv, sha);
    const item = doc.steps.find((s) => s.name === step);
    // The unit records its verdict before it exits: wait for both.
    const rcFile = join(
      root,
      "units",
      `ds-${releaseEnv}-${sha.slice(0, 12)}-${step}.rc`,
    );
    if (item?.endedAt && existsSync(rcFile)) return doc;
    if (Date.now() > deadline)
      throw new Error(`step ${step} never ended: ${JSON.stringify(doc)}`);
    pause(50);
  }
}

function startCount(unitPrefix) {
  const log = join(root, "systemd-run.log");
  if (!existsSync(log)) return 0;
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.startsWith(unitPrefix)).length;
}

describe(
  "ds-release (systemd stubbed)",
  { skip: !toolsPresent && "needs bash + flock + python3 + getent" },
  () => {
    before(setup);
    after(() => rmSync(root, { recursive: true, force: true }));

    it("starts a step in its own unit, records it atomically and never re-runs a succeeded step", () => {
      const counter = join(root, "backup-runs");
      const script = scriptFile("backup", `echo run >> "${counter}"\n`);
      const first = ds(["release", "prod", SHA_A, "backup", script]);
      assert.equal(first.code, 0, first.err);
      assert.match(first.out, /ds-prod-aaaaaaaaaaaa-backup started/);
      const doc = waitStep("prod", SHA_A, "backup");
      assert.equal(
        doc.state,
        "running",
        "the release stays open until `finish`",
      );
      assert.equal(doc.steps[0].rc, 0);
      assert.deepEqual(
        readdirSync(join(root, "state", "prod")).filter((f) =>
          f.endsWith(".tmp"),
        ),
        [],
        "no torn tmp file is left behind",
      );

      const again = ds(["release", "prod", SHA_A, "backup", script]);
      assert.equal(again.code, 0, again.err);
      assert.match(again.out, /succeeded \(recorded verdict; not re-run\)/);
      assert.equal(
        readFileSync(counter, "utf8"),
        "run\n",
        "the backup ran exactly once",
      );
      assert.equal(startCount("ds-prod-aaaaaaaaaaaa-backup"), 1);
    });

    it("attaches to a running step instead of starting a second unit", () => {
      const gate = join(root, "migrate-gate");
      const script = scriptFile(
        "migrate",
        `while [ ! -e "${gate}" ]; do sleep 0.05; done\n`,
      );
      assert.equal(ds(["release", "prod", SHA_A, "migrate", script]).code, 0);
      const polled = status("prod", SHA_A);
      assertShape(polled.release, "prod", SHA_A);
      assert.equal(polled.release.step, "migrate");
      assert.equal(polled.unitAlive, true);

      const attach = ds(["release", "prod", SHA_A, "migrate", script]);
      assert.equal(attach.code, 0, attach.err);
      assert.match(attach.out, /running \(attached\)/);
      assert.equal(startCount("ds-prod-aaaaaaaaaaaa-migrate"), 1);

      writeFileSync(gate, "");
      assert.equal(waitStep("prod", SHA_A, "migrate").steps.at(-1).rc, 0);
    });

    it("refuses a second SHA for the same env until the first release is finished", () => {
      const other = scriptFile("other", "true\n");
      const refused = ds(["release", "prod", SHA_B, "pull", other]);
      assert.equal(refused.code, 3);
      assert.match(refused.err, /leased by release aaaaaaaaaaaa/);
      assert.ok(
        !existsSync(statusFile("prod", SHA_B)),
        "nothing recorded for the refused SHA",
      );
      assert.equal(startCount("ds-prod-bbbbbbbbbbbb"), 0);

      // Another env is independent.
      const stage = ds(["release", "stage-pr-12", SHA_B, "pull", other]);
      assert.equal(stage.code, 0, stage.err);

      const finished = ds(["finish", "prod", SHA_A, "succeeded"]);
      assert.equal(finished.code, 0, finished.err);
      assert.equal(readShape("prod", SHA_A).state, "succeeded");
      rmSync(join(root, "systemctl.log"), { force: true });
      const next = ds(["release", "prod", SHA_B, "pull", other]);
      assert.equal(next.code, 0, next.err);
      waitStep("prod", SHA_B, "pull");
      const reaped = readFileSync(join(root, "systemctl.log"), "utf8");
      assert.match(
        reaped,
        /stop ds-prod-aaaaaaaaaaaa-backup/,
        "finished units of the old SHA are reaped",
      );
      assert.doesNotMatch(
        reaped,
        /ds-stage-pr-12-/,
        "another env's units are never touched",
      );
    });

    it("refuses while another ds-release call holds the env lock", () => {
      mkdirSync(join(root, "lock"), { recursive: true });
      const held = spawnSync(
        "bash",
        [
          "-c",
          `exec 9>"${join(root, "lock", "ds-stage-main.lock")}"; flock -n 9; bash "${DS_RELEASE}" release stage-main ${SHA_A} up "${scriptFile("up", "true\n")}"`,
        ],
        { env, encoding: "utf8" },
      );
      assert.equal(held.status, 3);
      assert.match(held.stderr, /env stage-main is busy/);
    });

    it("returns a failed step's verdict and re-runs it only with --retry-failed", () => {
      const flag = join(root, "prune-ok");
      const script = scriptFile("prune", `[ -e "${flag}" ] || exit 7\n`);
      assert.equal(ds(["release", "prod", SHA_B, "prune", script]).code, 0);
      const doc = waitStep("prod", SHA_B, "prune");
      assert.equal(doc.state, "running", "a failed step leaves the release open until `finish`");
      assert.equal(doc.steps.at(-1).rc, 7);
      assert.match(doc.error, /prune exited 7/);

      const plain = ds(["release", "prod", SHA_B, "prune", script]);
      assert.equal(plain.code, 1);
      assert.match(plain.err, /failed \(recorded verdict; not re-run\)/);
      assert.equal(startCount("ds-prod-bbbbbbbbbbbb-prune"), 1);
      assert.equal(
        ds(["finish", "prod", SHA_B, "succeeded"]).code,
        3,
        "no success over a failed step",
      );

      writeFileSync(flag, "");
      const retry = ds([
        "release",
        "--retry-failed",
        "prod",
        SHA_B,
        "prune",
        script,
      ]);
      assert.equal(retry.code, 0, retry.err);
      const retried = waitStep("prod", SHA_B, "prune");
      assert.equal(retried.steps.at(-1).rc, 0);
      assert.equal(retried.state, "running");
      assert.equal(retried.steps.filter((s) => s.name === "prune").length, 1);
      assert.equal(ds(["finish", "prod", SHA_B, "succeeded"]).code, 0);
    });

    it("records a unit that died without a verdict as failed", () => {
      const script = scriptFile("lost", "true\n");
      const started = ds(["release", "stage-main", SHA_A, "verify", script], {
        STUB_DEAD_ON_START: "1",
      });
      assert.equal(started.code, 0, started.err);
      const polled = status("stage-main", SHA_A);
      assert.equal(polled.release.state, "running");
      assert.equal(
        polled.unitAlive,
        false,
        "the poller is told the unit is gone",
      );

      const settled = ds(["release", "stage-main", SHA_A, "verify", script]);
      assert.equal(settled.code, 1);
      const doc = readShape("stage-main", SHA_A);
      assert.equal(doc.state, "running");
      assert.equal(doc.steps.at(-1).rc, -1);
      assert.match(doc.error, /ended without recording a verdict/);
    });

    it("forgets an env's state only while none of its steps runs", () => {
      const gate = join(root, "seed-gate");
      const script = scriptFile(
        "seed",
        `while [ ! -e "${gate}" ]; do sleep 0.05; done\n`,
      );
      assert.equal(
        ds(["release", "stage-pr-7", SHA_A, "seed", script]).code,
        0,
      );
      const refused = ds(["forget", "stage-pr-7"]);
      assert.equal(refused.code, 3);
      assert.match(
        refused.err,
        /ds-stage-pr-7-aaaaaaaaaaaa-seed is still running/,
      );

      writeFileSync(gate, "");
      waitStep("stage-pr-7", SHA_A, "seed");
      const forgot = ds(["forget", "stage-pr-7"]);
      assert.equal(forgot.code, 0, forgot.err);
      assert.ok(!existsSync(join(root, "state", "stage-pr-7")));
      assert.deepEqual(status("stage-pr-7", SHA_A), {
        release: null,
        unitAlive: null,
      });
    });

    it("rejects malformed arguments before touching any state", () => {
      const script = scriptFile("noop", "true\n");
      assert.equal(ds(["release", "production", SHA_A, "up", script]).code, 2);
      assert.equal(ds(["release", "prod", "abc123", "up", script]).code, 2);
      assert.equal(ds(["release", "prod", SHA_A, "Up;rm", script]).code, 2);
      assert.equal(ds(["finish", "prod", SHA_A, "maybe"]).code, 2);
      assert.equal(ds(["bogus"]).code, 2);
    });
  },
);

function editRecord(releaseEnv, sha, patch) {
  const path = statusFile(releaseEnv, sha);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...doc, ...patch }), "utf8");
}

const runs = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

describe(
  "ds-release attempts, rollback and robustness (systemd stubbed)",
  { skip: !toolsPresent && "needs bash + flock + python3 + getent" },
  () => {
    before(setup);
    after(() => rmSync(root, { recursive: true, force: true }));

    it("re-deploys a SHA after a rollback off it: B → rollback A → B runs every step again", () => {
      const counter = join(root, "migrate-b-runs");
      const up = scriptFile("up-a", "true\n");
      const migrate = scriptFile("migrate-b", `echo run >> "${counter}"\n`);
      assert.equal(ds(["release", "prod", SHA_A, "up", up]).code, 0);
      waitStep("prod", SHA_A, "up");
      assert.equal(ds(["finish", "prod", SHA_A, "succeeded"]).code, 0);

      assert.equal(ds(["release", "prod", SHA_B, "migrate", migrate]).code, 0);
      waitStep("prod", SHA_B, "migrate");
      assert.equal(readShape("prod", SHA_A).state, "superseded", "a new SHA supersedes the last one");
      assert.equal(ds(["finish", "prod", SHA_B, "failed"]).code, 0, "smoke RED closes B as failed");

      const marker = join(root, "rolled-back");
      const rollback = ds(["supersede", "prod", scriptFile("rollback-up", `echo "$HOME" > "${marker}"\n`)]);
      assert.equal(rollback.code, 0, rollback.err);
      assert.ok(existsSync(marker), "the rollback script ran under the env lock");
      assert.equal(readShape("prod", SHA_B).state, "superseded");

      const again = ds(["release", "prod", SHA_B, "migrate", migrate]);
      assert.equal(again.code, 0, again.err);
      assert.match(again.out, /ds-prod-bbbbbbbbbbbb-migrate started/);
      const fresh = waitStep("prod", SHA_B, "migrate");
      assert.equal(fresh.state, "running");
      assert.equal(fresh.steps.length, 1);
      assert.equal(runs(counter), "run\nrun\n", "a fresh attempt re-runs the step");
      const archived = readdirSync(join(root, "state", "prod")).filter(
        (f) =>
          f.startsWith(`${SHA_B}.`) &&
          f.endsWith(".json") &&
          f !== `${SHA_B}.json`,
      );
      assert.equal(archived.length, 1, "the closed attempt is archived, not lost");
      const old = JSON.parse(readFileSync(join(root, "state", "prod", archived[0]), "utf8"));
      assert.equal(old.state, "superseded");
      assert.equal(ds(["finish", "prod", SHA_B, "succeeded"]).code, 0);
    });

    it("converges stage back to an earlier SHA: B → C → B runs `up` again", () => {
      const counter = join(root, "up-runs");
      const up = scriptFile("up-stage", `echo run >> "${counter}"\n`);
      for (const sha of [SHA_B, SHA_C, SHA_B]) {
        const r = ds(["release", "stage-main", sha, "up", up]);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /started/);
        waitStep("stage-main", sha, "up");
        assert.equal(ds(["finish", "stage-main", sha, "succeeded"]).code, 0);
      }
      assert.equal(runs(counter), "run\nrun\nrun\n");
      assert.equal(readShape("stage-main", SHA_C).state, "superseded");
      assert.equal(readShape("stage-main", SHA_B).state, "succeeded");
    });

    it("refuses a rollback, a check and any other SHA's start while a unit runs — and never reaps it", () => {
      const gate = join(root, "seed3-gate");
      const seed = scriptFile("seed3", `while [ ! -e "${gate}" ]; do sleep 0.05; done\n`);
      assert.equal(ds(["release", "stage-pr-3", SHA_A, "seed", seed]).code, 0);
      const marker = join(root, "rollback3");
      const refused = ds(["supersede", "stage-pr-3", scriptFile("rb3", `touch "${marker}"\n`)]);
      assert.equal(refused.code, 3);
      assert.match(refused.err, /ds-stage-pr-3-aaaaaaaaaaaa-seed\.service is still running/);
      assert.ok(!existsSync(marker), "nothing ran");
      assert.equal(readShape("stage-pr-3", SHA_A).state, "running", "nothing changed");
      const check = ds(["check", "stage-pr-3"]);
      assert.equal(check.code, 3);
      assert.match(check.err, /ds-stage-pr-3-aaaaaaaaaaaa-seed\.service is still running/);

      // Even with its record closed under it, a live unit of another SHA blocks a start.
      editRecord("stage-pr-3", SHA_A, { state: "failed" });
      rmSync(join(root, "systemctl.log"), { force: true });
      const other = ds(["release", "stage-pr-3", SHA_B, "pull", scriptFile("p3", "true\n")]);
      assert.equal(other.code, 3);
      assert.match(other.err, /ds-stage-pr-3-aaaaaaaaaaaa-seed\.service is still running/);
      assert.ok(!existsSync(statusFile("stage-pr-3", SHA_B)));
      assert.doesNotMatch(runs(join(root, "systemctl.log")), /ds-stage-pr-3-aaaaaaaaaaaa-seed/);

      writeFileSync(gate, "");
      waitStep("stage-pr-3", SHA_A, "seed");
      assert.equal(ds(["check", "stage-pr-3"]).code, 0);
    });

    it("names a corrupt status file instead of a traceback", () => {
      const dir = join(root, "state", "stage-pr-9");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${SHA_A}.json`), "{not json", "utf8");
      for (const args of [
        ["status", "stage-pr-9", SHA_A],
        ["release", "stage-pr-9", SHA_A, "up", scriptFile("up9", "true\n")],
      ]) {
        const r = ds(args);
        assert.notEqual(r.code, 0);
        assert.match(r.err, /^ds-release: corrupt status file .*stage-pr-9\/a{40}\.json/m);
        assert.doesNotMatch(r.err, /Traceback/);
      }
    });

    it("writes every record through a unique temp file", () => {
      const dir = join(root, "state", "stage-pr-11");
      mkdirSync(join(dir, `${SHA_A}.json.tmp`), { recursive: true });
      const r = ds(["release", "stage-pr-11", SHA_A, "up", scriptFile("up11", "true\n")]);
      assert.equal(r.code, 0, r.err);
      assert.equal(waitStep("stage-pr-11", SHA_A, "up").steps[0].rc, 0);
    });

    it("runs the step as the calling operator through runuser, as on the real boxes", () => {
      const out = join(root, "runuser-out");
      const script = scriptFile("up13", `echo "$HOME $USER" > "${out}"\n`);
      const r = ds(["release", "stage-pr-13", SHA_A, "up", script], { SUDO_USER: "dsop" });
      assert.equal(r.code, 0, r.err);
      assert.equal(waitStep("stage-pr-13", SHA_A, "up").steps[0].rc, 0);
      assert.match(runs(join(root, "runuser.log")), /^-u dsop -- env HOME=\/ USER=dsop LOGNAME=dsop bash --norc/m);
      assert.equal(runs(out), "/ dsop\n");
    });
  },
);
