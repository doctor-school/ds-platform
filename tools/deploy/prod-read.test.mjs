// Issue #3646: the prod read path's runner side (prod-observe.yml) and operator
// commands (spec §4 «Prod read results leave only encrypted.», §5 «Prod read verbs.», §10).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  checkCapabilities,
  checkInputs,
  failureReason,
  hostStateLines,
  READ_REASONS,
  REHEARSAL_POLL_CAP_SEC,
  REHEARSAL_STATES,
  readKey,
  readRun,
  answerOf,
  resultKey,
  releaseJournalLines,
  stateWord,
  statusLine,
} from "./lib/prod-read.mjs";
import { newestSnapshot, sha256 } from "./lib/schema-drift.mjs";
import { schemaDrift } from "./prod-read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const SHA = "a".repeat(40);

const real = (cmd, args, { input, cwd } = {}) => {
  const r = spawnSync(cmd, args, { input, cwd });
  return {
    status: r.error ? 127 : r.status,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: String(r.stderr ?? r.error?.message ?? ""),
  };
};

describe("3646: the runner-side input shape check", () => {
  it("accepts each verb in its own shape and builds the one command", () => {
    assert.deepEqual(checkInputs({ verb: "schema", params: "{}" }), {
      ok: true,
      command: "schema",
      stdin: null,
    });
    assert.deepEqual(checkInputs({ verb: "schema" }), {
      ok: true,
      command: "schema",
      stdin: null,
    });
    assert.deepEqual(
      checkInputs({
        verb: "observe",
        name: "signups-by-day",
        params: '{"from":"2026-10-01"}',
      }),
      {
        ok: true,
        command: "observe signups-by-day",
        stdin: '{"from":"2026-10-01"}',
      },
    );
    assert.deepEqual(
      checkInputs({ verb: "rehearse", sha: SHA, params: "{}" }),
      { ok: true, command: `rehearse ${SHA}`, stdin: null },
    );
    assert.deepEqual(checkInputs({ verb: "rehearse-restore", sha: SHA }), {
      ok: true,
      command: `rehearse-restore ${SHA}`,
      stdin: null,
    });
    assert.deepEqual(checkInputs({ verb: "rehearsal-status", sha: SHA }), {
      ok: true,
      command: `rehearsal-status ${SHA}`,
      stdin: null,
    });
    assert.deepEqual(checkInputs({ verb: "release-journal", sha: SHA }), {
      ok: true,
      command: `release-journal ${SHA}`,
      stdin: null,
    });
    assert.deepEqual(checkInputs({ verb: "host-state" }), { ok: true, command: "host-state", stdin: null });
  });
  for (const [what, inputs] of [
    ["an unknown verb", { verb: "release" }],
    ["schema with a name", { verb: "schema", name: "x" }],
    ["release-journal without a sha", { verb: "release-journal" }],
    ["release-journal with a short sha", { verb: "release-journal", sha: SHA.slice(0, 12) }],
    ["release-journal with a name", { verb: "release-journal", name: "x", sha: SHA }],
    ["schema with a sha", { verb: "schema", sha: SHA }],
    ["host-state with a sha", { verb: "host-state", sha: SHA }],
    ["host-state with a name", { verb: "host-state", name: "x" }],
    ["host-state with params", { verb: "host-state", params: '{"a":1}' }],
    ["schema with params", { verb: "schema", params: '{"a":1}' }],
    ["observe without a name", { verb: "observe" }],
    ["observe with a shell name", { verb: "observe", name: "x; rm -rf /" }],
    ["observe with an uppercase name", { verb: "observe", name: "Signups" }],
    ["observe with array params", { verb: "observe", name: "x", params: "[]" }],
    [
      "observe with non-JSON params",
      { verb: "observe", name: "x", params: "{a" },
    ],
    [
      "observe with params over 4 KiB",
      {
        verb: "observe",
        name: "x",
        params: JSON.stringify({ a: "x".repeat(4096) }),
      },
    ],
    ["rehearse with a short sha", { verb: "rehearse", sha: "abc123" }],
    [
      "rehearse with an uppercase sha",
      { verb: "rehearse", sha: "A".repeat(40) },
    ],
    ["rehearse with a name", { verb: "rehearse", sha: SHA, name: "x" }],
  ]) {
    it(`refuses ${what}`, () => assert.equal(checkInputs(inputs).ok, false));
  }
});

