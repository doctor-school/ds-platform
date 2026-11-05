// Bash-level tests of infra/deploy/bin/ds-deploy-entrypoint, the forced command of
// every CI key (Issue #2984; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §4, §8 step (c)). The script runs for real against a fixture root
// (DS_ENTRYPOINT_ROOT) with `sudo` and `logger` stubbed on PATH, a fake ds-release
// and a fake release driver, so the allowlist, the argument checks, the log lines
// and the report upload are exercised end to end.
// Needs bash, python3, find and install — CI Linux; skipped on Windows and where absent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
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
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { DATA_READ_VERBS, DATA_VERBS } from "./lib/data-prod.mjs";
import { BOX_ENTRYPOINTS, DATA_BOX_ENTRYPOINTS, DS_READ_ENTRYPOINT_BIN } from "./lib/remote.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint");
const READ_ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-read-entrypoint");
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
const SHA = "0123456789abcdef0123456789abcdef01234567";

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v python3 && command -v find && command -v install"], {
    stdio: "ignore",
  }).status === 0;
const SKIP = !toolsPresent && "needs Linux bash, python3, find and install";

// #3647: the PostgreSQL server binaries of the fixture database (the CI Linux runner
// ships them unstarted); null where absent.
const PG_BIN = (() => {
  if (process.platform === "win32") return null;
  const cfg = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const versions = existsSync("/usr/lib/postgresql") ? readdirSync("/usr/lib/postgresql").sort().reverse() : [];
  return (
    [cfg.status === 0 ? cfg.stdout.trim() : "", ...versions.map((v) => `/usr/lib/postgresql/${v}/bin`)].find(
      (d) => d && ["initdb", "pg_ctl", "psql"].every((b) => existsSync(join(d, b))),
    ) ?? null
  );
})();
const PYTHON = ["python3", "python"].find(
  (p) => spawnSync(p, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);

/** Run `code` with READ_OBSERVE_PY imported as `m` (its entry point does not run); its JSON stdout. */
function readObservePy(code) {
  const text = readFileSync(ENTRYPOINT, "utf8").replace(/\r\n/g, "\n");
  const body = text.match(/\nread -r -d '' READ_OBSERVE_PY <<'PY' \|\| true\n([\s\S]*?)\nPY\n/);
  assert.ok(body, "the entrypoint defines READ_OBSERVE_PY");
  const work = mkdtempSync(join(tmpdir(), "ds-observe-"));
  try {
    writeFileSync(join(work, "read_observe.py"), body[1]);
    const prelude = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('read_observe', sys.argv[1])",
      "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    ];
    const r = spawnSync(PYTHON, ["-I", "-X", "utf8", "-c", [...prelude, code].join("\n"), join(work, "read_observe.py")], {
      encoding: "utf8",
      input: "",
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
/** PROD_OBSERVATIONS as data: name -> {result, sql, params: key -> [kind, var, pattern | names]}. */
const prodObservations = () =>
  readObservePy(
    "print(json.dumps({n: {'result': e['result'], 'sql': e['sql'], 'params': {k: [p[0], p[1], p[2].pattern if p[0] == 'value' else list(p[2])] for k, p in e['params'].items()}} for n, e in m.PROD_OBSERVATIONS.items()}))",
  );

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

test("3313, 3646: the data verbs are one list: DATA_VERBS, the case arm, the client's release and read verbs", () => {
  const lines = readFileSync(ENTRYPOINT, "utf8").split("\n");
  const line = lines.find((l) => l.startsWith("DATA_VERBS="));
  assert.ok(line, "the entrypoint defines DATA_VERBS");
  const all = [...DATA_VERBS, ...DATA_READ_VERBS];
  assert.deepEqual(line.slice("DATA_VERBS='".length, -1).split(" "), all);
  const start = lines.indexOf("  capabilities | postgres-probe | postgres-checkpoint | ship | install | data-env | data-up | backup | \\");
  assert.ok(start > 0, "one case arm dispatches the data verbs");
  const arm = `${lines[start].slice(0, -1)}${lines[start + 1]}`.trim().replace(/\)$/, "");
  assert.deepEqual(arm.split(/\s*\|\s*/), all);
  assert.equal(lines[start + 2], "    data_verb");
});

test("3313, 3646: the data box installs the DATA_BOX_ENTRYPOINTS of remote.mjs, in order — no ds-read-entrypoint", () => {
  const lines = readFileSync(ENTRYPOINT, "utf8").split("\n");
  const start = lines.indexOf("DATA_INSTALL=(");
  assert.ok(start > 0, "DATA_INSTALL is defined");
  const end = lines.indexOf(")", start);
  assert.deepEqual(
    lines.slice(start + 1, end).map((l) => l.trim()),
    DATA_BOX_ENTRYPOINTS.map(({ dest, path }) => `${dest}=${path}`),
  );
  assert.deepEqual(
    BOX_ENTRYPOINTS.filter((e) => !DATA_BOX_ENTRYPOINTS.includes(e)).map(({ dest }) => dest),
    [DS_READ_ENTRYPOINT_BIN],
  );
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

  const run = (command, { input, env: extra = {}, entrypoint = ENTRYPOINT } = {}) => {
    const env = {
      ...process.env,
      PATH: `${stubs}${delimiter}${process.env.PATH}`,
      STUB_DIR: dir,
      DS_ENTRYPOINT_ROOT: root,
      ...extra,
    };
    if (command === undefined) delete env.SSH_ORIGINAL_COMMAND;
    else env.SSH_ORIGINAL_COMMAND = command;
    const r = spawnSync("bash", [entrypoint], { env, input, encoding: input ? undefined : "utf8" });
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

  it("2987: rollback prod execs the driver's rollback path on the prod box, the manifest on stdin", () => {
    setRole("prod");
    installDriver(
      'cat > "$STUB_DIR/driver-stdin.log"; echo "driver-called $*"',
    );
    const r = run(`rollback prod ${SHA}`, { input: '{"sha":"t"}' });
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(String(r.stdout), `driver-called rollback prod ${SHA}\n`);
    assert.equal(log("driver-stdin"), '{"sha":"t"}');
    assert.match(log("logger"), /auth\.info accepted: rollback prod/);
  });

  it("2987: rollback-status prod returns the driver's rollback record and unit state", () => {
    setRole("prod");
    installDriver('echo "driver-called $*"');
    const r = run(`rollback-status prod ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `driver-called rollback-status prod ${SHA}\n`);
    assert.equal(log("ds-release"), "", "never the release record");
  });

  it("2987: rollback-status without a driver reports no rollback and an absent unit", () => {
    setRole("prod");
    const r = run(`rollback-status prod ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      rollback: null,
      driver: {
        unit: `ds-prod-${SHA.slice(0, 12)}-rollback`,
        active: "absent",
        rc: null,
        previousSha: null,
      },
    });
    assert.equal(
      run(`rollback prod ${SHA}`).status,
      3,
      "no driver: the rollback is refused",
    );
  });

  it("2987: the stage box (or a box without a role) refuses rollback and rollback-status", () => {
    installDriver('echo "driver-called $*"');
    for (const role of ["stage", null]) {
      if (role) setRole(role);
      else rmSync(join(root, "etc/ds-platform/box-role"), { force: true });
      for (const verb of ["rollback", "rollback-status"]) {
        const r = run(`${verb} prod ${SHA}`);
        assert.equal(r.status, 3, `${verb} on ${role}`);
        assert.match(
          r.stderr,
          new RegExp(`${verb} is served by the prod box only`),
        );
        assert.equal(r.stdout, "", "the driver never ran");
      }
    }
  });

  it("3354: redeploy prod execs the driver's redeploy path on the prod box, the manifest on stdin", () => {
    setRole("prod");
    installDriver(
      'cat > "$STUB_DIR/driver-stdin.log"; echo "driver-called $*"',
    );
    const r = run(`redeploy prod ${SHA}`, { input: '{"sha":"t"}' });
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(String(r.stdout), `driver-called redeploy prod ${SHA}\n`);
    assert.equal(log("driver-stdin"), '{"sha":"t"}');
    assert.match(log("logger"), /auth\.info accepted: redeploy prod/);
    assert.equal(log("ds-release"), "", "the driver alone decides");
  });

  it("3354: redeploy is refused without a driver, on the stage box and on a box without a role", () => {
    setRole("prod");
    const none = run(`redeploy prod ${SHA}`);
    assert.equal(none.status, 3, "no driver: the redeploy is refused");
    assert.match(String(none.stderr), /release driver not installed/);
    installDriver('echo "driver-called $*"');
    for (const role of ["stage", null]) {
      if (role) setRole(role);
      else rmSync(join(root, "etc/ds-platform/box-role"), { force: true });
      const r = run(`redeploy prod ${SHA}`);
      assert.equal(r.status, 3, `redeploy on ${role}`);
      assert.match(r.stderr, /redeploy is served by the prod box only/);
      assert.equal(r.stdout, "", "the driver never ran");
    }
  });

  const rejected = [
    ["a redeploy of another env", `redeploy stage-main ${SHA}`],
    ["a redeploy with an extra argument", `redeploy prod ${SHA} --force`],
    ["a redeploy without a sha", "redeploy prod"],
    ["a redeploy with a short sha", "redeploy prod 0123456"],
    ["a rollback of another env", `rollback stage-main ${SHA}`],
    ["a rollback-status of another env", `rollback-status stage-pr-3 ${SHA}`],
    ["a rollback with an extra argument", `rollback prod ${SHA} now`],
    ["a rollback without a sha", "rollback prod"],
    ["a rollback with a short sha", "rollback prod 0123456"],
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

  // --- 3313: the data-prod verbs ------------------------------------------------------
  const IMG = (c) => `sha256:${c.repeat(64)}`;
  const tree = () => join(root, "home/deploy/ds-platform");
  const dockerStub = (out = "") => {
    writeFileSync(
      join(stubs, "docker"),
      `#!/usr/bin/env bash\necho "docker $* @$PWD" >> "$STUB_DIR/docker.log"\nprintf '%s' '${out}'\n`,
    );
    chmodSync(join(stubs, "docker"), 0o755);
  };
  // #3395: docker for the checkpoint's log-bound report; `fail` = the subcommand that errors.
  const boundsDockerStub = (fail = "") => {
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/docker.log"',
        `[[ $1 == "${fail}" ]] && { echo "Error: $1 broke" >&2; echo "second line" >&2; exit 1; }`,
        'case "$*" in',
        '  "ps -aq --filter label=com.docker.compose.project=ds-data-prod") echo pg; echo redis ;;',
        '  "ps -aq --filter label=com.docker.compose.project=ds-glitchtip") echo web ;;',
        '  inspect*) for id in "${@: -3}"; do echo "/$id log=json-file max-size=50m max-file=3"; done ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(join(stubs, "docker"), 0o755);
  };
  const shipped = (entries) =>
    gzipSync(tarArchive([{ name: "ds-platform/", type: "5" }, ...entries]));

  it("3313: the data verbs refuse (exit 3) on any box but the data box", () => {
    for (const role of [undefined, "prod", "stage"]) {
      if (role) setRole(role);
      for (const command of ["capabilities", `ship ${SHA}`, `finish ${SHA} succeeded`, "check"]) {
        const r = run(command, { input: "" });
        assert.equal(r.status, 3, `${role}: ${command}`);
        assert.match(r.stderr, /is served by the data box only/);
      }
    }
    assert.equal(log("ds-release"), "", "nothing ran");
  });

  it("3313: capabilities names the data verbs on the data box", () => {
    setRole("data");
    const r = run("capabilities");
    assert.equal(r.status, 0, r.stderr);
    const answer = JSON.parse(r.stdout);
    assert.equal(answer.role, "data");
    assert.ok(answer.verbs.includes("ship") && answer.verbs.includes("postgres-probe"));
  });

  for (const command of [
    "capabilities now",
    `ship ${SHA.slice(0, 12)}`,
    `install ${SHA} now`,
    `data-up ${SHA} retry`,
    `finish ${SHA} done`,
    `check ds-prod-${SHA.slice(0, 12)}-migrate`,
    `supersede ds-prod-${SHA.slice(0, 12)}-rollback extra`,
    "backup-info all",
    "converge",
    `converge ${SHA.slice(0, 12)}`,
    `converge ${SHA} now`,
  ]) {
    it(`3313: rejects \`${command}\` (exit 2, auth.warning) before any action`, () => {
      setRole("data");
      const r = run(command, { input: "" });
      assert.equal(r.status, 2, String(r.stderr));
      assert.match(log("logger"), /auth\.warning rejected:/);
      assert.equal(log("ds-release"), "");
    });
  }

  it("3313: postgres-checkpoint writes the checked record whole, deploy's checkpoint file", () => {
    setRole("data");
    mkdirSync(join(root, "home/deploy"), { recursive: true });
    const record = {
      schema: 1,
      sourceHash: "a".repeat(64),
      systemId: "7544271560000000001",
      images: { postgres: IMG("b"), pgbackrest: IMG("c") },
    };
    // #3395: docker lists both compose projects by label, then their log bounds.
    boundsDockerStub();
    const r = run("postgres-checkpoint", { input: JSON.stringify(record) });
    assert.equal(r.status, 0, String(r.stderr));
    const file = join(root, "home/deploy/ds-platform-postgres-state.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), record);
    assert.equal(
      r.stdout,
      "PostgreSQL checkpoint written\n" +
        "record: v1 (no hashVersion)\n" +
        "log bound: /pg log=json-file max-size=50m max-file=3\n" +
        "log bound: /redis log=json-file max-size=50m max-file=3\n" +
        "log bound: /web log=json-file max-size=50m max-file=3\n",
    );
    const calls = log("docker").split("\n");
    assert.ok(calls.includes("ps -aq --filter label=com.docker.compose.project=ds-data-prod"), log("docker"));
    assert.ok(calls.includes("ps -aq --filter label=com.docker.compose.project=ds-glitchtip"), log("docker"));
    const inspect = calls.find((l) => l.startsWith("inspect "));
    assert.ok(inspect?.includes("{{.HostConfig.LogConfig.Type}}") && inspect.endsWith(" pg redis web"), inspect);
  });

  // #3395: the log-bound report is evidence only — it never fails the checkpoint, and
  // it reads no compose file or .env (the pre-ship checkpoint runs on any tree).
  for (const [label, fail] of [
    ["docker inspect fails", "inspect"],
    ["docker ps fails", "ps"],
  ]) {
    it(`3395: postgres-checkpoint still exits 0 with no .env when ${label}, naming the report unavailable`, () => {
      setRole("data");
      mkdirSync(join(root, "home/deploy"), { recursive: true });
      const record = {
        schema: 1,
        sourceHash: "a".repeat(64),
        systemId: "7544271560000000001",
        images: { postgres: IMG("b"), pgbackrest: IMG("c") },
      };
      boundsDockerStub(fail);
      const r = run("postgres-checkpoint", { input: JSON.stringify(record) });
      assert.equal(r.status, 0, String(r.stderr));
      assert.equal(existsSync(join(tree(), "infra/deploy/compose/data-prod/.env")), false);
      assert.equal(
        r.stdout,
        `PostgreSQL checkpoint written\nrecord: v1 (no hashVersion)\nlog bounds: unavailable — Error: ${fail} broke\n`,
      );
      const calls = log("docker").split("\n");
      assert.ok(!calls.some((l) => l.startsWith("compose")), log("docker"));
      assert.ok(existsSync(join(root, "home/deploy/ds-platform-postgres-state.json")));
    });
  }

  for (const [label, patch] of [
    ["an extra field", { extra: "x" }],
    ["a string schema", { schema: "1" }],
    ["a mutable image tag", { images: { postgres: "ds-postgres:latest", pgbackrest: IMG("c") } }],
    ["a short system id", { systemId: "123" }],
    ["hashVersion 3", { hashVersion: 3 }],
    ["a string hashVersion", { hashVersion: "2" }],
  ]) {
    it(`3313: postgres-checkpoint rejects ${label} (exit 2) and writes nothing`, () => {
      setRole("data");
      mkdirSync(join(root, "home/deploy"), { recursive: true });
      const record = {
        schema: 1,
        sourceHash: "a".repeat(64),
        systemId: "7544271560000000001",
        images: { postgres: IMG("b"), pgbackrest: IMG("c") },
        ...patch,
      };
      const r = run("postgres-checkpoint", { input: JSON.stringify(record) });
      assert.equal(r.status, 2, String(r.stderr));
      assert.equal(existsSync(join(root, "home/deploy/ds-platform-postgres-state.json")), false);
    });
  }

  it("3419: postgres-checkpoint writes a v2 record with its hashVersion", () => {
    setRole("data");
    mkdirSync(join(root, "home/deploy"), { recursive: true });
    const record = {
      schema: 1,
      hashVersion: 2,
      sourceHash: "a".repeat(64),
      systemId: "7544271560000000001",
      images: { postgres: IMG("b"), pgbackrest: IMG("c") },
    };
    boundsDockerStub();
    const r = run("postgres-checkpoint", { input: JSON.stringify(record) });
    assert.equal(r.status, 0, String(r.stderr));
    const file = join(root, "home/deploy/ds-platform-postgres-state.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), record);
    // #3466: the box answers the hashVersion of the record it wrote.
    assert.equal(r.stdout.split("\n")[1], "record: hashVersion 2");
  });

  it("3313: data-env writes VPC_IP and the image override from checked fields only", () => {
    setRole("data");
    const compose = join(tree(), "infra/deploy/compose/data-prod");
    mkdirSync(compose, { recursive: true });
    const ok = run("data-env", {
      input: JSON.stringify({ vpcIp: "192.168.0.10", images: { postgres: IMG("b"), pgbackrest: IMG("c") } }),
    });
    assert.equal(ok.status, 0, String(ok.stderr));
    assert.equal(readFileSync(join(compose, ".env"), "utf8"), "VPC_IP=192.168.0.10\n");
    assert.deepEqual(JSON.parse(readFileSync(join(compose, ".postgres-artifacts.json"), "utf8")), {
      services: { postgres: { image: IMG("b") }, pgbackrest: { image: IMG("c") } },
    });
    for (const vpcIp of ["192.168.0.256", "192.168.0.10\nX=1", "::1"]) {
      const bad = run("data-env", {
        input: JSON.stringify({ vpcIp, images: { postgres: IMG("b"), pgbackrest: IMG("c") } }),
      });
      assert.equal(bad.status, 2, vpcIp);
    }
    assert.equal(readFileSync(join(compose, ".env"), "utf8"), "VPC_IP=192.168.0.10\n");
  });

  it("3313: postgres-probe runs the installed probe with only the checked request fields, HOME=deploy's", () => {
    setRole("data");
    const probe = join(root, "usr/local/lib/ds-platform/postgres-artifact-probe.py");
    mkdirSync(dirname(probe), { recursive: true });
    writeFileSync(
      probe,
      'import base64, json, os, sys\nprint(json.dumps({"home": os.environ["HOME"], "request": json.loads(base64.b64decode(sys.argv[1]))}))\n',
    );
    const target = {
      mount: { name: "pgdata", target: "/var/lib/postgresql/data", rw: true },
      sidecarMount: { name: "pgdata", target: "/var/lib/postgresql/data", rw: false },
      images: { postgres: "ds-postgres:abc", pgbackrest: IMG("c") },
      environment: { postgres: { PGDATA: "/var/lib/postgresql/data/pgdata" }, pgbackrest: {} },
      major: 17,
    };
    const request = { target, sourceHash: "d".repeat(64), preferRecordedImages: true, paths: ["compose.yml", "postgres/Dockerfile"] };
    const r = run("postgres-probe", { input: JSON.stringify(request) });
    assert.equal(r.status, 0, String(r.stderr));
    const seen = JSON.parse(r.stdout);
    assert.equal(seen.home, join(root, "home/deploy"));
    assert.deepEqual(seen.request, {
      target: {
        mount: { target: target.mount.target },
        sidecarMount: { target: target.sidecarMount.target },
        images: target.images,
        environment: target.environment,
      },
      preferRecordedImages: true,
      paths: request.paths,
      sourceHash: request.sourceHash,
    });
    for (const bad of [
      { ...request, paths: ["../etc/shadow"] },
      { ...request, script: "rm -rf /" },
      { ...request, target: { ...target, images: { postgres: "$(id)", pgbackrest: IMG("c") } } },
      { ...request, target: { ...target, mount: { target: "relative" } } },
    ]) {
      assert.equal(run("postgres-probe", { input: JSON.stringify(bad) }).status, 2, JSON.stringify(bad).slice(0, 80));
    }
  });

  it("3313: ship swaps the checked tree into deploy's live tree, root-owned modes, top dir stripped", () => {
    setRole("data");
    mkdirSync(join(tree(), "old"), { recursive: true });
    const r = run(`ship ${SHA}`, {
      input: shipped([
        { name: "ds-platform/infra/", type: "5" },
        { name: "ds-platform/infra/a.txt", body: "A" },
        { name: "ds-platform/apps/", type: "5" },
        { name: "ds-platform/.agents", type: "2", link: "apps" },
      ]),
    });
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(readFileSync(join(tree(), "infra/a.txt"), "utf8"), "A");
    assert.equal(existsSync(join(tree(), "old")), false, "the previous tree is gone");
    assert.deepEqual(
      readdirSync(join(root, "home/deploy")).filter((n) => n.startsWith(".ds-platform.ship")),
      [],
      "no staging directory left",
    );
  });

  for (const [what, entries] of [
    ["a link outside the tree", [{ name: "ds-platform/x", type: "2", link: "../../etc/passwd" }]],
    ["an absolute link", [{ name: "ds-platform/x", type: "2", link: "/etc/passwd" }]],
    ["a hard link", [{ name: "ds-platform/x", type: "1", link: "ds-platform/y" }]],
    ["a .. path", [{ name: "ds-platform/../x", body: "x" }]],
  ]) {
    it(`3313: ship refuses a tree with ${what} and keeps the live tree`, () => {
      setRole("data");
      mkdirSync(join(tree(), "old"), { recursive: true });
      const r = run(`ship ${SHA}`, { input: shipped(entries) });
      assert.equal(r.status, 3, String(r.stderr));
      assert.ok(existsSync(join(tree(), "old")), "live tree untouched");
    });
  }

  it("3313: ship rejects a stream over the cap (exit 2)", () => {
    setRole("data");
    mkdirSync(join(root, "home/deploy"), { recursive: true });
    const r = run(`ship ${SHA}`, {
      input: shipped([{ name: "ds-platform/a", body: "x".repeat(4096) }]),
      env: { DS_ENTRYPOINT_MAX_SHIP_BYTES: "64" },
    });
    assert.equal(r.status, 2);
  });

  it("3313: install puts every box entrypoint of the shipped tree in place", () => {
    setRole("data");
    for (const { path } of [...BOX_ENTRYPOINTS, ...DATA_BOX_ENTRYPOINTS]) {
      mkdirSync(dirname(join(tree(), path)), { recursive: true });
      writeFileSync(join(tree(), path), `# ${path}\n`);
    }
    const r = run(`install ${SHA}`);
    assert.equal(r.status, 0, String(r.stderr));
    for (const { dest, path } of DATA_BOX_ENTRYPOINTS) {
      assert.equal(readFileSync(join(root, dest), "utf8"), `# ${path}\n`, dest);
    }
    assert.equal(existsSync(join(root, DS_READ_ENTRYPOINT_BIN)), false, "ds-read-entrypoint is not installed on ds-data-prod");
    // #3648: the rehearsal's programs 0755, its tmpfiles.d entry 0644.
    assert.equal(statSync(join(root, "usr/local/lib/ds-platform/rehearse-migration.py")).mode & 0o777, 0o755);
    assert.equal(statSync(join(root, "etc/tmpfiles.d/ds-rehearsal.conf")).mode & 0o777, 0o644);
  });

  it("3320: converge installs the shipped entrypoints, then runs the installed harden-ssh.sh --role data --from-release", () => {
    setRole("data");
    for (const { path } of [...BOX_ENTRYPOINTS, ...DATA_BOX_ENTRYPOINTS]) {
      mkdirSync(dirname(join(tree(), path)), { recursive: true });
      writeFileSync(
        join(tree(), path),
        path.endsWith("harden-ssh.sh")
          ? '#!/usr/bin/env bash\necho "harden-ssh-called $*" >> "$STUB_DIR/harden.log"\necho "harden-ssh: nothing to change"\n'
          : `# ${path}\n`,
      );
    }
    const r = run(`converge ${SHA}`);
    assert.equal(r.status, 0, String(r.stderr));
    assert.match(r.stdout, new RegExp(`box entrypoints of ${SHA} installed`));
    assert.match(r.stdout, /harden-ssh: nothing to change/);
    assert.equal(log("harden"), "harden-ssh-called --role data --from-release\n");
    assert.match(log("sudo"), /usr\/local\/lib\/ds-platform\/harden-ssh\.sh --role data --from-release$/m);
    writeFileSync(join(tree(), "infra/deploy/bin/harden-ssh.sh"), "#!/usr/bin/env bash\necho refused >&2; exit 1\n");
    assert.equal(run(`converge ${SHA}`).status, 1, "the converge exits as harden-ssh.sh does");
  });

  it("3313: data-up and backup start their durable unit with the fixed step script", () => {
    setRole("data");
    writeFileSync(
      join(root, "usr/local/bin/ds-release"),
      '#!/usr/bin/env bash\necho "ds-release-called ${@:1:$#-1}" >> "$STUB_DIR/ds-release.log"\ncat "${@: -1}" >> "$STUB_DIR/ds-release.log"\n',
    );
    writeFileSync(join(root, "etc/ds-platform/glitchtip.env"), "SECRET_KEY=x\n");
    assert.equal(run(`data-up ${SHA}`).status, 0);
    assert.equal(run(`backup ${SHA} retry-failed`).status, 0);
    const compose = join(tree(), "infra/deploy/compose/data-prod");
    assert.equal(
      log("ds-release"),
      `ds-release-called release prod ${SHA} up\ncd '${compose}'\n` +
        "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --wait --wait-timeout 120 postgres pgbackrest\n" +
        "docker compose up -d --no-deps redis\n" +
        "docker compose -f glitchtip/compose.yml --env-file .env up -d --no-build --pull missing --wait --wait-timeout 300\n" +
        `ds-release-called release --retry-failed prod ${SHA} backup\ncd '${compose}'\n` +
        "docker compose exec -T pgbackrest /usr/local/bin/backup.sh incr\n",
    );
  });

  it("3395: data-up refuses before any unit starts when /etc/ds-platform/glitchtip.env is absent", () => {
    setRole("data");
    const r = run(`data-up ${SHA}`);
    assert.equal(r.status, 3, String(r.stderr));
    assert.match(String(r.stderr), /etc\/ds-platform\/glitchtip\.env is absent or unreadable/);
    assert.equal(log("ds-release"), "", "no durable unit started");
  });

  it("3313: finish, check and supersede call ds-release for prod only", () => {
    setRole("data");
    const unit = `ds-prod-${SHA.slice(0, 12)}-rollback`;
    for (const command of [`finish ${SHA} failed`, "check", `check ${unit}`, `supersede ${unit}`]) {
      assert.equal(run(command).status, 0, command);
    }
    assert.equal(
      log("ds-release"),
      [
        `ds-release-called finish prod ${SHA} failed`,
        "ds-release-called check prod",
        `ds-release-called check --except ${unit} prod`,
        `ds-release-called supersede --except ${unit} prod`,
        "",
      ].join("\n"),
    );
  });

  it("3313: rollback-floor and backup-info run their fixed read in the data-prod compose dir", () => {
    setRole("data");
    const compose = join(tree(), "infra/deploy/compose/data-prod");
    mkdirSync(compose, { recursive: true });
    dockerStub("ABSENT");
    const floor = run("rollback-floor");
    assert.equal(floor.status, 0, floor.stderr);
    assert.equal(floor.stdout, "ABSENT");
    assert.equal(run("backup-info").status, 0);
    assert.equal(
      log("docker"),
      `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U ds -d ds_prod -c SELECT CASE WHEN to_regclass('public.event_speakers') IS NULL THEN 'ABSENT' ELSE 'PRESENT' END @${compose}\n` +
        `docker compose exec -T pgbackrest gosu postgres pgbackrest --stanza=ds info @${compose}\n`,
    );
  });

  // --- 3646: the prod read path ---------------------------------------------------------
  // ds-api-prod's read key runs ds-read-entrypoint, which reaches ds-data-prod's
  // `read-schema` over the hop.
  // The ssh stub hands the hop's verb to this same entrypoint against a second fixture
  // root whose role is `data`, so the read runs end to end; docker answers psql with
  // the fixture envelope and pg_dump with a fixed dump text.
  const DUMP = "CREATE TABLE public.users (id uuid NOT NULL);\n";
  const ANSWER = {
    serverVersion: "17.2",
    migrations: [{ id: 1, hash: "a".repeat(64), created_at: 1767225600000 }],
    catalogue: {
      tables: [
        {
          schema: "public",
          name: "users",
          columns: [{ name: "id", type: "uuid", notNull: true, default: null, identity: null, generated: null }],
          indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)" }],
          constraints: [{ name: "users_pkey", kind: "primary key", definition: "PRIMARY KEY (id)" }],
        },
      ],
      enums: [{ schema: "public", name: "record_status", values: ["active", "archived"] }],
      sequences: [],
    },
  };
  const readEnvelope = (extra = {}) => JSON.stringify({ database: "ds_prod", readOnly: true, answer: ANSWER, ...extra });
  const dataRoot = () => join(dir, "data-root");
  const recipient = () => join(root, "usr/local/lib/ds-platform/tree/infra/deploy/keys/prod-read-recipient.pem");
  const readBoxes = ({ envelope = readEnvelope(), cert = true } = {}) => {
    setRole("prod");
    mkdirSync(join(dataRoot(), "etc/ds-platform"), { recursive: true });
    writeFileSync(join(dataRoot(), "etc/ds-platform/box-role"), "data\n");
    mkdirSync(join(dataRoot(), "home/deploy/ds-platform/infra/deploy/compose/data-prod"), { recursive: true });
    mkdirSync(join(dataRoot(), "usr/local/bin"), { recursive: true });
    writeFileSync(
      join(dataRoot(), "usr/local/bin/ds-release"),
      '#!/usr/bin/env bash\necho "data-ds-release $*" >> "$STUB_DIR/ds-release.log"\nexit "${STUB_DATA_CHECK_RC:-0}"\n',
    );
    chmodSync(join(dataRoot(), "usr/local/bin/ds-release"), 0o755);
    writeFileSync(
      join(root, "usr/local/bin/ds-release"),
      '#!/usr/bin/env bash\necho "ds-release-called $*" >> "$STUB_DIR/ds-release.log"\nexit "${STUB_CHECK_RC:-0}"\n',
    );
    writeFileSync(join(dir, "psql-reply"), envelope);
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'printf "%s\\n" "$*" >> "$STUB_DIR/docker.log"',
        'case " $* " in',
        '  *" psql "*) cat > "$STUB_DIR/psql-stdin.log"',
        '    [[ -z ${STUB_PSQL_ERR:-} ]] || { echo "$STUB_PSQL_ERR" >&2; exit 1; }',
        '    cat "$STUB_DIR/psql-reply" ;;',
        `  *" pg_dump "*) [[ -z \${STUB_DUMP_RC:-} ]] || exit "$STUB_DUMP_RC"; printf '%s' '${DUMP.trimEnd()}'; echo ;;`,
        "esac",
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "docker"), 0o755);
    writeFileSync(
      join(stubs, "ssh"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/ssh.log"',
        'cmd=${*: -1}',
        '[[ $cmd == check && -n ${STUB_HOP_CHECK_RC:-} ]] && exit "$STUB_HOP_CHECK_RC"',
        `DS_ENTRYPOINT_ROOT="${dataRoot()}" SSH_ORIGINAL_COMMAND="$cmd" exec bash "${ENTRYPOINT}"`,
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "ssh"), 0o755);
    if (cert) {
      mkdirSync(dirname(recipient()), { recursive: true });
      const made = spawnSync(
        "openssl",
        ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "result.key"), "-out", recipient(),
          "-subj", "/CN=ds-prod-read-test", "-days", "1"],
        { encoding: "utf8" },
      );
      assert.equal(made.status, 0, made.stderr);
    }
  };
  const readRun = (command, opts = {}) => {
    const env = {
      ...process.env,
      PATH: `${stubs}${delimiter}${process.env.PATH}`,
      STUB_DIR: dir,
      DS_ENTRYPOINT_ROOT: root,
      SSH_ORIGINAL_COMMAND: command,
      ...(opts.env ?? {}),
    };
    const r = spawnSync("bash", [opts.bin ?? READ_ENTRYPOINT, ...(opts.args ?? [])], { env, input: opts.input ?? "" });
    return { status: r.status, stdout: r.stdout, stderr: String(r.stderr) };
  };
  const decrypt = (ciphertext) => {
    writeFileSync(join(dir, "result.cms"), ciphertext);
    const r = spawnSync(
      "openssl",
      ["cms", "-decrypt", "-inform", "DER", "-in", join(dir, "result.cms"), "-inkey", join(dir, "result.key"), "-recip", recipient()],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  it("3646: ds-read-entrypoint capabilities names the read verbs, in plaintext, on the prod box", () => {
    readBoxes({ cert: false });
    const r = readRun("capabilities");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(String(r.stdout)), { role: "prod", mode: "read", verbs: ["capabilities", "schema", "observe", "rehearse", "rehearsal-status", "recovery-bundle", "recovery-check"] });
    assert.match(log("logger"), /auth\.info accepted: capabilities/);
  });

  it("3646: the read commands are refused (exit 3) on any box but the prod box", () => {
    for (const role of [undefined, "data", "stage"]) {
      if (role) setRole(role);
      for (const command of ["capabilities", "schema"]) {
        const r = readRun(command);
        assert.equal(r.status, 3, `${role}: ${command}`);
        assert.match(r.stderr, /the read commands are served by the prod box only/);
      }
    }
    assert.equal(log("ds-release"), "");
  });

  for (const command of [
    `status prod ${SHA}`,
    `release prod ${SHA}`,
    `rollback prod ${SHA}`,
    `rollback-status prod ${SHA}`,
    `redeploy prod ${SHA}`,
    "observe",
    "observe table-rows now",
    "observe 9-rows",
    "read-observe table-rows",
    "rehearse",
    `rehearse ${SHA.slice(0, 12)}`,
    `rehearse ${SHA} now`,
    `rehearsal-status`,
    "read-schema",
    "check",
    `converge ${SHA}`,
    "schema now",
    "capabilities all",
    "upload-report",
    ...DATA_VERBS.filter((v) => v !== "capabilities"),
  ]) {
    it(`3646: ds-read-entrypoint rejects \`${command}\` (exit 2, auth.warning), nothing run`, () => {
      readBoxes({ cert: false });
      installDriver('echo "driver-called $*" >> "$STUB_DIR/driver.log"');
      const r = readRun(command);
      assert.equal(r.status, 2, r.stderr);
      assert.match(log("logger"), /auth\.warning rejected:/);
      assert.equal(log("ds-release") + log("driver") + log("ssh") + log("docker"), "", "nothing ran");
    });
  }

  it("3646: ds-deploy-entrypoint serves no read verb on the prod box; ds-read-entrypoint takes no argument", () => {
    readBoxes({ cert: false });
    assert.equal(readRun("schema", { bin: ENTRYPOINT }).status, 2);
    const caps = readRun("capabilities", { bin: ENTRYPOINT });
    assert.equal(caps.status, 3, "capabilities on ds-deploy-entrypoint is the data box's");
    for (const args of [["--read"], ["--write"], [""]]) {
      assert.equal(readRun("capabilities", { args }).status, 2, JSON.stringify(args));
    }
    assert.equal(log("ssh"), "");
  });

  // The downgrade an install of a pre-#3646 tree makes: it rewrites ds-deploy-entrypoint
  // (an older one ignores its arguments and serves every deploy verb) but never the
  // read entrypoint. The read key must still reach only ds-read-entrypoint's verbs.
  it("3646: with an older ds-deploy-entrypoint installed, the read key reaches only ds-read-entrypoint", () => {
    readBoxes();
    const old = join(root, "usr/local/bin/ds-deploy-entrypoint");
    writeFileSync(old, '#!/usr/bin/env bash\necho "old-entrypoint $SSH_ORIGINAL_COMMAND" >> "$STUB_DIR/old.log"\nexit 0\n');
    chmodSync(old, 0o755);
    installDriver('echo "driver-called $*" >> "$STUB_DIR/driver.log"');
    for (const command of [`release prod ${SHA}`, `rollback prod ${SHA}`, `redeploy prod ${SHA}`, `status prod ${SHA}`]) {
      assert.equal(readRun(command).status, 2, command);
    }
    assert.equal(log("old") + log("driver") + log("ds-release"), "", "no deploy verb ran");
    const r = readRun("schema");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(decrypt(r.stdout).verb, "schema");
    assert.equal(log("old"), "", "the read path never runs ds-deploy-entrypoint on ds-api-prod");
    // Statically: the read binary neither execs nor sources the deploy entrypoint.
    const code = readFileSync(READ_ENTRYPOINT, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l));
    assert.deepEqual(code.filter((l) => l.includes("ds-deploy-entrypoint")), ["DATA_TAG=ds-deploy-entrypoint"]);
  });

  it("3646: the read and data entrypoints carry the same fixed read reasons", () => {
    const reasons = (file) => {
      const text = readFileSync(file, "utf8");
      const start = text.indexOf("READ_REASONS=(\n");
      return text.slice(start, text.indexOf("\n)\n", start));
    };
    assert.ok(reasons(READ_ENTRYPOINT).includes("'the read failed'"));
    assert.equal(reasons(READ_ENTRYPOINT), reasons(ENTRYPOINT));
  });

  it("3646: schema answers the ds_prod snapshot, encrypted to the recipient: no plaintext on stdout", () => {
    readBoxes();
    const r = readRun("schema");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes("ds_prod") && !r.stdout.includes("users_pkey"), "ciphertext only");
    const answer = decrypt(r.stdout);
    assert.ok(!Number.isNaN(Date.parse(answer.takenAt)) && answer.takenAt.endsWith("Z"), "takenAt is a UTC timestamp");
    assert.deepEqual(answer, {
      verb: "schema",
      database: "ds_prod",
      takenAt: answer.takenAt,
      serverVersion: ANSWER.serverVersion,
      migrations: ANSWER.migrations,
      dumpSha256: createHash("sha256").update(DUMP).digest("hex"),
      catalogue: ANSWER.catalogue,
    });
    // The release check ran on both boxes before the read, then the one data verb.
    assert.equal(log("ds-release"), "ds-release-called check prod\ndata-ds-release check prod\n");
    const hops = log("ssh").trimEnd().split("\n");
    assert.deepEqual(hops.map((l) => l.split(" ").at(-1)), ["check", "read-schema"]);
    for (const flag of ["-n", "IdentitiesOnly=yes", "BatchMode=yes", "StrictHostKeyChecking=yes", "deploy@192.168.0.10"]) {
      assert.ok(hops[1].split(" ").includes(flag), flag);
    }
    assert.match(hops[1], /-i \S*home\/deploy\/\.ssh\/data-prod-hop /);
    assert.match(hops[1], /UserKnownHostsFile=\S*home\/deploy\/\.ssh\/known_hosts /);
    // The catalogue read: one read-only transaction with the spec's timeouts.
    const sql = log("psql-stdin");
    assert.match(sql, /^BEGIN READ ONLY;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '2s';\n/);
    assert.match(sql, /current_setting\('transaction_read_only'\) = 'on'/);
    assert.match(sql, /FROM drizzle\.__drizzle_migrations m/);
    assert.match(sql, /pg_get_indexdef\(x\.indexrelid\)/);
    assert.match(sql, /pg_get_constraintdef\(k\.oid\)/);
    // #3683: each table names its partition parent, so pg_partman's children are not drift.
    assert.match(sql, /FROM pg_inherits h JOIN pg_class p ON p\.oid = h\.inhparent/);
    assert.match(sql, /WHERE h\.inhrelid = c\.oid AND c\.relispartition\) AS "partitionOf"/);
    assert.match(sql, /ROLLBACK;\n$/);
    const docker = log("docker");
    assert.match(docker, /^compose exec -T -e PGCLIENTENCODING=UTF8 postgres psql -X -qAt -v ON_ERROR_STOP=1 -U ds -d ds_prod -f -$/m);
    assert.match(
      docker,
      /^compose exec -T -e PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30s postgres timeout 100 pg_dump --schema-only --no-comments --no-owner --no-privileges --lock-wait-timeout=2s -U ds ds_prod$/m,
    );
  });

  it("3646: schema refuses (exit 3) without the recipient certificate, before any read", () => {
    readBoxes({ cert: false });
    const r = readRun("schema");
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /recipient certificate is not installed/);
    assert.equal(log("ds-release") + log("ssh") + log("docker"), "");
  });

  it("3646: schema refuses (exit 3) when openssl cannot encrypt to the installed certificate", () => {
    readBoxes();
    writeFileSync(recipient(), "not a certificate\n");
    const r = readRun("schema");
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /openssl cannot encrypt to the recipient certificate/);
    assert.equal(r.stdout.length, 0, "nothing reaches stdout");
  });

  for (const [label, env] of [
    ["a ds-prod-* unit runs on ds-api-prod", { STUB_CHECK_RC: "3" }],
    ["a ds-prod-* unit runs on ds-data-prod", { STUB_DATA_CHECK_RC: "3" }],
  ]) {
    it(`3646: schema fails (exit 1, a release step is running) while ${label}`, () => {
      readBoxes();
      const r = readRun("schema", { env });
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stderr, "ds-read-entrypoint: a release step is running\n");
      assert.ok(!log("ssh").includes("read-schema"), "no read");
      assert.equal(log("docker"), "");
    });
  }

  for (const [label, setup, reason] of [
    ["the transaction is not read-only", { envelope: readEnvelope({ readOnly: false, answer: null }) }, "the read-only transaction check failed"],
    ["the read reached another database", { envelope: readEnvelope({ database: "postgres" }) }, "the read-only transaction check failed"],
    ["psql times out", { env: { STUB_PSQL_ERR: "ERROR:  canceling statement due to statement timeout" } }, "the read timed out"],
    ["a lock waits too long", { env: { STUB_PSQL_ERR: "ERROR:  canceling statement due to lock timeout" } }, "the read timed out"],
    ["psql fails otherwise", { env: { STUB_PSQL_ERR: 'ERROR:  relation "drizzle.__drizzle_migrations" does not exist' } }, "the read failed"],
    ["psql answers no JSON", { envelope: "garbage" }, "the read failed"],
    ["the in-container timeout stops pg_dump", { env: { STUB_DUMP_RC: "124" } }, "the read timed out"],
  ]) {
    it(`3646: schema fails (exit 1) with the fixed reason when ${label}, nothing of the diagnostic leaves`, () => {
      readBoxes({ envelope: setup.envelope });
      const r = readRun("schema", { env: setup.env ?? {} });
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stderr, `ds-read-entrypoint: ${reason}\n`);
      assert.equal(r.stdout.length, 0);
    });
  }

  it("3646: a hop the data box answers with an unknown verb refuses (exit 3); a dead hop fails (exit 1)", () => {
    readBoxes();
    writeFileSync(
      join(stubs, "ssh"),
      '#!/usr/bin/env bash\ncmd=${*: -1}\n[[ $cmd == check ]] && exit 0\necho "ds-deploy-entrypoint: rejected: unknown command" >&2\nexit 2\n',
    );
    const old = readRun("schema");
    assert.equal(old.status, 3, old.stderr);
    assert.match(old.stderr, /ds-data-prod does not serve read-schema/);
    writeFileSync(join(stubs, "ssh"), '#!/usr/bin/env bash\necho "ssh: connect to host: secret detail" >&2\nexit 255\n');
    const dead = readRun("schema");
    assert.equal(dead.status, 1);
    assert.equal(dead.stderr, "ds-read-entrypoint: the read failed\n");
  });

  // --- 3648: the migration rehearsal over the read path ------------------------------
  // curl answers GitHub's compare and serves a codeload tree; the hop runs the data
  // entrypoint, which runs the repository harness under the data root with the box
  // tools faked (rehearse-migration-fake.py); flock runs its command unless busy.
  const HARNESS = resolve(here, "../../infra/deploy/bin/rehearse-migration.py");
  const CLEANUP = resolve(here, "../../infra/deploy/bin/rehearse-cleanup");
  const FAKE = resolve(here, "rehearse-migration-fake.py");
  const rehearseBoxes = ({ compare = "behind", liveNewest = 3000 } = {}) => {
    readBoxes();
    const lib = join(dataRoot(), "usr/local/lib/ds-platform");
    mkdirSync(lib, { recursive: true });
    copyFileSync(HARNESS, join(lib, "rehearse-migration.py"));
    copyFileSync(CLEANUP, join(lib, "rehearse-cleanup"));
    chmodSync(join(lib, "rehearse-cleanup"), 0o755);
    mkdirSync(join(dataRoot(), "proc"), { recursive: true });
    writeFileSync(join(dataRoot(), "proc/meminfo"), "MemAvailable: 4000000 kB\n");
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({ liveNewest }));
    // A codeload tree: one top directory, the migrations among other files.
    const journal = { entries: [{ idx: 0, when: 1000, tag: "0000_init" }, { idx: 1, when: 3000, tag: "0001_users" }] };
    const made = spawnSync("python3", ["-I", "-c", [
      "import io, json, sys, tarfile",
      "j = sys.argv[2]",
      "files = {'ds-platform-x/apps/api/drizzle/meta/_journal.json': j,",
      "  'ds-platform-x/apps/api/drizzle/0000_init.sql': 'CREATE TABLE a (id int);',",
      "  'ds-platform-x/apps/api/drizzle/0001_users.sql': 'ALTER TABLE a ADD b int;',",
      "  'ds-platform-x/apps/api/drizzle/meta/0001_snapshot.json': '{}',",
      "  'ds-platform-x/README.md': 'x'}",
      "with tarfile.open(sys.argv[1], 'w:gz') as t:",
      "    for n, d in files.items():",
      "        b = d.encode(); i = tarfile.TarInfo(n); i.size = len(b); t.addfile(i, io.BytesIO(b))",
    ].join("\n"), join(dir, "tree.tar.gz"), JSON.stringify(journal)], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    writeFileSync(
      join(stubs, "curl"),
      [
        "#!/usr/bin/env bash",
        'echo "curl $*" >> "$STUB_DIR/curl.log"',
        'out=; for ((i = 1; i <= $#; i++)); do [[ ${!i} == -o ]] && { j=$((i + 1)); out=${!j}; }; done',
        'case "${*: -1}" in',
        `  */compare/*) [[ ${compare === null ? "1" : "0"} == 0 ]] || exit 22; echo '{"status":"${compare}"}' ;;`,
        `  *) cp "${join(dir, "tree.tar.gz")}" "$out" ;;`,
        "esac",
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "curl"), 0o755);
    writeFileSync(
      join(stubs, "flock"),
      '#!/usr/bin/env bash\necho "flock $*" >> "$STUB_DIR/flock.log"\n[[ -z ${STUB_FLOCK_BUSY:-} ]] || exit 75\nshift 4\nexec "$@"\n',
    );
    chmodSync(join(stubs, "flock"), 0o755);
  };
  const rehearseEnv = (extra = {}) => ({
    DS_REHEARSE_FAKE: FAKE,
    DS_REHEARSE_FREE_BYTES: String(100 * 1024 ** 3),
    FAKE_SCENARIO: join(dir, "scenario.json"),
    FAKE_LOG: join(dir, "fake.log"),
    ...extra,
  });

  it("3648: rehearse checks the SHA is in main, ships only the migrations, answers encrypted with a plaintext state word", () => {
    rehearseBoxes();
    const r = readRun(`rehearse ${SHA}`, { env: rehearseEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "ds-read-entrypoint: state no pending migrations\n");
    assert.ok(!r.stdout.includes("no pending"), "ciphertext only");
    assert.deepEqual(decrypt(r.stdout), { verb: "rehearse", sha: SHA, state: "no pending migrations", pending: 0 });
    const curl = log("curl").trimEnd().split("\n");
    // refs/heads/main, never a bare `main` a tag of that name could shadow.
    assert.match(curl[0], new RegExp(`/compare/refs/heads/main\\.\\.\\.${SHA}$`));
    assert.match(curl[1], new RegExp(`codeload\\.github\\.com/doctor-school/ds-platform/tar\\.gz/${SHA}$`));
    // The release check on both boxes ran first; the data verb carried the archive.
    assert.equal(log("ds-release"), "ds-release-called check prod\ndata-ds-release check prod\n");
    const hops = log("ssh").trimEnd().split("\n").map((l) => l.split("deploy@192.168.0.10 ")[1]);
    assert.deepEqual(hops, ["check", `rehearse ${SHA}`]);
    assert.ok(!log("ssh").split("\n")[1].split(" ").includes("-n"), "the archive rides the hop's stdin");
    assert.match(log("flock"), /^flock -n -E 75 \S*\/run\/ds-platform\/ds-rehearsal\.lock python3 -I \S*rehearse-migration\.py start /m);
    const report = JSON.parse(readFileSync(join(dataRoot(), `var/lib/ds-platform/rehearsal/${SHA}.json`), "utf8"));
    assert.equal(report.pending, 0);
    const status = readRun(`rehearsal-status ${SHA}`, { env: rehearseEnv() });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stderr, "ds-read-entrypoint: state succeeded\n");
    assert.equal(decrypt(status.stdout).pending, 0);
  });

  it("3648: rehearse with a pending migration starts the durable unit and answers `started`", () => {
    rehearseBoxes({ liveNewest: 1000 });
    const r = readRun(`rehearse ${SHA}`, { env: rehearseEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "ds-read-entrypoint: state started\n");
    assert.deepEqual(decrypt(r.stdout), { verb: "rehearse", sha: SHA, state: "started", pending: 1 });
    const unit = readFileSync(join(dir, "fake.log"), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l)).find((c) => c.tool === "systemd-run");
    assert.ok(unit.args.includes(`--unit=ds-rehearse-${SHA.slice(0, 12)}`));
  });

  for (const [label, compare] of [["ahead of main", "ahead"], ["diverged from main", "diverged"], ["unknown to GitHub", null]]) {
    it(`3648: rehearse rejects (exit 2) a SHA ${label}, before any download or hop`, () => {
      rehearseBoxes({ compare });
      const r = readRun(`rehearse ${SHA}`, { env: rehearseEnv() });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /contained in main/);
      assert.ok(!log("curl").includes("codeload"), "no download");
      assert.ok(!log("ssh").includes("rehearse"), "no data verb");
      assert.match(log("logger"), /auth\.warning rejected:/);
    });
  }

  it("3648: rehearse fails (exit 1, a rehearsal is running) while the lock is held; a release step refuses it first", () => {
    rehearseBoxes();
    const busy = readRun(`rehearse ${SHA}`, { env: rehearseEnv({ STUB_FLOCK_BUSY: "1" }) });
    assert.equal(busy.status, 1);
    assert.equal(busy.stderr, "ds-read-entrypoint: a rehearsal is running\n");
    assert.equal(busy.stdout.length, 0);
    const release = readRun(`rehearse ${SHA}`, { env: rehearseEnv({ STUB_DATA_CHECK_RC: "3" }) });
    assert.equal(release.status, 1);
    assert.equal(release.stderr, "ds-read-entrypoint: a release step is running\n");
  });

  it("3648: rehearsal-status reads no database and runs no release check; absent before any rehearsal", () => {
    rehearseBoxes();
    const r = readRun(`rehearsal-status ${SHA}`, { env: rehearseEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "ds-read-entrypoint: state absent\n");
    assert.deepEqual(decrypt(r.stdout), { verb: "rehearsal-status", sha: SHA, state: "absent" });
    assert.equal(log("ds-release") + log("curl"), "");
    assert.equal(log("docker"), "");
  });

  it("3648: the data box's rehearse rejects (exit 2) an archive over 16 MiB; elsewhere it is the data box's verb", () => {
    setRole("prod");
    assert.equal(run(`rehearse ${SHA}`).status, 3);
    rehearseBoxes();
    const r = spawnSync("bash", [ENTRYPOINT], {
      env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: dir, DS_ENTRYPOINT_ROOT: dataRoot(), SSH_ORIGINAL_COMMAND: `rehearse ${SHA}`, ...rehearseEnv() },
      input: Buffer.alloc(16 * 1024 * 1024 + 1),
    });
    assert.equal(r.status, 2, String(r.stderr));
    assert.match(String(r.stderr), /the migration archive exceeds 16777216 bytes/);
    assert.equal(log("flock"), "");
  });

  // --- 3647: observe <name> → read-observe <name> → PROD_OBSERVATIONS ----------------
  const EVENT = "11111111-2222-4333-8444-555555555555";
  const observeEnvelope = (rows, extra = {}) => JSON.stringify({ database: "ds_prod", readOnly: true, rows, ...extra });
  const hops = () => log("ssh").split("\n").filter(Boolean).map((l) => l.split(" ").slice(-2).join(" "));

  it("3647: observe answers one PROD_OBSERVATIONS entry, encrypted, its parameters psql variables in a read-only transaction", () => {
    readBoxes({ envelope: observeEnvelope([{ bucket: "sent", count: 12 }, { bucket: "failed", count: 3 }, { bucket: "none", count: 4 }]) });
    const r = readRun("observe registrations-by-mail-status", { input: JSON.stringify({ eventId: EVENT }) });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(String(r.stdout), /sent|suppressed/, "only ciphertext on stdout");
    const answer = decrypt(r.stdout);
    assert.deepEqual(Object.keys(answer), ["verb", "name", "takenAt", "result"]);
    assert.equal(answer.verb, "observe");
    assert.equal(answer.name, "registrations-by-mail-status");
    assert.match(answer.takenAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(answer.result, { buckets: [{ bucket: "sent", count: 12 }, { bucket: "suppressed", count: "<10" }] });
    assert.deepEqual(hops().map((h) => h.split(" ").at(-1)), ["check", "registrations-by-mail-status"]);
    assert.ok(log("ssh").includes("read-observe registrations-by-mail-status"), log("ssh"));
    const psql = log("docker").split("\n").find((l) => l.includes(" psql "));
    assert.ok(psql.includes(`-v event_id=${EVENT}`) && psql.includes("-U ds -d ds_prod -f -"), psql);
    const sql = log("psql-stdin");
    assert.match(sql, /^BEGIN READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '2s';/);
    assert.match(sql, /event_id = :'event_id'::uuid/);
    assert.ok(!sql.includes(EVENT), "the value never reaches the SQL text");
    assert.match(sql, /ROLLBACK;\n$/);
  });

  for (const [label, command, input, reason] of [
    ["an unknown name", "observe no-such-entry", "{}", /rejected: unknown observation/],
    ["a missing parameter", "observe event-registrations", JSON.stringify({ eventId: EVENT }), /bad parameters for event-registrations/],
    ["an extra parameter", "observe registrations-by-mail-status", JSON.stringify({ eventId: EVENT, x: 1 }), /bad parameters for/],
    ["an email for an id", "observe registrations-by-mail-status", JSON.stringify({ eventId: "a@example.test" }), /bad parameters for/],
    ["a number for an id", "observe registrations-by-mail-status", JSON.stringify({ eventId: 7 }), /bad parameters for/],
    ["a table outside the entry's list", "observe table-rows", JSON.stringify({ table: "pg_authid" }), /bad parameters for table-rows/],
    ["an impossible date", "observe event-registrations", JSON.stringify({ eventId: EVENT, since: "2026-02-31" }), /bad parameters for/],
    ["a JSON array", "observe table-rows", "[1]", /the parameters are not one JSON object/],
    ["not JSON", "observe table-rows", "{table", /the parameters are not one JSON object/],
    ["over 4 KiB", "observe table-rows", JSON.stringify({ table: "x".repeat(4096) }), /the parameters exceed 4096 bytes/],
  ]) {
    it(`3647: observe rejects ${label} (exit 2), nothing read`, () => {
      readBoxes({ envelope: observeEnvelope([{ rows: 30 }]) });
      const r = readRun(command, { input });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, reason);
      assert.equal(String(r.stdout), "");
      assert.ok(!log("docker").includes(" psql "), "no read");
      assert.match(log("logger"), /auth\.warning rejected:/);
    });
  }

  for (const [label, opts, reason] of [
    ["a ds-prod-* unit runs on ds-api-prod", { env: { STUB_CHECK_RC: "3" } }, "a release step is running"],
    ["a ds-prod-* unit runs on ds-data-prod", { env: { STUB_HOP_CHECK_RC: "3" } }, "a release step is running"],
    ["psql times out", { env: { STUB_PSQL_ERR: "ERROR:  canceling statement due to statement timeout" } }, "the read timed out"],
    ["a lock waits too long", { env: { STUB_PSQL_ERR: "ERROR:  canceling statement due to lock timeout" } }, "the read timed out"],
    ["psql fails", { env: { STUB_PSQL_ERR: "ERROR:  relation does not exist" } }, "the read failed"],
    ["the transaction was not read-only", { envelope: observeEnvelope([{ rows: 30 }], { readOnly: false }) }, "the read-only transaction check failed"],
    ["another database answered", { envelope: observeEnvelope([{ rows: 30 }], { database: "postgres" }) }, "the read-only transaction check failed"],
    ["an undeclared column", { envelope: observeEnvelope([{ rows: 30, email: "a@example.test" }]) }, "the read failed"],
    ["a non-integer count", { envelope: observeEnvelope([{ rows: "30" }]) }, "the read failed"],
    ["two rows for one", { envelope: observeEnvelope([{ rows: 30 }, { rows: 31 }]) }, "the read failed"],
  ]) {
    it(`3647: observe fails (exit 1, one fixed reason) when ${label}, and prints nothing`, () => {
      readBoxes({ envelope: opts.envelope ?? observeEnvelope([{ rows: 30 }]) });
      const r = readRun("observe table-rows", { input: JSON.stringify({ table: "users" }), env: opts.env });
      assert.equal(r.status, 1, r.stderr);
      assert.equal(r.stderr.trim().split("\n").at(-1), `ds-read-entrypoint: ${reason}`);
      assert.equal(String(r.stdout), "");
      assert.doesNotMatch(r.stderr, /a@example|relation/);
      if (reason === "a release step is running") assert.ok(!log("ssh").includes("read-observe"), "no read");
    });
  }

  it("3647: read-observe on the data box takes a catalogue name only, and is no verb elsewhere", () => {
    setRole("prod");
    assert.equal(run("read-observe table-rows", { input: "{}" }).status, 3);
    setRole("data");
    for (const command of ["read-observe", "read-observe table-rows now", "read-observe 9-rows"]) {
      const r = run(command, { input: "{}" });
      assert.equal(r.status, 2, command);
      assert.match(r.stderr, /usage: read-observe <name>/);
    }
  });

  // The aggregate guard of spec §5 `observe <name>`: every entry runs against a fixture
  // database (a throw-away PostgreSQL cluster) through the real entrypoints, and its
  // answer is aggregates only, the small buckets and counts suppressed.
  it("3647: every PROD_OBSERVATIONS entry runs against a fixture database and answers aggregates only", { skip: !PG_BIN && !process.env.CI && "needs PostgreSQL server binaries" }, () => {
    assert.ok(PG_BIN, "CI Linux has the PostgreSQL server binaries (initdb, pg_ctl)");
    readBoxes();
    const data = join(dir, "pg");
    const sock = mkdtempSync(join(tmpdir(), "pgs-"));
    const pg = (bin, args) => {
      const r = spawnSync(join(PG_BIN, bin), args, { encoding: "utf8" });
      assert.equal(r.status, 0, `${bin}: ${r.stderr}`);
      return r.stdout;
    };
    const psql = (db, sql) => pg("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", sock, "-p", "54329", "-U", "ds", "-d", db, "-c", sql]);
    pg("initdb", ["-D", data, "-U", "ds", "-A", "trust", "-E", "UTF8", "--no-locale"]);
    pg("pg_ctl", ["-D", data, "-l", join(dir, "pg.log"), "-w", "-o", `-c listen_addresses='' -k ${sock} -p 54329 -c fsync=off`, "start"]);
    try {
      psql("postgres", "CREATE DATABASE ds_prod");
      const id = (n) => `('00000000-0000-4000-8000-' || lpad((${n})::text, 12, '0'))::uuid`;
      psql("ds_prod", [
        "CREATE TYPE confirmation_mail_status AS ENUM ('sent', 'failed')",
        "CREATE TABLE users (id uuid PRIMARY KEY, email text)",
        "CREATE TABLE events (id uuid PRIMARY KEY)",
        "CREATE TABLE consent_records (id serial PRIMARY KEY)",
        "CREATE TABLE registrations (id serial PRIMARY KEY, user_id uuid NOT NULL, event_id uuid NOT NULL, registered_at timestamptz NOT NULL, deleted_at timestamptz, confirmation_mail_status confirmation_mail_status)",
        `INSERT INTO users SELECT ${id("i")}, 'doctor' || i || '@example.test' FROM generate_series(1, 25) i`,
        `INSERT INTO events VALUES ('${EVENT}'), (${id(99)})`,
        "INSERT INTO consent_records (id) SELECT i FROM generate_series(1, 3) i",
        // EVENT: 12 sent (users 1-12, Oct 1), 3 failed (users 1-3, Oct 5), 4 with no mail
        // (users 13-16, Oct 5), 2 deleted; the other event 5 sent.
        `INSERT INTO registrations (user_id, event_id, registered_at, confirmation_mail_status) SELECT ${id("i")}, '${EVENT}', '2026-10-01', 'sent' FROM generate_series(1, 12) i`,
        `INSERT INTO registrations (user_id, event_id, registered_at, confirmation_mail_status) SELECT ${id("i")}, '${EVENT}', '2026-10-05', 'failed' FROM generate_series(1, 3) i`,
        `INSERT INTO registrations (user_id, event_id, registered_at) SELECT ${id("i")}, '${EVENT}', '2026-10-05' FROM generate_series(13, 16) i`,
        `INSERT INTO registrations (user_id, event_id, registered_at, deleted_at, confirmation_mail_status) SELECT ${id("i")}, '${EVENT}', '2026-10-05', now(), 'sent' FROM generate_series(20, 21) i`,
        `INSERT INTO registrations (user_id, event_id, registered_at, confirmation_mail_status) SELECT ${id("i")}, ${id(99)}, '2026-10-01', 'sent' FROM generate_series(1, 5) i`,
      ].join(";\n"));
      writeFileSync(
        join(stubs, "docker"),
        [
          "#!/usr/bin/env bash",
          'printf "%s\\n" "$*" >> "$STUB_DIR/docker.log"',
          'args=("$@"); i=0',
          'while [[ ${args[$i]} != psql ]]; do i=$((i + 1)); done',
          `exec env PGCLIENTENCODING=UTF8 "${join(PG_BIN, "psql")}" -h "${sock}" -p 54329 "\${args[@]:$((i + 1))}"`,
        ].join("\n") + "\n",
      );
      chmodSync(join(stubs, "docker"), 0o755);
      const cases = [
        ["table-rows", { table: "users" }, { rows: 25 }],
        ["table-rows", { table: "consent_records" }, { rows: "<10" }],
        ["table-rows", { table: "registrations" }, { rows: 26 }],
        ["table-rows", { table: "events" }, { rows: "<10" }],
        ["event-registrations", { eventId: EVENT, since: "2026-01-01" }, { registrations: 19, doctors: 16 }],
        ["event-registrations", { eventId: EVENT, since: "2026-10-02" }, { registrations: "<10", doctors: "<10" }],
        ["registrations-by-mail-status", { eventId: EVENT }, { buckets: [{ bucket: "sent", count: 12 }, { bucket: "suppressed", count: "<10" }] }],
        ["registrations-by-mail-status", { eventId: "00000000-0000-4000-8000-000000000099" }, { buckets: [{ bucket: "suppressed", count: "<10" }] }],
      ];
      for (const [name, params, result] of cases) {
        const r = readRun(`observe ${name}`, { input: JSON.stringify(params) });
        assert.equal(r.status, 0, `${name} ${JSON.stringify(params)}: ${r.stderr}`);
        const answer = decrypt(r.stdout);
        assert.equal(answer.name, name);
        assert.deepEqual(answer.result, result, `${name} ${JSON.stringify(params)}`);
        assert.doesNotMatch(JSON.stringify(answer), /@example\.test|00000000-0000-4000-8000/, "no row data");
      }
      assert.deepEqual(
        [...new Set(cases.map(([name]) => name))].sort(),
        Object.keys(prodObservations()).sort(),
        "every catalogue entry runs against the fixture database",
      );
    } finally {
      spawnSync(join(PG_BIN, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
      rmSync(sock, { recursive: true, force: true });
    }
  });

  it("3646: read-schema on the data box answers plaintext over the hop only to ds-read-entrypoint; elsewhere it is the data box's verb", () => {
    setRole("prod");
    const r = run("read-schema");
    assert.equal(r.status, 3, "a data verb on a non-data box");
    assert.match(r.stderr, /is served by the data box only/);
  });
});

