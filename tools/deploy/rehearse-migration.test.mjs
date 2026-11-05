// Issue #3648: the migration rehearsal harness of ds-data-prod (spec
// apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §5
// «Migration rehearsal.»). Pure functions through a python import; the verbs end to
// end under a test root with the box tools faked (rehearse-migration-fake.py).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const HARNESS = resolve(here, "../../infra/deploy/bin/rehearse-migration.py");
const ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint");
const FAKE = resolve(here, "rehearse-migration-fake.py");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const SHA12 = SHA.slice(0, 12);
const PYTHON = ["python3", "python"].find(
  (p) => spawnSync(p, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);
const SKIP = !PYTHON && "needs python3";

/** Call one harness function with JSON arguments; its JSON result. */
function call(fn, ...args) {
  const code = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('rm', sys.argv[1])",
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "args = json.loads(sys.stdin.read())",
    "try:",
    "    print(json.dumps(getattr(m, sys.argv[2])(*args)))",
    "except m.Stop as e:",
    "    print(json.dumps({'stop': e.code, 'reason': e.reason}))",
  ].join("\n");
  const r = spawnSync(PYTHON, ["-I", "-X", "utf8", "-c", code, HARNESS, fn], {
    input: JSON.stringify(args),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

describe("3648: the harness's pure functions", { skip: SKIP }, () => {
  const journal = {
    entries: [
      { idx: 0, when: 1000, tag: "0000_init", breakpoints: true },
      { idx: 1, when: 2000, tag: "0001_users", breakpoints: true },
      { idx: 2, when: 3000, tag: "0002_index", breakpoints: true },
    ],
  };
  it("pending = the journal entries whose `when` is newer than the newest applied created_at", () => {
    assert.deepEqual(call("pending_migrations", journal, 2000), [{ tag: "0002_index", when: 3000 }]);
    assert.deepEqual(call("pending_migrations", journal, "1999").map((p) => p.tag), ["0001_users", "0002_index"]);
    assert.deepEqual(call("pending_migrations", journal, 3000), [], "equal is applied, as the migrator reads it");
    assert.equal(call("pending_migrations", journal, null).length, 3, "nothing applied: all pending");
    assert.deepEqual(call("pending_migrations", { entries: [{ when: "1", tag: "x" }] }, 0), {
      stop: 2,
      reason: "the journal holds a bad entry",
    });
    assert.equal(call("pending_migrations", { entries: [{ when: 1, tag: "../x" }] }, 0).stop, 2);
  });
  it("splits on `--> statement-breakpoint` as the migrator does and hashes the whole file text", () => {
    const sql = 'CREATE TABLE "a" (id int);\n--> statement-breakpoint\nCREATE INDEX "a_i" ON "a" (id);\n';
    assert.deepEqual(call("split_statements", sql), ['CREATE TABLE "a" (id int);\n', '\nCREATE INDEX "a_i" ON "a" (id);\n']);
    assert.deepEqual(call("split_statements", "--> statement-breakpoint\n"), []);
    assert.equal(call("file_hash", "SELECT 1;\n—\n"), sha256("SELECT 1;\n—\n"));
  });
  it("applies every pending migration in ONE transaction, each with its migrations row and a reading after it", () => {
    const script = call("apply_script", [
      { tag: "0001_users", when: 2000, hash: "b".repeat(64), sql: "ALTER TABLE a ADD b int;\n--> statement-breakpoint\nUPDATE a SET b = 1;" },
      { tag: "0002_index", when: 3000, hash: "c".repeat(64), sql: "CREATE INDEX i ON a (b);" },
    ]);
    const lines = script.trimEnd().split("\n");
    assert.deepEqual(lines.slice(0, 2), ["\\set VERBOSITY verbose", "BEGIN;"]);
    assert.equal(lines.at(-1), "COMMIT;");
    assert.equal(lines.filter((l) => l === "BEGIN;" || l === "COMMIT;" || /^ROLLBACK/.test(l)).length, 2, "one transaction");
    assert.equal(lines.filter((l) => l.startsWith("SELECT '@@READ '")).length, 3, "a reading before and after each");
    const at = (needle) => lines.findIndex((l) => l.includes(needle));
    assert.ok(at("@@BEGIN 0001_users") < at("ALTER TABLE a ADD b int;") && at("ALTER TABLE a") < at("UPDATE a SET b = 1;"));
    assert.ok(at("UPDATE a SET b = 1;") < at(`'${"b".repeat(64)}', 2000`) && at(`, 2000`) < at("@@BEGIN 0002_index"));
    assert.match(script, /INSERT INTO drizzle\.__drizzle_migrations \("hash", "created_at"\) VALUES \('c{64}', 3000\);/);
    assert.match(script, /pg_stat_xact_user_tables/);
    assert.match(script, /pg_locks l .* WHERE l\.pid = pg_backend_pid\(\)/);
    assert.match(script, /clock_timestamp\(\)/);
  });
  it("per-migration deltas: elapsed ms, rows per table, new locks with their mode", () => {
    const read = (at, rows, locks) => `@@READ ${JSON.stringify({ at, rows, locks })}`;
    const stdout = [
      read(1000, {}, []),
      "@@BEGIN 0001_users",
      "some migration output",
      read(1250.4, { "public.users": [2, 5, 0] }, [["public.users", "AccessExclusiveLock"]]),
      "@@BEGIN 0002_index",
      read(1300, { "public.users": [2, 5, 1], "public.x": [0, 0, 0] }, [["public.users", "AccessExclusiveLock"], ["public.users", "ShareLock"]]),
    ].join("\n");
    assert.deepEqual(call("parse_apply", stdout, "", ["0001_users", "0002_index"], 0), [
      [
        { tag: "0001_users", ms: 250, rows: { "public.users": { inserted: 2, updated: 5, deleted: 0 } }, locks: [{ relation: "public.users", mode: "AccessExclusiveLock" }], error: null },
        { tag: "0002_index", ms: 50, rows: { "public.users": { inserted: 0, updated: 0, deleted: 1 } }, locks: [{ relation: "public.users", mode: "ShareLock" }], error: null },
      ],
      false,
    ]);
  });
  it("a failing statement names its migration, SQLSTATE and message; a failed COMMIT the last migration", () => {
    const stdout = `@@READ ${JSON.stringify({ at: 0, rows: {}, locks: [] })}\n@@BEGIN 0001_users\n`;
    const stderr = 'psql:<stdin>:4: ERROR:  42703: column "nope" does not exist\nLOCATION:  errorMissingColumn\n';
    const [migrations, failed] = call("parse_apply", stdout, stderr, ["0001_users", "0002_index"], 3);
    assert.equal(failed, true);
    assert.deepEqual(migrations, [
      { tag: "0001_users", ms: null, rows: {}, locks: [], error: { sqlstate: "42703", message: 'column "nope" does not exist' } },
    ]);
    const full = `${stdout}@@READ ${JSON.stringify({ at: 5, rows: {}, locks: [] })}\n`;
    const [atCommit, commitFailed] = call("parse_apply", full, "ERROR:  23503: violates foreign key\n", ["0001_users"], 3);
    assert.equal(commitFailed, true);
    assert.deepEqual(atCommit[0].error, { sqlstate: "23503", message: "violates foreign key" });
  });
  it("headroom: 1.5 x the database size + 2 GiB free, 1 GiB MemAvailable", () => {
    const GIB = 1024 ** 3;
    assert.equal(call("headroom_reason", 4 * GIB, 8 * GIB, GIB), null);
    assert.equal(call("headroom_reason", 4 * GIB, 8 * GIB - 1, GIB), "insufficient headroom (disk)");
    assert.equal(call("headroom_reason", 4 * GIB, 8 * GIB, GIB - 1), "insufficient headroom (memory)");
  });
  it("the latest backup of `pgbackrest info --output=json` and the report shape", () => {
    const info = [{ name: "ds", backup: [{ label: "old", timestamp: { stop: 0 }, info: { size: 1 } }, { label: "new", timestamp: { stop: 1793350023 }, info: { size: 42 } }] }];
    assert.deepEqual(call("latest_backup", info), [{ label: "new", stopAt: "2026-10-30T08:47:03Z" }, 42]);
    assert.deepEqual(call("latest_backup", []), { stop: 1, reason: "the read failed" });
  });
});

test("3648: the copy's catalogue is the `schema` catalogue, character for character", () => {
  const block = (text, end) => text.slice(text.indexOf('NS = ("n.nspname'), text.indexOf(end));
  const harness = block(readFileSync(HARNESS, "utf8"), "\nCATALOGUE_SQL = (");
  const entrypoint = block(readFileSync(ENTRYPOINT, "utf8"), "\nMIGRATIONS = ");
  assert.ok(entrypoint.length > 1000);
  assert.equal(harness, entrypoint);
});

describe("3648: the rehearsal verbs end to end on a test root", { skip: SKIP }, () => {
  let dir, root;
  const JOURNAL = {
    version: "7",
    dialect: "postgresql",
    entries: [
      { idx: 0, version: "7", when: 1000, tag: "0000_init", breakpoints: true },
      { idx: 1, version: "7", when: 2000, tag: "0001_users", breakpoints: true },
      { idx: 2, version: "7", when: 3000, tag: "0002_index", breakpoints: true },
    ],
  };
  const SQL = {
    "0000_init": 'CREATE TABLE "users" (id uuid);',
    "0001_users": 'ALTER TABLE "users" ADD "email" text;\n--> statement-breakpoint\nUPDATE "users" SET "email" = \'\';',
    "0002_index": 'CREATE INDEX "users_email_idx" ON "users" ("email");',
  };
  const rehearsal = () => join(root, "var/lib/ds-platform/rehearsal");
  const scratchDir = () => join(rehearsal(), "scratch");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-rehearse-"));
    root = join(dir, "root");
    mkdirSync(join(root, "home/deploy/ds-platform/infra/deploy/compose/data-prod/pgbackrest"), { recursive: true });
    mkdirSync(join(root, "proc"), { recursive: true });
    writeFileSync(join(root, "proc/meminfo"), "MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n");
    mkdirSync(join(root, "etc/ds-platform"), { recursive: true });
    writeFileSync(
      join(root, "etc/ds-platform/data.env"),
      "# data.env\nPOSTGRES_PASSWORD=db-secret\nPGBACKREST_REPO1_S3_KEY=s3-key\n\nREDIS_PASSWORD=redis-secret\nPGBACKREST_REPO1_CIPHER_PASS=cipher\n",
    );
    writeFileSync(
      join(root, "home/deploy/ds-platform-postgres-state.json"),
      JSON.stringify({ schema: 1, images: { postgres: `sha256:${"1".repeat(64)}`, pgbackrest: `sha256:${"2".repeat(64)}` } }),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const archive = (members = { "drizzle/meta/_journal.json": JSON.stringify(JOURNAL), ...Object.fromEntries(Object.entries(SQL).map(([t, s]) => [`drizzle/${t}.sql`, s])) }) => {
    const path = join(dir, "drizzle.tar.gz");
    const code = [
      "import io, json, sys, tarfile",
      "members = json.loads(sys.stdin.read())",
      "with tarfile.open(sys.argv[1], 'w:gz') as t:",
      "    for name, data in members.items():",
      "        b = data.encode(); i = tarfile.TarInfo(name); i.size = len(b); t.addfile(i, io.BytesIO(b))",
    ].join("\n");
    const r = spawnSync(PYTHON, ["-I", "-c", code, path], { input: JSON.stringify(members), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return path;
  };
  const harness = (args, scenario = {}, env = {}) => {
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({ liveNewest: 1000, ...scenario }));
    const r = spawnSync(PYTHON, ["-I", "-X", "utf8", HARNESS, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        DS_REHEARSE_ROOT: root,
        DS_REHEARSE_FAKE: FAKE,
        DS_REHEARSE_FREE_BYTES: String(100 * 1024 ** 3),
        FAKE_SCENARIO: join(dir, "scenario.json"),
        FAKE_LOG: join(dir, "calls.log"),
        ...env,
      },
    });
    return { status: r.status, stdout: r.stdout.replace(/\r\n/g, "\n"), stderr: r.stderr };
  };
  const calls = () =>
    existsSync(join(dir, "calls.log"))
      ? readFileSync(join(dir, "calls.log"), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l))
      : [];
  const dockerRuns = () => calls().filter((c) => c.tool === "docker" && c.args[0] === "run");
  const reportOf = (sha = SHA) => JSON.parse(readFileSync(join(rehearsal(), `${sha}.json`), "utf8"));
  // The plan `start` leaves for the unit: the state of a started rehearsal.
  const started = (scenario = {}) => {
    const r = harness(["start", SHA, archive()], scenario);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    writeFileSync(join(dir, "calls.log"), "");
    return r;
  };
  const scratchEmpty = () => !existsSync(scratchDir()) || readdirSync(scratchDir()).length === 0;

  it("start with no pending migration answers `no pending migrations`, records pending 0 and restores nothing", () => {
    const r = harness(["start", SHA, archive()], { liveNewest: 3000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { verb: "rehearse", sha: SHA, state: "no pending migrations", pending: 0 });
    const report = reportOf();
    assert.equal(report.pending, 0);
    assert.equal(report.state, "succeeded");
    if (process.platform !== "win32") assert.equal(statSync(join(rehearsal(), `${SHA}.json`)).mode & 0o777, 0o600);
    assert.deepEqual(dockerRuns(), [], "no restore");
    assert.ok(!calls().some((c) => c.tool === "systemd-run"), "no unit");
    assert.ok(!calls().some((c) => c.args.includes("info")), "no headroom read");
    assert.ok(scratchEmpty());
    // The live read: one read-only transaction on ds_prod with the read path's timeouts.
    const live = calls().find((c) => c.args.includes("psql"));
    assert.deepEqual(live.args.slice(0, 6), ["compose", "exec", "-T", "-e", "PGCLIENTENCODING=UTF8", "postgres"]);
    assert.match(live.stdin, /^BEGIN READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '2s';\n/);
    assert.match(live.stdin, /ORDER BY m\.created_at DESC LIMIT 1/);
  });

  for (const [label, scenario, env, reason] of [
    ["the scratch filesystem is short", {}, { DS_REHEARSE_FREE_BYTES: String(1.5 * 1024 ** 3 + 2 * 1024 ** 3 - 1) }, "insufficient headroom (disk)"],
    ["MemAvailable is under 1 GiB", {}, { MEMINFO: "1" }, "insufficient headroom (memory)"],
  ]) {
    it(`start refuses (exit 1, ${reason}) when ${label}; the refusal creates nothing`, () => {
      if (env.MEMINFO) writeFileSync(join(root, "proc/meminfo"), "MemAvailable: 1048575 kB\n");
      const r = harness(["start", SHA, archive()], { ...scenario, dbSize: 1024 ** 3 }, env);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.stdout, `${reason}\n`);
      assert.deepEqual(dockerRuns(), []);
      assert.ok(!calls().some((c) => c.tool === "systemd-run"));
      assert.ok(scratchEmpty());
      assert.ok(!existsSync(join(rehearsal(), `${SHA}.json`)));
    });
  }

  it("start removes every leftover, then starts the durable unit with the cap, the lock and the cleanup", () => {
    mkdirSync(join(scratchDir(), "deadbeefdead/pgdata"), { recursive: true });
    mkdirSync(rehearsal(), { recursive: true });
    writeFileSync(join(rehearsal(), `${SHA}.json`), '{"state":"failed"}\n');
    const r = harness(["start", SHA, archive()], { leftovers: ["abc123def456"] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { verb: "rehearse", sha: SHA, state: "started", pending: 2 });
    assert.ok(calls().some((c) => c.args.join(" ") === "ps -aq --filter name=^ds-rehearse-"));
    assert.ok(calls().some((c) => c.args.join(" ") === "rm -f abc123def456"), "the leftover container goes");
    assert.ok(!existsSync(join(scratchDir(), "deadbeefdead")), "the leftover scratch goes");
    assert.ok(!existsSync(join(rehearsal(), `${SHA}.json`)), "an earlier report of the SHA goes");
    const unit = calls().find((c) => c.tool === "systemd-run").args;
    assert.ok(unit.includes(`--unit=ds-rehearse-${SHA12}`));
    assert.ok(unit.includes("--collect"));
    assert.ok(unit.includes("RuntimeMaxSec=900"));
    assert.ok(unit.some((a) => a.startsWith("ExecStopPost=") && a.endsWith(`/usr/local/lib/ds-platform/rehearse-cleanup ${SHA}`)));
    const body = unit.slice(unit.indexOf("--") + 1);
    assert.deepEqual(body.slice(0, 3), ["/usr/bin/flock", "-w", "60"]);
    assert.ok(body[3].endsWith("/run/ds-platform/ds-rehearsal.lock"));
    assert.deepEqual(body.slice(-2), ["run", SHA]);
    const plan = JSON.parse(readFileSync(join(scratchDir(), SHA12, "plan.json"), "utf8"));
    assert.equal(plan.newest, 1000);
    assert.deepEqual(plan.pending.map((p) => p.tag), ["0001_users", "0002_index"]);
    assert.deepEqual(plan.backup, { label: "20261105-000000F_20261105-090000I", stopAt: "2026-10-30T08:47:03Z" });
  });

  it("start answers `running` for this SHA's live unit and refuses (1) while another rehearsal runs", () => {
    const mine = harness(["start", SHA, archive()], { unitActive: true });
    assert.equal(mine.status, 0);
    assert.equal(JSON.parse(mine.stdout).state, "running");
    const other = harness(["start", SHA, archive()], { otherUnits: ["ds-rehearse-fedcba987654.service"] });
    assert.equal(other.status, 1);
    assert.equal(other.stdout, "a rehearsal is running\n");
    assert.ok(!calls().some((c) => c.tool === "systemd-run"));
  });

  for (const [label, members] of [
    ["a member outside drizzle/", { "drizzle/meta/_journal.json": "{}", "etc/passwd": "x" }],
    ["a .. path", { "drizzle/meta/_journal.json": "{}", "drizzle/../x.sql": "x" }],
    ["no journal", { "drizzle/0001_users.sql": "x" }],
    ["an over-cap member", { "drizzle/meta/_journal.json": "{}", "drizzle/0001_big.sql": "x".repeat(16 * 1024 * 1024 + 1) }],
  ]) {
    it(`start rejects (exit 2) a migration archive with ${label}, before any read`, () => {
      const r = harness(["start", SHA, archive(members)]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok(!calls().some((c) => c.args.includes("psql")));
      assert.ok(scratchEmpty());
    });
  }

  it("run: check, restore on the default bridge, the copy, the replay checks, the apply, the report", () => {
    started();
    const r = harness(["run", SHA]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = reportOf();
    assert.deepEqual(Object.keys(report), ["verb", "sha", "backup", "recoveredTo", "pending", "migrations", "catalogueAfter", "state", "reason"]);
    assert.equal(report.verb, "rehearse");
    assert.equal(report.state, "succeeded");
    assert.equal(report.reason, null);
    assert.equal(report.pending, 2);
    assert.deepEqual(report.backup, { label: "20261105-000000F_20261105-090000I", stopAt: "2026-10-30T08:47:03Z" });
    assert.equal(report.recoveredTo, "2026-11-05T09:30:00.123+00:00");
    assert.deepEqual(report.migrations, [
      { tag: "0001_users", ms: 250, rows: { "drizzle.__drizzle_migrations": { inserted: 1, updated: 0, deleted: 0 }, "public.users": { inserted: 0, updated: 3, deleted: 0 } }, locks: [{ relation: "public.users", mode: "AccessExclusiveLock" }], error: null },
      { tag: "0002_index", ms: 250, rows: { "drizzle.__drizzle_migrations": { inserted: 1, updated: 0, deleted: 0 }, "public.users": { inserted: 0, updated: 3, deleted: 0 } }, locks: [], error: null },
    ]);
    assert.deepEqual(report.catalogueAfter, { tables: [{ schema: "public", name: "users" }], enums: [], sequences: [] });
    // Order: check, then restore, then the copy.
    const seq = calls().map((c) => c.args.slice(0, 2).join(" ") + (c.args.includes("check") ? " check" : ""));
    assert.ok(seq.indexOf("compose exec check") < seq.indexOf("run --rm"));
    const [restore, copy] = dockerRuns();
    assert.deepEqual(restore.args.slice(0, 4), ["run", "--rm", "--name", `ds-rehearse-${SHA12}-restore`]);
    assert.ok(restore.args.includes(`sha256:${"2".repeat(64)}`), "the recorded pgbackrest image");
    for (const a of ["--type=default", "--archive-mode=off", "restore", "--user", "postgres"]) assert.ok(restore.args.includes(a), a);
    assert.ok(!restore.args.some((a) => /^--target-action/.test(a)));
    assert.deepEqual(copy.args.slice(0, 5), ["run", "-d", "--rm", "--name", `ds-rehearse-${SHA12}`]);
    assert.ok(copy.args.includes(`sha256:${"1".repeat(64)}`), "the recorded postgres image");
    for (const a of ["listen_addresses=", "archive_mode=off", "shared_buffers=128MB", "max_connections=10"]) assert.ok(copy.args.includes(a), a);
    for (const run of [restore, copy]) {
      const s = run.args.join(" ");
      assert.match(s, /--memory 768m --memory-swap 768m --oom-score-adj 1000/);
      assert.doesNotMatch(s, /--network|-p |--publish|--restart/, "the default bridge, no port, no restart policy");
      // Only what `pgbackrest restore` / `archive-get` needs: never the DB or other credentials of data.env.
      assert.doesNotMatch(s, /data\.env/);
      assert.equal(run.envFile, "PGBACKREST_REPO1_S3_KEY=s3-key\nPGBACKREST_REPO1_CIPHER_PASS=cipher\n");
    }
    const apply = calls().find((c) => c.stdin.includes("VERBOSITY verbose"));
    assert.ok(apply.args.includes(`ds-rehearse-${SHA12}`) && apply.args.includes("ON_ERROR_STOP=1"));
    assert.match(apply.stdin, /^\\set VERBOSITY verbose\nBEGIN;\n/);
    assert.match(apply.stdin, /COMMIT;\n$/);
    // Teardown: both containers removed, the scratch gone, the report kept.
    for (const name of [`ds-rehearse-${SHA12}`, `ds-rehearse-${SHA12}-restore`])
      assert.ok(calls().some((c) => c.args.join(" ") === `rm -f ${name}`), name);
    assert.ok(scratchEmpty());
  });

  it("run: a failing migration records its tag, SQLSTATE and message, rolls the copy back, reads no catalogue", () => {
    started();
    const r = harness(["run", SHA], { failTag: "0002_index" });
    assert.equal(r.status, 1);
    const report = reportOf();
    assert.equal(report.state, "failed");
    assert.equal(report.catalogueAfter, null);
    assert.equal(report.migrations[0].error, null);
    assert.deepEqual(report.migrations[1], {
      tag: "0002_index",
      ms: null,
      rows: {},
      locks: [],
      error: { sqlstate: "42P07", message: 'relation "users_email_idx" already exists' },
    });
    assert.ok(!calls().some((c) => c.stdin.includes("'tables'")), "no catalogue read of a rolled-back copy");
    assert.ok(scratchEmpty());
    assert.ok(calls().some((c) => c.args.join(" ") === `rm -f ds-rehearse-${SHA12}`));
  });

  for (const [label, scenario, reason, restored] of [
    ["`pgbackrest check` fails", { checkRc: 82 }, "archive check failed", false],
    ["`pgbackrest check` names no WAL switch", { noSwitch: true }, "archive check failed", false],
    ["the copy did not replay the segment the check archived", { noReplay: true }, "copy behind prod", true],
    ["the copy's newest migration differs from prod's", { copyNewest: 900 }, "copy behind prod", true],
  ]) {
    it(`run fails (exit 1, ${reason}) when ${label}; nothing is applied, everything is torn down`, () => {
      started();
      const r = harness(["run", SHA], scenario);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      const report = reportOf();
      assert.equal(report.state, "failed");
      assert.equal(report.reason, reason);
      assert.deepEqual(report.migrations, []);
      assert.equal(dockerRuns().length > 0, restored);
      assert.ok(!calls().some((c) => c.stdin.includes("VERBOSITY verbose")), "nothing applied");
      assert.ok(scratchEmpty());
      assert.ok(calls().some((c) => c.args.join(" ") === `rm -f ds-rehearse-${SHA12}`));
    });
  }

  it("cleanup removes every container and the scratch; a run that left no report gets a failed one", () => {
    started();
    const r = harness(["cleanup", SHA], { leftovers: ["abc123def456"] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(calls().some((c) => c.args.join(" ") === "rm -f abc123def456"));
    assert.ok(scratchEmpty());
    assert.equal(reportOf().state, "failed");
    assert.equal(reportOf().reason, "the rehearsal did not finish");
    writeFileSync(join(rehearsal(), `${SHA}.json`), '{"state":"succeeded"}\n');
    assert.equal(harness(["cleanup", SHA]).status, 0);
    assert.equal(reportOf().state, "succeeded", "an existing report is kept");
  });

  it("status answers running, the report, or absent; it reads no database", () => {
    assert.deepEqual(JSON.parse(harness(["status", SHA]).stdout), { verb: "rehearsal-status", sha: SHA, state: "absent" });
    assert.equal(JSON.parse(harness(["status", SHA], { unitActive: true }).stdout).state, "running");
    harness(["start", SHA, archive()], { liveNewest: 3000 });
    writeFileSync(join(dir, "calls.log"), "");
    const done = JSON.parse(harness(["status", SHA]).stdout);
    assert.equal(done.state, "succeeded");
    assert.equal(done.pending, 0);
    assert.ok(!calls().some((c) => c.tool === "docker"), "no database read");
  });

  it("keeps the newest 10 reports", () => {
    mkdirSync(rehearsal(), { recursive: true });
    for (let i = 0; i < 12; i++) {
      const p = join(rehearsal(), `${String(i).padStart(2, "0").repeat(20)}.json`);
      writeFileSync(p, "{}\n");
      utimesSync(p, 1_700_000_000 + i, 1_700_000_000 + i);
    }
    harness(["start", SHA, archive()], { liveNewest: 3000 });
    const left = readdirSync(rehearsal()).filter((n) => n.endsWith(".json"));
    assert.equal(left.length, 10);
    assert.ok(left.includes(`${SHA}.json`));
    assert.ok(!left.includes(`${"00".repeat(20)}.json`) && !left.includes(`${"01".repeat(20)}.json`), "the oldest go");
  });

  it("rejects (exit 2) any other usage", () => {
    for (const args of [[], ["start", SHA], ["run", "abc"], ["status"], ["cleanup", SHA, SHA], ["exec", SHA]]) {
      assert.equal(harness(args).status, 2, JSON.stringify(args));
    }
  });
});