test("3646: capabilities must be the prod read entrypoint naming the verb", () => {
  const caps = JSON.stringify({
    role: "prod",
    mode: "read",
    verbs: ["capabilities", "schema"],
  });
  assert.deepEqual(checkCapabilities(caps, "schema"), { ok: true });
  assert.match(
    checkCapabilities(caps, "observe").error,
    /does not serve observe \(it serves: capabilities, schema\)/,
  );
  assert.equal(
    checkCapabilities(
      JSON.stringify({ role: "stage", mode: "read", verbs: ["schema"] }),
      "schema",
    ).ok,
    false,
  );
  assert.equal(checkCapabilities("not json", "schema").ok, false);
});

describe("4067: release-journal — the job prints status lines only, the operator reads the journal", () => {
  const cms = Buffer.from([0x30, 0x82, 0x01, 0x00, 0xaa]);
  it("the job's line is verb, rc, size and sha256 — no journal text", () => {
    const r = statusLine({ verb: "release-journal", rc: 0, cms, stderr: "ds-api-prod node[1]: PASSWORD=x\n" });
    assert.equal(r.upload, true);
    assert.equal(r.failed, false);
    assert.equal(r.line, `prod-observe: verb=release-journal rc=0 bytes=5 sha256=${sha256(cms)}`);
  });
  it("pnpm prod:read prints the failure note, then each unit's tail, control characters dropped", () => {
    const answer = {
      verb: "release-journal",
      sha: SHA,
      takenAt: "2026-11-16T00:00:00Z",
      failure: { phase: "postgres-verify", reason: "unexpected error — see the box journal" },
      units: [
        { unit: "ds-prod-aaaaaaaaaaaa-driver", lines: ["a", "PostgreSQL guard: refused\u001b[31m"], truncated: true },
        { unit: "ds-prod-aaaaaaaaaaaa-migrate", lines: [], truncated: false },
      ],
    };
    assert.deepEqual(releaseJournalLines(answer), [
      `release ${SHA} journal, taken 2026-11-16T00:00:00Z`,
      "failure: phase postgres-verify — unexpected error — see the box journal",
      "",
      "== ds-prod-aaaaaaaaaaaa-driver (2 lines, the tail only)",
      "a",
      "PostgreSQL guard: refused[31m",
      "",
      "== ds-prod-aaaaaaaaaaaa-migrate (0 lines)",
    ]);
    assert.equal(releaseJournalLines({ ...answer, failure: null, units: [] })[1], "failure: no note recorded");
    // C1 controls (U+009B is a one-byte CSI) are dropped too, in the note and the unit name alike
    const c1 = releaseJournalLines({
      ...answer,
      failure: { phase: "postgres\u009b2J-verify", reason: "refused\u001b]0;x\u0007\u0085" },
      units: [{ unit: "ds-prod-aaaaaaaaaaaa-\u009bdriver", lines: ["b\u009b31m\u0090q\u009f"], truncated: false }],
    });
    assert.deepEqual(c1.slice(1), [
      "failure: phase postgres2J-verify — refused]0;x",
      "",
      "== ds-prod-aaaaaaaaaaaa-driver (1 lines)",
      "b31mq",
    ]);
    assert.throws(() => releaseJournalLines({ verb: "schema" }), /not a release-journal answer/);
  });
  it("4280: a unit the read could not reach prints its fixed reason, never as an empty journal", () => {
    const lines = releaseJournalLines({
      verb: "release-journal",
      sha: SHA,
      takenAt: "2026-11-26T00:00:00Z",
      failure: null,
      units: [
        { unit: "ds-prod-aaaaaaaaaaaa-api-secret", lines: [], truncated: false },
        { unit: "ds-prod-aaaaaaaaaaaa-data-secret", lines: [], truncated: false, reason: "ds-data-prod is unreachable[2J" },
      ],
    });
    assert.deepEqual(lines.slice(2), [
      "",
      "== ds-prod-aaaaaaaaaaaa-api-secret (0 lines)",
      "",
      "== ds-prod-aaaaaaaaaaaa-data-secret (not read — ds-data-prod is unreachable[2J)",
    ]);
  });
});