// --- 3647: PROD_OBSERVATIONS, the prod catalogue of `observe` (spec §5 «Prod read verbs.»)
// Static over the catalogue and its folding code; every entry also runs against a
// fixture database above (CI Linux).
describe("3647: PROD_OBSERVATIONS", { skip: !PYTHON && "needs python3" }, () => {
  const catalogue = () => prodObservations();

  it("3647: every entry declares aggregate result columns only, its parameters typed, its tables its own list", () => {
    const schemaDir = resolve(here, "../../packages/db/src/schema");
    const tables = new Set(
      readdirSync(schemaDir).flatMap((f) =>
        [...readFileSync(join(schemaDir, f), "utf8").matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
      ),
    );
    const entries = Object.entries(catalogue());
    assert.ok(entries.length >= 2, "the catalogue has entries");
    for (const [name, { result, sql, params }] of entries) {
      assert.match(name, /^[a-z][a-z0-9-]{0,39}$/, name);
      if (result !== "bucket") {
        assert.ok(Object.keys(result).length > 0, name);
        for (const kind of Object.values(result)) assert.ok(["count", "distinct"].includes(kind), `${name}: ${kind}`);
      }
      assert.ok(!sql.includes(";"), `${name}: one statement, inside the envelope`);
      const values = new Set([...sql.matchAll(/:'([a-z_]+)'/g)].map((m) => m[1]));
      const idents = new Set([...sql.matchAll(/:"([a-z_]+)"/g)].map((m) => m[1]));
      const declared = Object.values(params);
      assert.deepEqual([...values].sort(), declared.filter(([k]) => k === "value").map(([, v]) => v).sort(), `${name}: value variables`);
      assert.deepEqual([...idents].sort(), declared.filter(([k]) => k === "identifier").map(([, v]) => v).sort(), `${name}: identifier variables`);
      for (const [kind, , names] of declared) {
        assert.ok(["value", "identifier"].includes(kind), `${name}: ${kind}`);
        if (kind === "identifier") for (const t of names) assert.ok(tables.has(t), `${name}: ${t} is a table of packages/db`);
      }
    }
  });

  it("3647: no value parameter admits an email or a phone", () => {
    const admitted = readObservePy(
      [
        "samples = ['a@example.test', 'doctor@doctor.school', '+79991234567', '79991234567', '89991234567', '+1 999 123 45 67', 'Иванова Мария', '']",
        "print(json.dumps([[n, s] for n, e in m.PROD_OBSERVATIONS.items() for p in e['params'].values() if p[0] == 'value' for s in samples if m.checked(p, s) is not None]))",
      ].join("\n"),
    );
    assert.deepEqual(admitted, []);
  });

  it("3647: buckets under 10 fold into one suppressed bucket; counts under 10 read <10; anything undeclared is refused", () => {
    const cases = [
      ["bucket", [{ bucket: "a", count: 12 }, { bucket: "b", count: 3 }, { bucket: "c", count: 9 }], { buckets: [{ bucket: "a", count: 12 }, { bucket: "suppressed", count: 12 }] }],
      ["bucket", [{ bucket: "b", count: 10 }, { bucket: "a", count: 40 }], { buckets: [{ bucket: "a", count: 40 }, { bucket: "b", count: 10 }] }],
      ["bucket", [{ bucket: "a", count: 3 }], { buckets: [{ bucket: "suppressed", count: "<10" }] }],
      ["bucket", [], { buckets: [] }],
      [{ n: "count" }, [{ n: 9 }], { n: "<10" }],
      [{ n: "count" }, [{ n: 0 }], { n: "<10" }],
      [{ n: "count", d: "distinct" }, [{ n: 10, d: 11 }], { n: 10, d: 11 }],
      [{ n: "count" }, [{ n: 10, email: "a@example.test" }], null],
      [{ n: "count" }, [{ n: 1.5 }], null],
      [{ n: "count" }, [{ n: "12" }], null],
      [{ n: "count" }, [{ n: true }], null],
      [{ n: "count" }, [{ n: -1 }], null],
      [{ n: "count" }, [{ n: 10 }, { n: 11 }], null],
      [{ n: "count" }, [], null],
      ["bucket", [{ bucket: "a", count: 12, id: 1 }], null],
      ["bucket", [{ bucket: null, count: 12 }], null],
      ["bucket", [{ bucket: "suppressed", count: 12 }], null],
      ["bucket", [{ bucket: "a", count: 12.5 }], null],
    ];
    const got = readObservePy(`print(json.dumps([m.shape(r, rows) for r, rows, _ in json.loads(${JSON.stringify(JSON.stringify(cases))})]))`);
    assert.deepEqual(got, cases.map(([, , want]) => want));
  });
});
