// Bash-level tests of infra/deploy/bin/ds-deploy-entrypoint, the forced command of
// every CI key (Issue #2984; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §4, §8 step (c)). The script runs for real against a fixture root
// (DS_ENTRYPOINT_ROOT) with `sudo` and `logger` stubbed on PATH, a fake ds-release
// and a fake release driver, so the allowlist, the argument checks, the log lines
// and the report upload are exercised end to end.
// Needs bash, python3, find and install — CI Linux; skipped on Windows and where absent.
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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint");
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
const SHA = "0123456789abcdef0123456789abcdef01234567";

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v python3 && command -v find && command -v install"], {
    stdio: "ignore",
  }).status === 0;
const SKIP = !toolsPresent && "needs Linux bash, python3, find and install";

test("2984: the entrypoint checks env and sha with ds-release's own regexes", () => {
  const pick = (file, name) => {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    assert.ok(line, `${file} defines ${name}`);
    return line;
  };
  for (const name of ["ENV_RE", "SHA_RE"]) {
    assert.equal(pick(ENTRYPOINT, name), pick(DS_RELEASE, name), `${name} is one definition`);
  }
});

// A minimal ustar writer: the archives below carry links and paths that a
// well-behaved `tar -c` would refuse or normalise, which is the point.
function tarArchive(entries) {
  const blocks = [];
  for (const { name, type = "0", link = "", body = "", uname = "" } of entries) {
    const data = Buffer.from(body);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write(type === "5" ? "0000755\0" : "0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${(type === "0" ? data.length : 0).toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write(type, 156, 1, "ascii");
    header.write(link, 157, 100, "utf8");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write(uname, 265, 32, "utf8");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    if (type === "0" && data.length > 0) {
      blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

describe("2984: ds-deploy-entrypoint", { skip: SKIP }, () => {
  let dir, root, stubs;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-entrypoint-"));
    root = join(dir, "root");
    stubs = join(dir, "stubs");
    mkdirSync(stubs, { recursive: true });
    mkdirSync(join(root, "usr/local/bin"), { recursive: true });
    mkdirSync(join(root, "etc/ds-platform"), { recursive: true });
    const stub = (path, body) => {
      writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(path, 0o755);
    };
    // sudo: record, then run as the caller; `install -o/-g` would need root.
    stub(
      join(stubs, "sudo"),
      [
        'echo "$*" >> "$STUB_DIR/sudo.log"',
        'if [[ $1 == install ]]; then',
        "  args=(); skip=0",
        '  for a in "$@"; do',
        "    if [[ $skip == 1 ]]; then skip=0; continue; fi",
        '    case $a in -o|-g) skip=1 ;; *) args+=("$a") ;; esac',
        "  done",
        '  exec "${args[@]}"',
        "fi",
        'exec "$@"',
      ].join("\n"),
    );
    stub(join(stubs, "logger"), 'echo "$*" >> "$STUB_DIR/logger.log"');
    stub(
      join(root, "usr/local/bin/ds-release"),
      `echo "ds-release-called $*" >> "$STUB_DIR/ds-release.log"; echo '{"release":null,"unitAlive":null}'`,
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (command, { input, env: extra = {} } = {}) => {
    const env = {
      ...process.env,
      PATH: `${stubs}${delimiter}${process.env.PATH}`,
      STUB_DIR: dir,
      DS_ENTRYPOINT_ROOT: root,
      ...extra,
    };
    if (command === undefined) delete env.SSH_ORIGINAL_COMMAND;
    else env.SSH_ORIGINAL_COMMAND = command;
    const r = spawnSync("bash", [ENTRYPOINT], { env, input, encoding: input ? undefined : "utf8" });
    return { status: r.status, stdout: String(r.stdout), stderr: String(r.stderr) };
  };
  const log = (name) => {
    const p = join(dir, `${name}.log`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  const installDriver = (body = 'echo "driver-called $*"') => {
    const driver = join(root, "usr/local/lib/ds-platform/release-driver");
    mkdirSync(dirname(driver), { recursive: true });
    writeFileSync(driver, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(driver, 0o755);
  };
  const setRole = (role) => writeFileSync(join(root, "etc/ds-platform/box-role"), `${role}\n`);

  it("status dispatches to sudo ds-release status with the validated args", () => {
    const r = run(`status stage-pr-42 ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(log("ds-release"), `ds-release-called status stage-pr-42 ${SHA}\n`);
    // #2985: no driver installed ⇒ no driver unit.
    assert.equal(
      r.stdout,
      `{"release":null,"unitAlive":null,"driver":{"unit":"ds-stage-pr-42-${SHA.slice(0, 12)}-driver","active":"absent","rc":null,"previousSha":null}}\n`,
    );
    assert.match(log("sudo"), new RegExp(`/usr/local/bin/ds-release status stage-pr-42 ${SHA}`));
    assert.match(log("logger"), new RegExp(`-p auth.info accepted: status stage-pr-42 ${SHA}`));
  });

  it("release refuses (exit 3) while no release driver is installed", () => {
    const r = run(`release prod ${SHA}`);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /release driver not installed \(lands with #2985 stage \/ #2986 prod\)/);
  });

  it("release execs the installed release driver with the validated args", () => {
    installDriver();
    const r = run(`release stage-main ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `driver-called stage-main ${SHA}\n`);
    assert.match(log("logger"), /auth\.info accepted: release stage-main/);
  });

  it("2985: release hands the driver the client's stdin (the images manifest)", () => {
    installDriver('cat > "$STUB_DIR/driver-stdin.log"; echo "driver-called $*"');
    const r = run(`release stage-main ${SHA}`, { input: '{"sha":"x"}' });
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(log("driver-stdin"), '{"sha":"x"}');
  });

  it("2985: status adds the installed driver's unit state as `driver`, on one JSON line", () => {
    installDriver(
      `[[ $1 == unit-state ]] && printf '{"unit":"ds-%s-%s-driver","active":"failed","rc":3}\\n' "$2" "\${3:0:12}"`,
    );
    const r = run(`status stage-main ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      release: null,
      unitAlive: null,
      driver: { unit: `ds-stage-main-${SHA.slice(0, 12)}-driver`, active: "failed", rc: 3 },
    });
    assert.equal(r.stdout.split("\n").length, 2, "one line");
  });

  it("3157: status prod carries the driver's previousSha, the release-notes basis", () => {
    const previous = "c".repeat(40);
    installDriver(
      `[[ $1 == unit-state ]] && printf '{"unit":"ds-%s-%s-driver","active":"inactive","rc":0,"previousSha":"${previous}"}\\n' "$2" "\${3:0:12}"`,
    );
    const r = run(`status prod ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).driver, {
      unit: `ds-prod-${SHA.slice(0, 12)}-driver`,
      active: "inactive",
      rc: 0,
      previousSha: previous,
    });
  });

  it("2985: status refuses a driver that answers no unit state", () => {
    installDriver('echo "garbage"');
    const r = run(`status stage-main ${SHA}`);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /reported no unit state/);
  });

  const rejected = [
    ["no command at all", undefined],
    ["an empty command", ""],
    ["an unknown verb", `finish prod ${SHA} succeeded`],
    ["a shell", "bash"],
    ["an extra argument", `status prod ${SHA} extra`],
    ["a missing argument", "status prod"],
    ["release with an extra argument", `release prod ${SHA} --retry-failed`],
    ["upload-report with an extra argument", `upload-report ${SHA} x`],
    ["an unknown env", `status production ${SHA}`],
    ["stage-pr-0", `status stage-pr-0 ${SHA}`],
    ["a short sha", "status prod 0123456"],
    ["an uppercase sha", `status prod ${SHA.toUpperCase()}`],
    ["a semicolon", `status prod ${SHA};id`],
    ["a command substitution", `status prod $(id)`],
    ["backticks", "status prod `id`"],
    ["a pipe", `status prod ${SHA} | sh`],
    ["a redirect", `status prod ${SHA} > /tmp/x`],
    ["a newline", `status prod ${SHA}\nbash`],
    ["a tab", `status\tprod\t${SHA}`],
    ["a doubled space", `status  prod ${SHA}`],
    ["a leading space", ` status prod ${SHA}`],
    ["a trailing space", `status prod ${SHA} `],
    ["an overlong command", `status prod ${"a".repeat(300)}`],
  ];
  for (const [what, command] of rejected) {
    it(`rejects ${what}: exit 2, a stderr line, an auth.warning log, nothing run`, () => {
      installDriver();
      const r = run(command);
      assert.equal(r.status, 2, `${JSON.stringify(command)} → ${r.stdout}${r.stderr}`);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /^ds-deploy-entrypoint: rejected: /);
      const line = log("logger");
      assert.match(line, /^-t ds-deploy-entrypoint -p auth\.warning rejected: /);
      assert.equal(line.split("\n").filter(Boolean).length, 1, "one log line, no injected newline");
      assert.ok(line.length < 200, "the logged request is length-capped");
      assert.equal(log("sudo"), "", "nothing ran through sudo");
    });
  }

  it("upload-report refuses on a box whose role is not stage, or has none", () => {
    const archive = tarArchive([{ name: "report/index.json", body: "{}" }]);
    let r = run(`upload-report ${SHA}`, { input: archive });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /stage box only/);
    setRole("prod");
    r = run(`upload-report ${SHA}`, { input: archive });
    assert.equal(r.status, 3);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports")), "nothing written");
  });

  it("upload-report stores the stream under the sha and prunes reports past 14 days", () => {
    setRole("stage");
    const reports = join(root, "var/lib/ds-platform/e2e-reports");
    const old = join(reports, "a".repeat(40));
    const fresh = join(reports, "b".repeat(40));
    mkdirSync(old, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const days = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);
    utimesSync(old, days(20), days(20));
    utimesSync(fresh, days(3), days(3));
    const archive = tarArchive([
      { name: "./", type: "5" },
      { name: "./results.json", body: '{"ok":true}' },
      { name: "./trace/", type: "5" },
      { name: "./trace/t.zip", body: "zip" },
    ]);
    const r = run(`upload-report ${SHA}`, { input: archive });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-deploy-entrypoint: report ${SHA} stored\n`);
    assert.equal(readFileSync(join(reports, SHA, "results.json"), "utf8"), '{"ok":true}');
    assert.equal(readFileSync(join(reports, SHA, "trace/t.zip"), "utf8"), "zip");
    assert.deepEqual(readdirSync(reports).sort(), ["b".repeat(40), SHA].sort());
    assert.match(log("sudo"), /python3 -I -c /, "validated and extracted by tarfile");
  });

  const unsafe = [
    ["a .. path", [{ name: "../escape", body: "x" }]],
    ["a nested .. path", [{ name: "a/../../escape", body: "x" }]],
    ["an absolute path", [{ name: "/tmp/escape", body: "x" }]],
    ["a symlink", [{ name: "link", type: "2", link: "/etc/passwd" }]],
    ["a hard link", [{ name: "f", body: "x" }, { name: "hard", type: "1", link: "f" }]],
    ["a regular file in place of the report directory", [{ name: ".", body: "x" }]],
  ];
  for (const [what, entries] of unsafe) {
    it(`upload-report refuses an archive with ${what} and extracts nothing`, () => {
      setRole("stage");
      const r = run(`upload-report ${SHA}`, { input: tarArchive(entries) });
      assert.equal(r.status, 3, r.stderr);
      assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
      assert.doesNotMatch(log("sudo"), /tar -xf/);
    });
  }

  const parent = () => join(root, "var/lib/ds-platform");
  const overCap = [
    [
      "a stream over the byte cap",
      { DS_ENTRYPOINT_MAX_REPORT_BYTES: "4096" },
      [{ name: "big.bin", body: "x".repeat(8192) }],
    ],
    [
      "members whose sizes sum over the unpacked cap",
      { DS_ENTRYPOINT_MAX_UNPACKED_BYTES: "1000" },
      [
        { name: "a.bin", body: "x".repeat(600) },
        { name: "b.bin", body: "x".repeat(600) },
      ],
    ],
    [
      "more entries than the entry cap",
      { DS_ENTRYPOINT_MAX_REPORT_ENTRIES: "3" },
      ["1", "2", "3", "4", "5"].map((n) => ({ name: `f${n}`, body: n })),
    ],
  ];
  for (const [what, env, entries] of overCap) {
    it(`upload-report rejects ${what}: exit 2, auth.warning, nothing extracted, no temp left`, () => {
      setRole("stage");
      const r = run(`upload-report ${SHA}`, { input: tarArchive(entries), env });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /^ds-deploy-entrypoint: rejected: the report/);
      assert.match(log("logger"), new RegExp(`auth\\.warning rejected: upload-report ${SHA}`));
      assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
      assert.doesNotMatch(log("sudo"), /tar -xf/);
      assert.deepEqual(
        readdirSync(parent()).filter((f) => f.startsWith(".e2e-report-upload")),
        [],
        "the temp file is removed",
      );
    });
  }

  it("upload-report reads the stream into a temp file beside the reports, never /tmp", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, { input: tarArchive([{ name: "r.json", body: "{}" }]) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(log("sudo"), new RegExp(`mktemp -p ${`${root}/var/lib/ds-platform`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `));
    assert.deepEqual(readdirSync(parent()).sort(), ["e2e-reports"]);
  });

  it("upload-report: an owner name with spaces cannot shift the size past the unpacked cap", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, {
      input: tarArchive([{ name: "big.bin", body: "x".repeat(1200), uname: "a b 1 2 3" }]),
      env: { DS_ENTRYPOINT_MAX_UNPACKED_BYTES: "1000" },
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unpacks to more than 1000 bytes/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses a compressed (gzip) archive: plain tar only", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, {
      input: gzipSync(tarArchive([{ name: "r.json", body: "{}" }])),
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /not a readable tar stream/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses when the reports filesystem lacks room for the unpacked report", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, {
      input: tarArchive([{ name: "r.json", body: "{}" }]),
      env: { DS_ENTRYPOINT_FREE_MARGIN_BYTES: String(2 ** 62) },
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /not enough free space/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses a stream that is not a tar archive", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, { input: Buffer.from("not a tar stream at all\n") });
    assert.equal(r.status, 3);
    assert.doesNotMatch(log("sudo"), /tar -xf/);
  });

  // ── 3119: observe <name> ─────────────────────────────────────────────────
  const OWNED = "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab";
  const envelope = (rows, extra = {}) =>
    JSON.stringify({ database: "ds_main", readOnly: true, rows, ...extra });
  // docker: record argv and stdin, answer with the fixture reply and exit code.
  const stubDocker = (reply, code = 0) => {
    writeFileSync(join(dir, "docker-reply"), reply);
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$@" > "$STUB_DIR/docker-argv.log"',
        'cat > "$STUB_DIR/docker-stdin.log"',
        'cat "$STUB_DIR/docker-reply"',
        'echo "psql: FATAL secret diagnostics" >&2',
        `exit ${code}`,
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "docker"), 0o755);
  };
  const json = (value) => Buffer.from(JSON.stringify(value));
  const writeStageEnv = (extra = "") =>
    writeFileSync(
      join(root, "etc/ds-platform/stage.env"),
      `STAGE_BASE_DOMAIN=stage.example.test\nSTAGE_BASIC_AUTH_PASS=hunter2-secret\n${extra}`,
    );

  it("3119: the bash allowlist and the box observations are one list", () => {
    const text = readFileSync(ENTRYPOINT, "utf8");
    const arm = text.match(/case "\$\{words\[1\]\}" in\n([\s\S]*?)\) ;;/)[1];
    const allow = arm.split(/[|\\\s]+/).filter(Boolean).sort();
    const table = text.match(/OBSERVATIONS = \{([\s\S]*?)\n\}/)[1];
    const names = [...table.matchAll(/^ {4}"([a-z-]+)": \(/gm)].map((m) => m[1]).sort();
    assert.deepEqual(allow, names);
    assert.equal(names.length, 7);
  });

  it("3119: observe refuses (exit 3) on any box but the stage box", () => {
    setRole("prod");
    stubDocker(envelope([]));
    const r = run("observe wrong-verification", {
      input: json({ email: `wrong-2928-verified-${OWNED}@example.test` }),
    });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /observe is served by the stage box only/);
    assert.ok(!existsSync(join(dir, "docker-argv.log")), "no read");
  });

  for (const [command, why] of [
    ["observe", /usage: observe <name>/],
    ["observe wrong-verification extra", /usage: observe <name>/],
    ["observe drop-users", /unknown observation/],
    ["observe sql", /unknown observation/],
  ]) {
    it(`3119: observe rejects \`${command}\` (exit 2) before any read`, () => {
      setRole("stage");
      stubDocker(envelope([]));
      const r = run(command, { input: json({}) });
      assert.equal(r.status, 2);
      assert.match(r.stderr, why);
      assert.ok(!existsSync(join(dir, "docker-argv.log")), "no read");
      assert.match(log("logger"), /auth\.warning rejected/);
    });
  }

  for (const [label, input] of [
    ["SQL in a parameter", json({ email: "x@example.test'; DROP TABLE users; --" })],
    ["another journey's address", json({ email: `consent-2856-${OWNED}@example.test` })],
    ["an extra parameter", json({ email: `wrong-2928-verified-${OWNED}@example.test`, sql: "1" })],
    ["a missing parameter", json({})],
    ["a non-string parameter", json({ email: ["a"] })],
    ["not JSON", Buffer.from("SELECT 1")],
    ["a JSON array", json([`wrong-2928-verified-${OWNED}@example.test`])],
    ["an oversize body", Buffer.from(`{"email":"${"a".repeat(5000)}"}`)],
  ]) {
    it(`3119: observe rejects ${label} (exit 2) before any read`, () => {
      setRole("stage");
      stubDocker(envelope([]));
      const r = run("observe wrong-verification", { input });
      assert.equal(r.status, 2, r.stderr);
      assert.ok(!existsSync(join(dir, "docker-argv.log")), "no read");
      assert.doesNotMatch(r.stderr, /DROP|Traceback/);
    });
  }

  it("3119: observe reads the main slot in a read-only transaction through psql variables", () => {
    setRole("stage");
    const email = `wrong-2928-unknown-${OWNED}@example.test`;
    const rows = [{ users: 0, verified: false, consents: 0, user_digest: "a".repeat(32), consent_digest: "b".repeat(32) }];
    stubDocker(envelope(rows));
    const r = run("observe wrong-verification", { input: json({ email }) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { database: "ds_main", readOnly: true, rows });
    const argv = log("docker-argv").trimEnd().split("\n");
    assert.deepEqual(argv.slice(0, 7), ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "stg-infra-postgres-1", "psql", "-X"]);
    assert.equal(argv[argv.indexOf("-d") + 1], "ds_main");
    assert.ok(argv.includes(`email=${email}`), "the address is a psql variable");
    assert.deepEqual(argv.slice(-2), ["-f", "-"]);
    const sql = log("docker-stdin");
    assert.match(sql, /^BEGIN READ ONLY;\nSET LOCAL statement_timeout = '5s';/);
    assert.match(sql, /:'email'/);
    assert.ok(!sql.includes(email), "never spliced into the SQL text");
    assert.match(sql, /ROLLBACK;\n$/);
    assert.match(log("logger"), /auth\.info accepted: observe wrong-verification/);
    assert.match(log("sudo"), /python3 -I -X utf8 -c/);
  });

  it("3119: observe auth-consent passes a null profile as an empty psql variable", () => {
    setRole("stage");
    stubDocker(envelope([]));
    const email = `consent-2856-${OWNED}@example.test`;
    const r = run("observe auth-consent", { input: json({ email, subject: "123", profileId: null }) });
    assert.equal(r.status, 0, r.stderr);
    const argv = log("docker-argv").split("\n");
    for (const v of [`email=${email}`, "subject=123", "profile_id="]) assert.ok(argv.includes(v), v);
    assert.match(log("docker-stdin"), /NULLIF\(:'profile_id', ''\)/);
  });

  it("3119: observe phone-account-count binds the owned phones as one text[] variable", () => {
    setRole("stage");
    stubDocker(envelope([{ count: "0" }]));
    const r = run("observe phone-account-count", { input: json({ phones: ["+199900000001", "+199900000002"] }) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(log("docker-argv").split("\n").includes("phones={+199900000001,+199900000002}"));
    const bad = run("observe phone-account-count", { input: json({ phones: ["+7999", "+199900000002"] }) });
    assert.equal(bad.status, 2);
  });

  it("3119: observe congress-snapshot admits only the journey's fixed display name", () => {
    setRole("stage");
    stubDocker(envelope([]));
    const email = `congress-registration-2927-${OWNED}@example.test`;
    const ok = run("observe congress-snapshot", { input: json({ email, displayName: "Иванова Мария" }) });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(log("docker-argv").split("\n").includes("display_name=Иванова Мария"));
    const bad = run("observe congress-snapshot", { input: json({ email, displayName: "x' OR '1'='1" }) });
    assert.equal(bad.status, 2);
  });

  it("3119: observe mirror-count prints only the count", () => {
    setRole("stage");
    stubDocker(envelope([{ count: 1 }]));
    const r = run("observe mirror-count", { input: json({ email: `register-2704-${OWNED}@example.test` }) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "1\n");
  });

  for (const [label, reply, code] of [
    ["psql fails", "", 2],
    ["another database answered", envelope([], { database: "ds_pr_1" }), 0],
    ["the transaction was not read-only", envelope([], { readOnly: false }), 0],
    ["the reply is not the envelope", "1|2|3", 0],
  ]) {
    it(`3119: observe fails (exit 1) with a fixed reason when ${label}`, () => {
      setRole("stage");
      stubDocker(reply, code);
      const r = run("observe wrong-verification", {
        input: json({ email: `wrong-2928-verified-${OWNED}@example.test` }),
      });
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.ok(existsSync(join(dir, "docker-argv.log")), "the read ran");
      assert.match(
        r.stderr,
        /^ds-deploy-entrypoint: the observation (read failed|did not read the main slot read-only)\n$/,
      );
    });
  }

  it("3119: observe academy-host reads the base domain and nothing else of the stage env", () => {
    setRole("stage");
    writeStageEnv();
    const r = run("observe academy-host", { input: json({}) });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '{"academy":"academy-main.stage.example.test"}\n');
    assert.doesNotMatch(r.stdout + r.stderr, /hunter2/);
  });

  it("3119: observe password-policy refuses an IdP origin other than https://id.<base domain>", () => {
    setRole("stage");
    writeStageEnv("IDP_BASE_URL=https://evil.example.test\n");
    const r = run("observe password-policy", { input: json({}) });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /IdP origin is not/);
  });

  it("3119: observe password-policy returns only the policy flags, never the token", async () => {
    setRole("stage");
    writeStageEnv("IDP_EXTERNAL_DOMAIN=id.stage.example.test\nIDP_EXTERNAL_SECURE=true\n");
    writeFileSync(join(root, "etc/ds-platform/idp-bootstrap-pat.txt"), "pat-secret-value\n");
    const { createServer } = await import("node:http");
    const { spawn } = await import("node:child_process");
    let seen;
    const server = createServer((req, res) => {
      seen = { url: req.url, auth: req.headers.authorization };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ policy: { minLength: "8", hasUppercase: false, details: { id: "x" } } }));
    });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    // spawn, not spawnSync: the in-process IdP must answer while the entrypoint runs.
    const child = spawn("bash", [ENTRYPOINT], {
      env: {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        STUB_DIR: dir,
        DS_ENTRYPOINT_ROOT: root,
        DS_ENTRYPOINT_IDP_ORIGIN: `http://127.0.0.1:${server.address().port}`,
        SSH_ORIGINAL_COMMAND: "observe password-policy",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.end("{}");
    const status = await new Promise((ok) => child.on("close", ok));
    server.close();
    assert.equal(status, 0, stderr);
    assert.deepEqual(seen, { url: "/admin/v1/policies/password/complexity", auth: "Bearer pat-secret-value" });
    assert.equal(stdout, '{"policy":{"minLength":"8","hasUppercase":false}}\n');
    assert.doesNotMatch(stdout + stderr, /pat-secret/);
  });
});