describe("4144: host-state — the operator reads both boxes' host state", () => {
  const GiB = 1024 ** 3;
  const vol = (mount, total, used) => ({
    mount,
    bytesTotal: total * GiB,
    bytesUsed: used * GiB,
    bytesFree: (total - used) * GiB,
    inodesTotal: 1000,
    inodesUsed: 250,
    inodesFree: 750,
  });
  const box = (role, extra = {}) => ({
    role,
    takenAt: "2026-11-18T00:00:00Z",
    uptime: { seconds: 90061 },
    resolver: { nameservers: ["127.0.0.53"], upstream: ["1.1.1.1", "8.8.8.8"], probeName: "s3.twcstorage.ru", probeResolves: true },
    selfHostname: { hostname: `${role}-host`, getentResolves: true, inEtcHosts: true },
    disk: { root: vol("/", 40, 10) },
    ...extra,
  });
  const answer = {
    verb: "host-state",
    takenAt: "2026-11-18T00:00:01Z",
    api: box("api"),
    data: box("data", {
      selfHostname: { hostname: "8529185-kw435155.twc1.net", getentResolves: false, inEtcHosts: false },
      resolver: { nameservers: ["1.1.1.1"], upstream: { error: "resolvectl failed" }, probeName: "s3.twcstorage.ru", probeResolves: false },
      disk: { root: vol("/", 40, 10), postgresData: vol("/", 40, 10) },
      archiver: { archivedCount: 42, failedCount: 1, lastArchivedTime: "2026-11-17T18:59:01Z", lastFailedTime: "2026-11-17T10:20:00Z", lastFailedWal: "00000001000000000000002A" },
      pgbackrest: { version: "pgBackRest 2.60.0" },
      offsite: [
        { repo: 2, host: "s3.ap-southeast-2.idrivee2.com", state: "tcp-refused", http: null },
        { repo: 3, host: "s3.onidel.test", state: "reachable", http: 403 },
      ],
    }),
  };
  it("prints each box's fields, one line per probe", () => {
    assert.deepEqual(hostStateLines(answer), [
      "host state, taken 2026-11-18T00:00:01Z",
      "",
      "== ds-api-prod (taken 2026-11-18T00:00:00Z)",
      "uptime: 90061 s (1 d 1 h)",
      "resolver: nameservers 127.0.0.53; upstream 1.1.1.1, 8.8.8.8; s3.twcstorage.ru resolves: yes",
      "self-hostname: api-host; getent: yes; /etc/hosts: yes",
      "disk /: 10.0 GiB used of 40.0 GiB (25%), 30.0 GiB free; inodes 250 used of 1000, 750 free (mount /)",
      "",
      "== ds-data-prod (taken 2026-11-18T00:00:00Z)",
      "uptime: 90061 s (1 d 1 h)",
      "resolver: nameservers 1.1.1.1; upstream error — resolvectl failed; s3.twcstorage.ru resolves: NO",
      "self-hostname: 8529185-kw435155.twc1.net; getent: NO; /etc/hosts: NO",
      "disk /: 10.0 GiB used of 40.0 GiB (25%), 30.0 GiB free; inodes 250 used of 1000, 750 free (mount /)",
      "disk postgres data: 10.0 GiB used of 40.0 GiB (25%), 30.0 GiB free; inodes 250 used of 1000, 750 free (mount /)",
      "pg_stat_archiver: archived 42, last 2026-11-17T18:59:01Z; failed 1, last 2026-11-17T10:20:00Z (00000001000000000000002A)",
      "pgbackrest: pgBackRest 2.60.0",
      "offsite repo2 s3.ap-southeast-2.idrivee2.com: tcp-refused http=-",
      "offsite repo3 s3.onidel.test: reachable http=403",
    ]);
  });
  it("4280: prints a failed offsite probe and no endpoint by their fixed lines; rejects an unlisted repo field", () => {
    const withOffsite = (offsite) => hostStateLines({ ...answer, data: { ...answer.data, offsite } });
    assert.equal(withOffsite({ error: "probe failed" }).at(-1), "offsite: error — probe failed");
    assert.equal(withOffsite([]).at(-1), "offsite: no repo endpoint set");
    assert.throws(
      () => withOffsite([{ ...answer.data.offsite[0], key: "x" }]),
      /unlisted or missing field/,
    );
    assert.throws(() => withOffsite("reachable"), /unlisted or missing field/);
    assert.equal(
      withOffsite([{ repo: 3, host: null, state: "endpoint-unparsed", http: null }]).at(-1),
      "offsite repo3: endpoint-unparsed (not an https host[:port])",
    );
  });
  it("prints a probe's error and an unreachable data box by their fixed reasons", () => {
    const lines = hostStateLines({
      ...answer,
      api: { ...answer.api, uptime: { error: "uptime unreadable" } },
      data: { reachable: false, reason: "ds-data-prod is unreachable" },
    });
    assert.ok(lines.includes("uptime: error — uptime unreadable"));
    assert.equal(lines.at(-1), "== ds-data-prod: not read — ds-data-prod is unreachable");
  });
  for (const [what, bad] of [
    ["a top-level field", { ...answer, env: "x" }],
    ["a box field", { ...answer, api: { ...answer.api, environment: {} } }],
    ["a Postgres field on the api box", { ...answer, api: { ...answer.api, archiver: answer.data.archiver } }],
    ["a probe field", { ...answer, data: { ...answer.data, archiver: { ...answer.data.archiver, password: "x" } } }],
    ["a disk field", { ...answer, api: { ...answer.api, disk: { ...answer.api.disk, home: vol("/home", 1, 0) } } }],
    ["a field beside an error", { ...answer, api: { ...answer.api, uptime: { error: "x", seconds: 1 } } }],
  ]) {
    it(`rejects an answer with an unlisted field: ${what}`, () =>
      assert.throws(() => hostStateLines(bad), /not a host-state answer: unlisted or missing field/));
  }
  it("rejects a non-host-state answer", () =>
    assert.throws(() => hostStateLines({ verb: "schema" }), /not a host-state answer/));
});

describe("3646: status lines only — verb, rc, size and sha256, or one fixed reason", () => {
  const cms = Buffer.from([0x30, 0x82, 0x01, 0x00, 0xaa]);
  it("a success names size and sha256 of the ciphertext and allows the upload", () => {
    const r = statusLine({ verb: "schema", rc: 0, cms, stderr: "" });
    assert.equal(r.upload, true);
    assert.equal(
      r.line,
      `prod-observe: verb=schema rc=0 bytes=5 sha256=${sha256(cms)}`,
    );
  });
  it("a plaintext answer (not DER CMS) is never uploaded", () => {
    const r = statusLine({
      verb: "schema",
      rc: 0,
      cms: Buffer.from('{"verb":"schema"}'),
      stderr: "",
    });
    assert.equal(r.upload, false);
    assert.match(r.line, /reason=the answer is not CMS ciphertext$/);
  });
  it("exit 1 carries only a fixed reason of READ_REASONS", () => {
    for (const reason of READ_REASONS)
      assert.equal(failureReason(1, `ds-read-entrypoint: ${reason}\n`), reason);
    assert.equal(
      failureReason(
        1,
        "ds-read-entrypoint: ERROR: relation users has 10234 rows\n",
      ),
      "the read failed",
    );
    assert.equal(
      failureReason(1, "psql: some secret text\n"),
      "the read failed",
    );
  });
  it("exit 2 / 3 carry the entrypoint's own line, bounded; ssh's own errors no text", () => {
    assert.equal(
      failureReason(
        3,
        "ds-read-entrypoint: ds-data-prod does not serve read-schema (the next release installs it)\n",
      ),
      "ds-data-prod does not serve read-schema (the next release installs it)",
    );
    assert.equal(
      failureReason(
        2,
        `ds-read-entrypoint: rejected: ${"x".repeat(400)}\u0007\n`,
      ).length,
      160,
    );
    assert.equal(
      failureReason(255, "Host key verification failed.\n"),
      "exited 255 without a reason",
    );
    const r = statusLine({
      verb: "schema",
      rc: 1,
      cms: Buffer.alloc(0),
      stderr: "ds-read-entrypoint: a release step is running\n",
    });
    assert.deepEqual(r, {
      upload: false,
      failed: true,
      line: "prod-observe: verb=schema rc=1 reason=a release step is running",
    });
  });
  it("3648: a rehearsal answer prints its state word, never more; one without a state is not uploaded", () => {
    for (const word of REHEARSAL_STATES)
      assert.equal(stateWord(`ds-read-entrypoint: state ${word}\n`), word);
    assert.equal(stateWord("ds-read-entrypoint: state migration 0042 failed\n"), null);
    assert.equal(stateWord("state succeeded\n"), null);
    const done = statusLine({
      verb: "rehearse",
      rc: 0,
      cms,
      stderr: "ds-read-entrypoint: state started\nds-read-entrypoint: state succeeded\n",
    });
    assert.deepEqual(done, {
      upload: true,
      failed: false,
      line: `prod-observe: verb=rehearse rc=0 state=succeeded bytes=5 sha256=${sha256(cms)}`,
    });
    const none = statusLine({ verb: "rehearse", rc: 0, cms, stderr: "ds-read-entrypoint: state no pending migrations\n" });
    assert.match(none.line, / state=no-pending-migrations /);
    assert.equal(none.failed, false);
    // Still running after the poll's cap: uploaded, but the job fails.
    const capped = statusLine({ verb: "rehearse", rc: 0, cms, stderr: "ds-read-entrypoint: state running\n" });
    assert.equal(capped.upload, true);
    assert.equal(capped.failed, true);
    const stateless = statusLine({ verb: "rehearsal-status", rc: 0, cms, stderr: "" });
    assert.equal(stateless.upload, false);
    assert.match(stateless.line, /reason=the answer carries no rehearsal state$/);
    const failed = statusLine({ verb: "rehearse", rc: 1, cms: Buffer.alloc(0), stderr: "ds-read-entrypoint: insufficient headroom (disk)\n" });
    assert.equal(failed.line, "prod-observe: verb=rehearse rc=1 reason=insufficient headroom (disk)");
  });
  it("3648: a rehearsal whose final state is `failed` uploads its report and fails the job, for every rehearsal verb", () => {
    for (const verb of ["rehearse", "rehearse-restore", "rehearsal-status"]) {
      const r = statusLine({ verb, rc: 0, cms, stderr: "ds-read-entrypoint: state running\nds-read-entrypoint: state failed\n" });
      assert.deepEqual(r, {
        upload: true,
        failed: true,
        line: `prod-observe: verb=${verb} rc=0 state=failed bytes=5 sha256=${sha256(cms)}`,
      }, verb);
      const ok = statusLine({ verb, rc: 0, cms, stderr: "ds-read-entrypoint: state succeeded\n" });
      assert.equal(ok.failed, false, verb);
    }
    const started = statusLine({ verb: "rehearse-restore", rc: 0, cms, stderr: "ds-read-entrypoint: state started\n" });
    assert.equal(started.failed, true, "a restore-only rehearsal still started after the poll's cap");
    const stateless = statusLine({ verb: "rehearse-restore", rc: 0, cms, stderr: "" });
    assert.equal(stateless.upload, false);
  });
});

describe("3646: prod-observe.yml", () => {
  const wf = parse(
    readFileSync(join(REPO, ".github/workflows/prod-observe.yml"), "utf8"),
  );
  const job = wf.jobs.read;
  const text = readFileSync(
    join(REPO, ".github/workflows/prod-observe.yml"),
    "utf8",
  );
  it("is a dispatch with the four verbs and the name / params / sha inputs", () => {
    const inputs = wf.on.workflow_dispatch.inputs;
    assert.deepEqual(inputs.verb.options, [
      "schema",
      "observe",
      "rehearse",
      "rehearse-restore",
      "rehearsal-status",
      "release-journal",
      "host-state",
    ]);
    assert.equal(inputs.params.default, "{}");
    assert.deepEqual(Object.keys(inputs), ["verb", "name", "params", "sha"]);
  });
  it("runs in Environment production-read without a Deployment record, its own concurrency group, never cancelled", () => {
    assert.deepEqual(job.environment, {
      name: "production-read",
      deployment: false,
    });
    assert.deepEqual(wf.concurrency, {
      group: "prod-observe",
      "cancel-in-progress": false,
    });
    assert.deepEqual(wf.permissions, { contents: "read" });
    assert.doesNotMatch(text, /group: deploy-prod/);
  });
  it("takes the read key from its secret and the host key from the Environment variable", () => {
    const write = job.steps.find((s) => s.name === "Write the ssh key");
    assert.equal(
      write.env.PROD_READ_SSH_KEY,
      "${{ secrets.PROD_READ_SSH_KEY }}",
    );
    assert.equal(
      write.env.PROD_SSH_KNOWN_HOSTS,
      "${{ vars.PROD_SSH_KNOWN_HOSTS }}",
    );
    assert.doesNotMatch(text, /secrets\.PROD_SSH_KEY\b/);
    const cleanup = job.steps.at(-1);
    assert.equal(cleanup.if, "always()");
    assert.match(cleanup.run, /prod-read-ssh/);
  });
  it("checks the inputs, then capabilities, before the read; uploads only the ciphertext for 1 day", () => {
    const names = job.steps.map((s) => s.name ?? s.uses);
    assert.ok(
      names.indexOf("Check the inputs") < names.indexOf("Write the ssh key"),
    );
    assert.ok(names.indexOf("Ask capabilities") < names.indexOf("Read"));
    const upload = job.steps.find((s) => s.name === "Upload the ciphertext");
    // A failed rehearsal fails the Read step and still uploads its report.
    assert.equal(upload.if, "!cancelled() && steps.read.outputs.upload == 'true'");
    assert.equal(upload.with.name, "prod-read-${{ github.run_id }}");
    assert.match(upload.with.path, /result\/result\.cms$/);
    assert.equal(upload.with["retention-days"], 1);
  });
  it("3648: a rehearse polls rehearsal-status up to the runtime cap and prints only the state word", () => {
    const read = job.steps.find((s) => s.name === "Read");
    assert.match(read.run, /if \{ \[ "\$VERB" = rehearse \] \|\| \[ "\$VERB" = rehearse-restore \]; \} && \[ "\$rc" -eq 0 \]; then/);
    assert.ok(read.run.includes(`deadline=$(( $(date +%s) + ${REHEARSAL_POLL_CAP_SEC} ))`), "the poll stops at the cap");
    assert.match(read.run, /"rehearsal-status \$\{COMMAND#\* \}" <\/dev\/null/);
    assert.match(read.run, /prod-read\.mjs state "\$RUNNER_TEMP\/read\.err"/);
    assert.match(read.run, /echo "prod-observe: rehearsal state=\$state"/);
    assert.ok(job["timeout-minutes"] * 60 > REHEARSAL_POLL_CAP_SEC + 5 * 60, "the job outlives the poll");
  });
  it("never prints the box's raw output: every ssh call redirects stdout and stderr to files", () => {
    for (const step of job.steps.filter((s) =>
      /\bssh -i\b/.test(s.run ?? ""),
    )) {
      assert.match(step.run, /2>"\$RUNNER_TEMP\/[a-z.]+"/, step.name);
      assert.match(step.run, />"\$RUNNER_TEMP\/[a-z./]+"/, step.name);
    }
  });
});

describe("3646: the operator commands", () => {
  let work;
  let home;
  let repo;
  before(() => {
    work = mkdtempSync(join(tmpdir(), "prod-read-test-"));
    home = join(work, "home");
    repo = join(work, "repo");
    mkdirSync(home);
    mkdirSync(repo);
  });
  after(() => rmSync(work, { recursive: true, force: true }));

  it("prod:read-result-key writes the key 0600 and the certificate, refuses to overwrite without --rotate", () => {
    const first = resultKey({ repoRoot: repo, home, run: real });
    assert.equal(
      first.keyPath,
      join(home, ".ds-platform", "prod-read-result.key"),
    );
    assert.match(readFileSync(first.keyPath, "utf8"), /BEGIN PRIVATE KEY/);
    assert.match(
      readFileSync(
        join(repo, "infra/deploy/keys/prod-read-recipient.pem"),
        "utf8",
      ),
      /^-----BEGIN CERTIFICATE-----/,
    );
    assert.doesNotMatch(
      readFileSync(
        join(repo, "infra/deploy/keys/prod-read-recipient.pem"),
        "utf8",
      ),
      /PRIVATE KEY/,
    );
    assert.match(first.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    if (process.platform !== "win32")
      assert.equal(statSync(first.keyPath).mode & 0o777, 0o600);
    assert.throws(
      () => resultKey({ repoRoot: repo, home, run: real }),
      /exists; pass --rotate/,
    );
    const rotated = resultKey({
      repoRoot: repo,
      home,
      rotate: true,
      run: real,
    });
    assert.notEqual(rotated.fingerprint, first.fingerprint);
  });

  it("prod:read downloads the artifact, decrypts the box's CMS framing into ~/.ds-platform/prod-read/<run-id>.json", () => {
    const answer = {
      verb: "schema",
      database: "ds_prod",
      takenAt: "2026-11-04T00:00:00Z",
      migrations: [],
      catalogue: { tables: [], enums: [], sequences: [] },
    };
    const plain = join(work, "answer.json");
    const cms = join(work, "result.cms");
    writeFileSync(plain, JSON.stringify(answer));
    // ds-read-entrypoint read_encrypted, verbatim.
    const enc = real("openssl", [
      "cms",
      "-encrypt",
      "-binary",
      "-aes-256-gcm",
      "-outform",
      "DER",
      "-in",
      plain,
      "-out",
      cms,
      join(repo, "infra/deploy/keys/prod-read-recipient.pem"),
    ]);
    assert.equal(enc.status, 0, enc.stderr);
    const calls = [];
    const run = (cmd, args, opts) => {
      calls.push([cmd, ...args]);
      if (cmd === "gh") {
        copyFileSync(cms, join(args[args.indexOf("-D") + 1], "result.cms"));
        return { status: 0, stdout: Buffer.alloc(0), stderr: "" };
      }
      return real(cmd, args, opts);
    };
    const r = readRun({ runId: "123456", home, repoRoot: repo, run });
    assert.deepEqual(calls[0].slice(0, 6), [
      "gh",
      "run",
      "download",
      "123456",
      "-n",
      "prod-read-123456",
    ]);
    assert.equal(
      r.path,
      join(home, ".ds-platform", "prod-read", "123456.json"),
    );
    assert.deepEqual(JSON.parse(readFileSync(r.path, "utf8")), answer);
    if (process.platform !== "win32")
      assert.equal(statSync(r.path).mode & 0o777, 0o600);
    assert.equal(
      existsSync(join(dirname(calls[0][calls[0].length - 1]), "result.cms")),
      false,
      "the download dir is removed",
    );
    // schema-drift reuses the decrypted answer, no second download.
    calls.length = 0;
    assert.deepEqual(
      answerOf({ runId: "123456", home, repoRoot: repo, run }).answer,
      answer,
    );
    assert.equal(calls.length, 0);
  });

  it("prod:read refuses a bad run id, a missing key, a failed download", () => {
    assert.throws(
      () => readRun({ runId: "12; rm", home, repoRoot: repo }),
      /usage/,
    );
    assert.throws(
      () => readRun({ runId: "1", home: join(work, "nohome"), repoRoot: repo }),
      /result key .* is missing/,
    );
    const run = () => ({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: "no artifact matches\n",
    });
    assert.throws(
      () => readRun({ runId: "1", home, repoRoot: repo, run }),
      /gh run download failed \(exit 1\): no artifact matches/,
    );
  });

  it("prod:read-key sets the private half as PROD_READ_SSH_KEY of production-read and writes only the public half", () => {
    const calls = [];
    let secret = null;
    const run = (cmd, args, opts = {}) => {
      calls.push([cmd, ...args]);
      if (cmd === "gh") {
        secret = String(opts.input);
        return { status: 0, stdout: Buffer.alloc(0), stderr: "" };
      }
      return real(cmd, args, opts);
    };
    const { pubkeyPath } = readKey({ repoRoot: repo, run });
    assert.deepEqual(
      calls.find(([c]) => c === "gh"),
      ["gh", "secret", "set", "PROD_READ_SSH_KEY", "--env", "production-read"],
    );
    assert.match(secret, /BEGIN OPENSSH PRIVATE KEY/);
    const pub = readFileSync(pubkeyPath, "utf8");
    assert.equal(pubkeyPath, join(repo, "infra/deploy/keys/prod-read.pub"));
    assert.match(pub, /^ssh-ed25519 [A-Za-z0-9+/]+=* gha-prod-read\n$/);
    const keyDir = dirname(calls[0].at(-1));
    assert.equal(existsSync(keyDir), false, "the key directory is deleted");
  });

  it("prod:read-key writes no public half when gh refuses the secret", () => {
    rmSync(join(repo, "infra/deploy/keys/prod-read.pub"), { force: true });
    const run = (cmd, args, opts) =>
      cmd === "gh"
        ? { status: 1, stdout: Buffer.alloc(0), stderr: "HTTP 404\n" }
        : real(cmd, args, opts);
    assert.throws(
      () => readKey({ repoRoot: repo, run }),
      /gh secret set PROD_READ_SSH_KEY failed/,
    );
    assert.equal(
      existsSync(join(repo, "infra/deploy/keys/prod-read.pub")),
      false,
    );
  });
});

test("3646: prod:schema-drift compares against the checked-out journal and newest snapshot", () => {
  const meta = join(REPO, "apps/api/drizzle/meta");
  const journal = JSON.parse(readFileSync(join(meta, "_journal.json"), "utf8"));
  const migrations = journal.entries.map((e, i) => ({
    id: i + 1,
    hash: sha256(
      readFileSync(join(REPO, "apps/api/drizzle", `${e.tag}.sql`), "utf8"),
    ),
    created_at: String(e.when),
  }));
  const answer = {
    verb: "schema",
    migrations,
    catalogue: { tables: [], enums: [] },
  };
  const d = schemaDrift({ answer, root: REPO });
  assert.match(d.snapshot, /^\d{4}_snapshot\.json$/);
  assert.deepEqual(d.migrations, []);
  assert.ok(d.catalogue.some((l) => l.startsWith("table missing: public.")));
  const pending = schemaDrift({
    answer: { ...answer, migrations: migrations.slice(0, -1) },
    root: REPO,
  });
  assert.deepEqual(pending.migrations, [
    `migration pending: ${journal.entries.at(-1).tag} (when ${journal.entries.at(-1).when})`,
  ]);
  assert.throws(
    () => schemaDrift({ answer: { verb: "observe" }, root: REPO }),
    /not a schema answer/,
  );
});

test("3648: prod:schema-drift compares a rehearsal report's catalogueAfter, and refuses a report without one", () => {
  const report = {
    verb: "rehearse",
    sha: SHA,
    pending: 1,
    migrations: [],
    catalogueAfter: { tables: [], enums: [] },
    state: "succeeded",
  };
  const d = schemaDrift({ answer: report, root: REPO });
  assert.deepEqual(d.migrations, [], "a report has no applied-migrations list");
  assert.ok(d.catalogue.some((l) => l.startsWith("table missing: public.")));
  for (const answer of [
    { ...report, catalogueAfter: null, state: "failed" },
    { ...report, catalogueAfter: null, pending: 0 },
  ]) {
    assert.throws(() => schemaDrift({ answer, root: REPO }), /carries no catalogueAfter/);
  }
});

test("3683: prod:schema-drift accepts the indexes the tree's migration SQL writes by hand", () => {
  const meta = join(REPO, "apps/api/drizzle/meta");
  const journal = JSON.parse(readFileSync(join(meta, "_journal.json"), "utf8"));
  const snapshot = JSON.parse(
    readFileSync(join(meta, newestSnapshot(readdirSync(meta))), "utf8"),
  );
  const directions = Object.values(snapshot.tables).find(
    (x) => x.name === "directions",
  );
  const table = (extra) => ({
    schema: "public",
    name: "directions",
    columns: [],
    indexes: [
      {
        name: extra,
        definition: `CREATE INDEX ${extra} ON public.directions USING gin (slug gin_trgm_ops)`,
      },
    ],
    constraints: [],
  });
  assert.ok(directions, "the snapshot has public.directions");
  const lines = (extra) =>
    schemaDrift({
      answer: {
        verb: "schema",
        migrations: [],
        catalogue: { tables: [table(extra)], enums: [] },
      },
      root: REPO,
    }).catalogue.filter((l) => l.startsWith("index extra:"));
  assert.ok(journal.entries.length > 0);
  assert.deepEqual(lines("directions_slug_trgm_idx"), []);
  assert.deepEqual(lines("directions_stray_idx"), [
    "index extra: public.directions directions_stray_idx",
  ]);
});
