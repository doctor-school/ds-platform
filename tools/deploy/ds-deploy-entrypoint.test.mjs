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

import { BOXES, SECRET_KEYS, SECRET_MAX_AGE_SEC, SECRET_VALUE } from "./data-secret.mjs";
import { DATA_READ_VERBS, DATA_SECRET_VERBS, DATA_VERBS, POSTGRES_ARTIFACT_VERBS } from "./lib/data-prod.mjs";
import { BOX_ENTRYPOINTS, DATA_BOX_ENTRYPOINTS, DS_READ_ENTRYPOINT_BIN } from "./lib/remote.mjs";
import { HOST_STATE_FIELDS, hostStateLines, releaseJournalLines } from "./lib/prod-read.mjs";
import { REPORT_ATTEMPT_RE } from "../staging/e2e-stage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint");
const READ_ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-read-entrypoint");
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
// #4298: backup-info's in-sidecar read of the offsite repos, as the entrypoint holds it.
const OFFSITE_INFO_SH =
  readFileSync(ENTRYPOINT, "utf8").match(/^OFFSITE_INFO_SH='([^']*)'$/m)?.[1] ?? "OFFSITE_INFO_SH missing";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const ATTEMPT = "attempt-1-run-19876543210";

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

test("4250: the box checks the report attempt key with the workflow's own pattern", () => {
  const line = readFileSync(ENTRYPOINT, "utf8")
    .split("\n")
    .find((l) => l.startsWith("REPORT_ATTEMPT_RE="));
  assert.equal(line, `REPORT_ATTEMPT_RE='${REPORT_ATTEMPT_RE.source}'`);
});

test("4144: both boxes run one host-state probe, which reads three fixed files and no secret, env or config", () => {
  const probe = (file) => {
    const m = readFileSync(file, "utf8").match(/^read -r -d '' HOST_STATE_PY <<'PY' \|\| true\n([\s\S]*?)\nPY$/m);
    assert.ok(m, `${file} defines HOST_STATE_PY`);
    return m[1];
  };
  const src = probe(ENTRYPOINT);
  assert.equal(probe(READ_ENTRYPOINT), src, "ds-read-entrypoint and ds-deploy-entrypoint carry the same probe");
  // one open(), on one of FILES only
  assert.equal(src.match(/\bopen\(/g)?.length, 1);
  assert.match(src, /^FILES = \{"uptime": "\/proc\/uptime", "resolv": "\/etc\/resolv\.conf", "hosts": "\/etc\/hosts"\}$/m);
  assert.match(src, /with open\(root \+ FILES\[name\]/);
  for (const banned of [/environ/, /getenv/, /\/etc\/ds-platform/, /\.env\b/, /sys\.stdin/, /shell=True/, /pathlib/, /\bglob\b/])
    assert.doesNotMatch(src, banned);
});

test("3313, 3646, 4068, 4089: the data verbs are one list: DATA_VERBS, the case arm, the client's release, read, secret and artifact verbs", () => {
  const lines = readFileSync(ENTRYPOINT, "utf8").split("\n");
  const line = lines.find((l) => l.startsWith("DATA_VERBS="));
  assert.ok(line, "the entrypoint defines DATA_VERBS");
  const all = [...DATA_VERBS, ...DATA_READ_VERBS, ...DATA_SECRET_VERBS, ...POSTGRES_ARTIFACT_VERBS];
  assert.deepEqual(line.slice("DATA_VERBS='".length, -1).split(" "), all);
  const start = lines.indexOf("  capabilities | postgres-probe | postgres-checkpoint | ship | install | data-env | data-up | backup | \\");
  assert.ok(start > 0, "one case arm dispatches the data verbs");
  const arm = `${lines[start].slice(0, -1)}${lines[start + 1]}`.trim().replace(/\)$/, "");
  assert.deepEqual(arm.split(/\s*\|\s*/), all);
  assert.equal(lines[start + 2], "    data_verb");
});

test("4068: the secret relay takes the read path's hop and the release driver's live-image pattern", () => {
  const pick = (file, name) => {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    assert.ok(line, `${file} defines ${name}`);
    return line;
  };
  for (const name of ["DATA_PROD_HOP_KEY", "DATA_PROD_HOP_KNOWN_HOSTS", "DATA_PROD_ADDRESS"]) {
    assert.equal(pick(ENTRYPOINT, name), pick(READ_ENTRYPOINT, name), `${name} is one definition`);
  }
  assert.equal(
    pick(ENTRYPOINT, "LIVE_IMAGE_RE"),
    pick(resolve(here, "../../infra/deploy/bin/release-driver"), "LIVE_IMAGE_RE"),
  );
});

test("4068: the box accepts exactly the names and value shape `pnpm prod:data-secret` encrypts", () => {
  const text = readFileSync(ENTRYPOINT, "utf8");
  // #3670: NAME → (file, shape, generator), as API_SECRETS; shape None = <generate> only.
  const start = text.indexOf("\nDATA_SECRETS = {\n");
  assert.ok(start > 0, "DATA_PY defines DATA_SECRETS");
  const body = text.slice(start + "\nDATA_SECRETS = {\n".length, text.indexOf("\n}\n", start));
  const table = {};
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^ {4}"([A-Z0-9_]+)": \("data", (?:r"(.*)"|(None)), (None|"hex32")\),$/);
    assert.ok(m, `one entry per line: ${line}`);
    table[m[1]] = { file: "data", shape: m[3] ? null : m[2], ...(m[4] === "None" ? {} : { generate: JSON.parse(m[4]) }) };
  }
  const tool = Object.fromEntries(
    Object.entries(BOXES.data.names).map(([n, { file, shape, generate }]) => [n, { file, shape, ...(generate ? { generate } : {}) }]),
  );
  assert.deepEqual(table, tool);
  assert.deepEqual(Object.keys(table), [...SECRET_KEYS]);
  const value = text.match(/^SECRET_VALUE = re\.compile\("(.*)"\)$/m);
  assert.ok(value, "DATA_PY defines SECRET_VALUE");
  assert.equal(`^${value[1]}$`, SECRET_VALUE.source);
  const age = text.match(/^SECRET_MAX_AGE = (\d+) \* 3600$/m);
  assert.ok(age, "DATA_PY defines SECRET_MAX_AGE");
  assert.equal(Number(age[1]) * 3600, SECRET_MAX_AGE_SEC);
});

test("4153: the api box accepts exactly the names, files, shapes and generators `pnpm prod:api-secret` encrypts", () => {
  const text = readFileSync(ENTRYPOINT, "utf8");
  const start = text.indexOf("\nAPI_SECRETS = {\n");
  assert.ok(start > 0, "DATA_PY defines API_SECRETS");
  const body = text.slice(start + "\nAPI_SECRETS = {\n".length, text.indexOf("\n}\n", start));
  const table = {};
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^ {4}"([A-Z_]+)": \("(api|compose)", r"(.*)", (None|"hex32"|"base64-32")\),$/);
    assert.ok(m, `one entry per line: ${line}`);
    table[m[1]] = { file: m[2], shape: m[3], ...(m[4] === "None" ? {} : { generate: JSON.parse(m[4]) }) };
  }
  const tool = Object.fromEntries(
    Object.entries(BOXES.api.names).map(([n, { file, shape, generate }]) => [n, { file, shape, ...(generate ? { generate } : {}) }]),
  );
  assert.deepEqual(table, tool);
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
// well-behaved `tar -c` would refuse or normalise, which is the point. Regular files,
// pax ("x", "g") and GNU long-name ("L", "K") headers carry a body.
const TAR_DATA_TYPES = new Set(["0", "x", "g", "L", "K"]);
function tarArchive(entries) {
  const blocks = [];
  for (const { name, type = "0", link = "", body = "", uname = "", prefix = "", magic = "ustar\0" } of entries) {
    const data = Buffer.from(body);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write(type === "5" ? "0000755\0" : "0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${(TAR_DATA_TYPES.has(type) ? data.length : 0).toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write(type, 156, 1, "ascii");
    header.write(link, 157, 100, "utf8");
    header.write(magic, 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    header.write(uname, 265, 32, "utf8");
    header.write(prefix, 345, 155, "utf8");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    if (TAR_DATA_TYPES.has(type) && data.length > 0) {
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
    ["upload-report with an extra argument", `upload-report ${SHA} ${ATTEMPT} x`],
    ["upload-report without an attempt key (the pre-4250 overwrite form)", `upload-report ${SHA}`],
    ["upload-report with attempt 0", `upload-report ${SHA} attempt-0-run-1`],
    ["upload-report with a key that is not an attempt", `upload-report ${SHA} latest`],
    ["upload-report with a run-less key", `upload-report ${SHA} attempt-1`],
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
    let r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: archive });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /stage box only/);
    setRole("prod");
    r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: archive });
    assert.equal(r.status, 3);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports")), "nothing written");
  });

  it("upload-report stores the stream under the sha and attempt, and prunes SHA dirs past 14 days", () => {
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
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: archive });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-deploy-entrypoint: report ${SHA} ${ATTEMPT} stored\n`);
    assert.equal(readFileSync(join(reports, SHA, ATTEMPT, "results.json"), "utf8"), '{"ok":true}');
    assert.equal(readFileSync(join(reports, SHA, ATTEMPT, "trace/t.zip"), "utf8"), "zip");
    assert.deepEqual(readdirSync(reports).sort(), ["b".repeat(40), SHA].sort());
    assert.match(log("sudo"), /python3 -I -c /, "validated and extracted by tarfile");
  });

  it("4250: a re-run on the same SHA lands beside the failed attempt, and a stored attempt is never overwritten", () => {
    setRole("stage");
    const reports = join(root, "var/lib/ds-platform/e2e-reports");
    const failed = tarArchive([{ name: "results.json", body: '{"failed":1}' }]);
    const green = tarArchive([{ name: "results.json", body: '{"failed":0}' }]);
    const rerun = "attempt-2-run-19876543210";
    assert.equal(run(`upload-report ${SHA} ${ATTEMPT}`, { input: failed }).status, 0);
    const r = run(`upload-report ${SHA} ${rerun}`, { input: green });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(join(reports, SHA)).sort(), [ATTEMPT, rerun]);
    assert.equal(readFileSync(join(reports, SHA, ATTEMPT, "results.json"), "utf8"), '{"failed":1}');
    assert.equal(readFileSync(join(reports, SHA, rerun, "results.json"), "utf8"), '{"failed":0}');

    const again = run(`upload-report ${SHA} ${ATTEMPT}`, { input: green });
    assert.equal(again.status, 3, again.stderr);
    assert.match(again.stderr, /already stored \(an attempt is never overwritten\)/);
    assert.equal(readFileSync(join(reports, SHA, ATTEMPT, "results.json"), "utf8"), '{"failed":1}', "kept");
  });

  it("4250: a refused upload leaves earlier attempts of its SHA in place", () => {
    setRole("stage");
    const reports = join(root, "var/lib/ds-platform/e2e-reports");
    const ok = run(`upload-report ${SHA} ${ATTEMPT}`, { input: tarArchive([{ name: "r.json", body: "{}" }]) });
    assert.equal(ok.status, 0, ok.stderr);
    const r = run(`upload-report ${SHA} attempt-2-run-19876543210`, {
      input: tarArchive([{ name: "../x", body: "x" }]),
    });
    assert.equal(r.status, 3, r.stderr);
    assert.deepEqual(readdirSync(join(reports, SHA)), [ATTEMPT]);
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
      const r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: tarArchive(entries) });
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
      const r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: tarArchive(entries), env });
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
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: tarArchive([{ name: "r.json", body: "{}" }]) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(log("sudo"), new RegExp(`mktemp -p ${`${root}/var/lib/ds-platform`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `));
    assert.deepEqual(readdirSync(parent()).sort(), ["e2e-reports"]);
  });

  it("upload-report: an owner name with spaces cannot shift the size past the unpacked cap", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, {
      input: tarArchive([{ name: "big.bin", body: "x".repeat(1200), uname: "a b 1 2 3" }]),
      env: { DS_ENTRYPOINT_MAX_UNPACKED_BYTES: "1000" },
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unpacks to more than 1000 bytes/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses a compressed (gzip) archive: plain tar only", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, {
      input: gzipSync(tarArchive([{ name: "r.json", body: "{}" }])),
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /not a readable tar stream/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses when the reports filesystem lacks room for the unpacked report", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, {
      input: tarArchive([{ name: "r.json", body: "{}" }]),
      env: { DS_ENTRYPOINT_FREE_MARGIN_BYTES: String(2 ** 62) },
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /not enough free space/);
    assert.ok(!existsSync(join(root, "var/lib/ds-platform/e2e-reports", SHA)), "no report dir");
  });

  it("upload-report refuses a stream that is not a tar archive", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA} ${ATTEMPT}`, { input: Buffer.from("not a tar stream at all\n") });
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
    assert.equal(names.length, 8);
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

  it("4121 / 033 EARS-18: observe reads only the synthetic contact's queue rows, read-only, on main", () => {
    setRole("stage");
    const contact = `partnership-4121-${OWNED}@example.test`;
    stubDocker(envelope([{ count: 1, exactRow: true }]));
    const r = run("observe academy-partnership", { input: json({ contact }) });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { count: 1, exactRow: true });
    const argv = log("docker-argv").trimEnd().split("\n");
    assert.deepEqual(argv.slice(0, 7), ["exec", "-i", "-e", "PGCLIENTENCODING=UTF8", "stg-infra-postgres-1", "psql", "-X"]);
    assert.equal(argv[argv.indexOf("-d") + 1], "ds_main");
    assert.ok(argv.includes(`contact=${contact}`), "the contact is a psql variable");
    const sql = log("docker-stdin");
    assert.match(sql, /^BEGIN READ ONLY;\n/);
    assert.match(sql, /FROM applications a\nWHERE a\.kind = 'partnership' AND a\.contact ->> 'emailOrTelegram' = :'contact'/);
    assert.ok(!sql.includes(contact), "never spliced into the SQL text");
    assert.match(sql, /ROLLBACK;\n$/);
    assert.doesNotMatch(r.stdout + r.stderr, /example\.test|secret diagnostics/);
  });

  it("4121: observe reports a non-exact or repeated row as not exact", () => {
    setRole("stage");
    stubDocker(envelope([{ count: 2, exactRow: true }]));
    const r = run("observe academy-partnership", {
      input: json({ contact: `partnership-4121-${OWNED}@example.test` }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { count: 2, exactRow: false });
  });

  it("4121: observe rejects foreign fields and contact before running the read", () => {
    setRole("stage");
    stubDocker("{}");
    for (const params of [
      { contact: "real@partner.example" },
      { contact: `partnership-4121-${OWNED}@example.test`, slot: "pr-1" },
    ]) {
      const r = run("observe academy-partnership", { input: json(params) });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /bad parameters for academy-partnership/);
      assert.ok(!existsSync(join(dir, "docker-argv.log")), "no read");
    }
  });

  it("4121: observe rejects a malformed row without logging data from the database", () => {
    setRole("stage");
    stubDocker(envelope([{ count: 1, exactRow: true, contact: "private@partner.example" }]));
    const r = run("observe academy-partnership", {
      input: json({ contact: `partnership-4121-${OWNED}@example.test` }),
    });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.doesNotMatch(r.stderr, /private@|secret diagnostics/);
  });

  it("033 EARS-18: the retired file-store fault count is no longer an observation", () => {
    setRole("stage");
    const r = run("observe academy-partnership-fault-count", { input: json({}) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown observation/);
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
        "  info*) echo overlay2 ;;",
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
        "log bound: /web log=json-file max-size=50m max-file=3\n" +
        // #4089: the image store the certified ids assume (classic overlay2).
        "storage driver: overlay2\n",
    );
    assert.ok(log("docker").split("\n").includes("info --format {{.Driver}}"), log("docker"));
    const calls = log("docker").split("\n");
    assert.ok(calls.includes("ps -aq --filter label=com.docker.compose.project=ds-data-prod"), log("docker"));
    assert.ok(calls.includes("ps -aq --filter label=com.docker.compose.project=ds-glitchtip"), log("docker"));
    const inspect = calls.find((l) => l.startsWith("inspect "));
    assert.ok(inspect?.includes("{{.HostConfig.LogConfig.Type}}") && inspect.endsWith(" pg redis web"), inspect);
  });

  // #3395: the log-bound report is evidence only — it never fails the checkpoint, and
  // it reads no compose file or .env (the pre-ship checkpoint runs on any tree).
  for (const [label, fail, evidence] of [
    ["docker inspect fails", "inspect", "log bounds: unavailable — Error: inspect broke\nstorage driver: overlay2\n"],
    ["docker ps fails", "ps", "log bounds: unavailable — Error: ps broke\nstorage driver: overlay2\n"],
    // #4089: the storage driver line is evidence only too.
    [
      "docker info fails",
      "info",
      "log bound: /pg log=json-file max-size=50m max-file=3\n" +
        "log bound: /redis log=json-file max-size=50m max-file=3\n" +
        "log bound: /web log=json-file max-size=50m max-file=3\n" +
        "storage driver: unavailable — Error: info broke\n",
    ],
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
        `PostgreSQL checkpoint written\nrecord: v1 (no hashVersion)\n${evidence}`,
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
      // #4287: the repo2 tunnel runs the certified pgbackrest image.
      services: { postgres: { image: IMG("b") }, pgbackrest: { image: IMG("c") }, "repo2-tunnel": { image: IMG("c") } },
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

  // #3822: the data-prod compose env data-env wrote describes the running containers;
  // a ship keeps it until the release's data-prod-env phase rewrites it.
  const COMPOSE_REL = "infra/deploy/compose/data-prod";
  const GENERATED = { ".env": "VPC_IP=192.168.0.10\n", ".postgres-artifacts.json": '{"services":{}}\n' };
  const composeTree = (extra = []) =>
    shipped([
      { name: "ds-platform/infra/", type: "5" },
      { name: "ds-platform/infra/deploy/", type: "5" },
      { name: "ds-platform/infra/deploy/compose/", type: "5" },
      { name: `ds-platform/${COMPOSE_REL}/`, type: "5" },
      { name: `ds-platform/${COMPOSE_REL}/compose.yml`, body: "services: {}\n" },
      ...extra,
    ]);
  const liveGenerated = () => {
    const compose = join(tree(), COMPOSE_REL);
    mkdirSync(compose, { recursive: true });
    for (const [name, body] of Object.entries(GENERATED)) {
      writeFileSync(join(compose, name), body);
      chmodSync(join(compose, name), 0o600);
    }
    return compose;
  };

  it("3822: ship carries the live tree's generated data-prod compose env into the new tree, byte-equal, same mode", () => {
    setRole("data");
    liveGenerated();
    const r = run(`ship ${SHA}`, { input: composeTree() });
    assert.equal(r.status, 0, String(r.stderr));
    const compose = join(tree(), COMPOSE_REL);
    assert.equal(readFileSync(join(compose, "compose.yml"), "utf8"), "services: {}\n", "the new tree is live");
    for (const [name, body] of Object.entries(GENERATED)) {
      assert.equal(readFileSync(join(compose, name), "utf8"), body, name);
      assert.equal(statSync(join(compose, name)).mode & 0o777, 0o600, `${name} mode`);
    }
  });

  it("3822: a first ship (no live tree) succeeds and carries nothing", () => {
    setRole("data");
    mkdirSync(join(root, "home/deploy"), { recursive: true });
    const r = run(`ship ${SHA}`, { input: composeTree() });
    assert.equal(r.status, 0, String(r.stderr));
    for (const name of Object.keys(GENERATED)) {
      assert.equal(existsSync(join(tree(), COMPOSE_REL, name)), false, name);
    }
  });

  it("3822: ship refuses a tree without the data-prod compose directory while the live env exists, keeping the live tree", () => {
    setRole("data");
    const compose = liveGenerated();
    mkdirSync(join(tree(), "old"), { recursive: true });
    const r = run(`ship ${SHA}`, { input: shipped([{ name: "ds-platform/infra/", type: "5" }]) });
    assert.equal(r.status, 3, String(r.stderr));
    assert.ok(existsSync(join(tree(), "old")), "the live tree was not swapped");
    for (const [name, body] of Object.entries(GENERATED)) {
      assert.equal(readFileSync(join(compose, name), "utf8"), body, `${name} intact`);
    }
  });

  for (const name of Object.keys(GENERATED)) {
    it(`3822: ship refuses a tree that carries its own ${name}, keeping the live tree's`, () => {
      setRole("data");
      const compose = liveGenerated();
      const r = run(`ship ${SHA}`, {
        input: composeTree([{ name: `ds-platform/${COMPOSE_REL}/${name}`, body: "VPC_IP=10.9.9.9\n" }]),
      });
      assert.equal(r.status, 3, String(r.stderr));
      assert.equal(readFileSync(join(compose, name), "utf8"), GENERATED[name], "live file intact");
      assert.equal(existsSync(join(compose, "compose.yml")), false, "the live tree was not swapped");
    });
  }

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
        // #4287: the repo2 tunnel once its key exists, never waited on.
        `if test -s '${join(root, "etc/ds-platform/repo2-tunnel/id_ed25519")}'; then ` +
        "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --no-deps repo2-tunnel" +
        " || echo 'repo2-tunnel: WARNING: the tunnel could not be started; repo2 waits for it, repo1 is unaffected'; " +
        "else echo 'repo2-tunnel: no key yet (repo2-tunnel-key generates it)'; fi\n" +
        "docker compose up -d --no-deps redis\n" +
        "docker compose -f glitchtip/compose.yml --env-file .env up -d --no-build --pull missing --wait --wait-timeout 300\n" +
        `ds-release-called release --retry-failed prod ${SHA} backup\ncd '${compose}'\n` +
        "docker compose exec -T pgbackrest /usr/local/bin/backup.sh incr\n",
    );
  });

  // --- 4068: the data-box secret rotation ----------------------------------------------
  const dataEnv = () => join(root, "etc/ds-platform/data.env");
  const intakeCert = () => join(root, "etc/ds-platform/secret-intake/cert.pem");
  const staged = () => join(root, "etc/ds-platform/.data.env.next");
  const previous = () => join(root, "etc/ds-platform/.data.env.previous");
  const applied = () => join(root, "etc/ds-platform/secret-intake/applied.json");
  const pending = () => join(root, "etc/ds-platform/secret-intake/pending.json");
  const OLD_ENV =
    "PGBACKREST_REPO1_CIPHER_PASS=cipher-pass-value\nPGBACKREST_REPO1_S3_KEY=OLDKEYID0001\n" +
    "PGBACKREST_REPO1_S3_KEY_SECRET=old/secret+value=\n";
  const NEW = { PGBACKREST_REPO1_S3_KEY: "NEWKEYID0002", PGBACKREST_REPO1_S3_KEY_SECRET: "new/secret+value=" };
  // A ds-release that records its calls, keeps the step script and starts nothing.
  const secretRelease = () =>
    writeFileSync(
      join(root, "usr/local/bin/ds-release"),
      [
        "#!/usr/bin/env bash",
        'echo "ds-release-called $*" >> "$STUB_DIR/ds-release.log"',
        '[[ $1 == check ]] && exit "${STUB_CHECK_RC:-0}"',
        '[[ $1 == release ]] && { cp -- "${@: -1}" "$STUB_DIR/step.sh"; echo "ds-release: ds-prod-${3:0:12}-$4 started"; }',
        "exit 0",
      ].join("\n") + "\n",
    );
  const secretBox = () => {
    setRole("data");
    secretRelease();
    writeFileSync(dataEnv(), OLD_ENV, { mode: 0o600 });
    mkdirSync(join(tree(), "infra/deploy/compose/data-prod"), { recursive: true });
    writeFileSync(join(tree(), "infra/deploy/compose/data-prod/.postgres-artifacts.json"), "{}\n");
    const r = run("secret-recipient");
    assert.equal(r.status, 0, r.stderr);
  };
  const cipher = async (values, now = new Date(), cert = intakeCert(), sha = SHA) => {
    const { encryptSecret, secretPlaintext } = await import("./data-secret.mjs");
    return JSON.stringify({ ciphertext: encryptSecret(secretPlaintext(values, { sha, now }), cert) });
  };

  it("4068: secret-recipient generates the intake key once, root-only, and prints only the certificate", () => {
    setRole("data");
    const first = run("secret-recipient");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /intake key generated/);
    assert.match(
      first.stdout,
      /^-----BEGIN CERTIFICATE-----\n[\s\S]*-----END CERTIFICATE-----\n(sha256|SHA256) Fingerprint=[0-9A-F:]{95}\n$/,
    );
    assert.doesNotMatch(first.stdout, /PRIVATE KEY/);
    const key = join(root, "etc/ds-platform/secret-intake/key.pem");
    assert.equal(statSync(key).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(key)).mode & 0o777, 0o700);
    const again = run("secret-recipient");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, first.stdout, "the same key pair, not a new one");
    assert.doesNotMatch(again.stderr, /generated/);
  });

  it("4068: secret-recipient and secret-apply are data-box verbs with exact arity", () => {
    setRole("data");
    for (const command of ["secret-recipient now", "secret-apply", `secret-apply ${SHA.slice(0, 12)}`, `secret-apply ${SHA} x`]) {
      assert.equal(run(command, { input: "" }).status, 2, command);
    }
    setRole("prod");
    for (const command of ["secret-recipient", `secret-apply ${SHA}`]) {
      const r = run(command, { input: "" });
      assert.equal(r.status, 3, command);
      assert.match(r.stderr, /is served by the data box only/);
    }
  });

  it("4287: repo2-tunnel-key generates the tunnel key once, root-only, and prints only the public key and its fingerprint", () => {
    setRole("data");
    const first = run("repo2-tunnel-key");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /repo2 tunnel key generated/);
    assert.match(
      first.stdout,
      /^ssh-ed25519 [A-Za-z0-9+/]+={0,2} ds-data-prod-repo2\n256 SHA256:[A-Za-z0-9+/]{43} ds-data-prod-repo2 \(ED25519\)\n$/,
    );
    assert.doesNotMatch(first.stdout, /PRIVATE KEY/);
    const key = join(root, "etc/ds-platform/repo2-tunnel/id_ed25519");
    assert.match(readFileSync(key, "utf8"), /^-----BEGIN OPENSSH PRIVATE KEY-----/);
    assert.equal(statSync(key).mode & 0o777, 0o600);
    assert.equal(statSync(`${key}.pub`).mode & 0o777, 0o644);
    assert.equal(statSync(dirname(key)).mode & 0o777, 0o700);
    const again = run("repo2-tunnel-key");
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout, first.stdout, "the same key pair, not a new one");
    assert.doesNotMatch(again.stderr, /generated/);
    assert.equal(run("repo2-tunnel-key now").status, 2);
    setRole("prod");
    const r = run("repo2-tunnel-key");
    assert.equal(r.status, 3);
    assert.match(r.stderr, /is served by the data box only/);
  });

  it("4068: secret-apply decrypts, stages only the allowlisted lines and starts the data-secret unit — no value printed", async () => {
    secretBox();
    const r = run(`secret-apply ${SHA}`, { input: await cipher(NEW) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /staged: PGBACKREST_REPO1_S3_KEY, PGBACKREST_REPO1_S3_KEY_SECRET\n/);
    assert.match(r.stdout, /-data-secret started/);
    for (const v of [...Object.values(NEW), "OLDKEYID0001", "cipher-pass-value"]) {
      assert.ok(!(r.stdout + r.stderr).includes(v), "no value in the output");
    }
    assert.equal(
      readFileSync(staged(), "utf8"),
      "PGBACKREST_REPO1_CIPHER_PASS=cipher-pass-value\nPGBACKREST_REPO1_S3_KEY=NEWKEYID0002\n" +
        "PGBACKREST_REPO1_S3_KEY_SECRET=new/secret+value=\n",
    );
    assert.equal(statSync(staged()).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(pending(), "utf8"))), ["createdAt", "nonce"]);
    assert.equal(statSync(pending()).mode & 0o777, 0o600);
    assert.ok(!existsSync(applied()), "recorded only once the unit's verdict stands");
    assert.equal(readFileSync(dataEnv(), "utf8"), OLD_ENV, "data.env changes only inside the unit");
    assert.match(log("ds-release"), new RegExp(`^ds-release-called check prod\nds-release-called release prod ${SHA} data-secret \\S+\n$`));
    const script = readFileSync(join(dir, "step.sh"), "utf8");
    assert.match(
      script,
      /\ndocker compose -f compose\.yml -f \.postgres-artifacts\.json up -d --no-build --pull never --wait --wait-timeout 120 postgres pgbackrest/,
    );
    assert.match(script, /docker compose exec -T -u postgres pgbackrest \/usr\/local\/bin\/repo-check\.sh/);
  });

  it("3670: an offsite repo's names are appended to data.env, its cipher pass generated on the box and never printed", async () => {
    secretBox();
    const { GENERATE } = await import("./data-secret.mjs");
    const r = run(`secret-apply ${SHA}`, {
      input: await cipher({
        PGBACKREST_REPO2_S3_KEY: "OFFSITEKEY02",
        PGBACKREST_REPO2_S3_KEY_SECRET: "offsite/secret+2=",
        PGBACKREST_REPO2_S3_ENDPOINT: "s3.ap-southeast-2.idrivee2.com",
        PGBACKREST_REPO2_CIPHER_PASS: GENERATE,
      }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /generated: PGBACKREST_REPO2_CIPHER_PASS/);
    const text = readFileSync(staged(), "utf8");
    assert.ok(text.startsWith(OLD_ENV), "the held lines stay as they were");
    const pass = text.match(/^PGBACKREST_REPO2_CIPHER_PASS=([0-9a-f]{64})$/m);
    assert.ok(pass, "a 64-hex pass appended");
    assert.match(text, /^PGBACKREST_REPO2_S3_ENDPOINT=s3\.ap-southeast-2\.idrivee2\.com$/m);
    assert.match(text, /^PGBACKREST_REPO2_S3_KEY=OFFSITEKEY02$/m);
    assert.ok(text.endsWith("\n"));
    for (const v of [pass[1], "OFFSITEKEY02", "offsite/secret+2="]) {
      assert.ok(!(r.stdout + r.stderr).includes(v), "no value in the output");
    }
  });

  it("3670: the box refuses a supplied offsite cipher pass, and a <generate> over a held pass", async () => {
    secretBox();
    const { GENERATE } = await import("./data-secret.mjs");
    const supplied = run(`secret-apply ${SHA}`, { input: await cipher({ PGBACKREST_REPO3_CIPHER_PASS: "a".repeat(64) }) });
    assert.equal(supplied.status, 2, supplied.stderr);
    assert.match(supplied.stderr, /PGBACKREST_REPO3_CIPHER_PASS is generated on the box only/);
    assert.ok(!supplied.stderr.includes("aaaa") && !existsSync(staged()) && !existsSync(pending()));
    writeFileSync(dataEnv(), OLD_ENV + `PGBACKREST_REPO3_CIPHER_PASS=${"b".repeat(64)}\n`, { mode: 0o600 });
    const held = run(`secret-apply ${SHA}`, {
      input: await cipher({ PGBACKREST_REPO3_CIPHER_PASS: GENERATE }, new Date(Date.now() + 1000)),
    });
    assert.equal(held.status, 2, held.stderr);
    assert.match(held.stderr, /PGBACKREST_REPO3_CIPHER_PASS already has a value/);
    assert.ok(!existsSync(staged()) && !existsSync(pending()), "nothing staged");
  });

  it("4068: secret-apply refuses a stale, foreign, off-list or malformed secret and stages nothing", async () => {
    secretBox();
    const other = join(dir, "other.pem");
    const made = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "other.key"), "-out", other, "-subj", "/CN=other", "-days", "1"],
      { encoding: "utf8" },
    );
    assert.equal(made.status, 0, made.stderr);
    const cases = [
      [await cipher(NEW, new Date(Date.now() - 7 * 3600 * 1000)), /encrypted more than 6 h ago/],
      [await cipher(NEW, new Date(), intakeCert(), "f".repeat(40)), /encrypted for another prod SHA/],
      [await cipher({ PGBACKREST_REPO1_CIPHER_PASS: "abcdefgh12" }), /bad payload for secret-stage/],
      [await cipher({ PGBACKREST_REPO1_S3_KEY: "has a space" }), /is not 8-256 characters/],
      [await cipher(NEW, new Date(), other), /does not decrypt with this box's intake key/],
      ['{"ciphertext":"not base64!"}', /bad payload for secret-cipher/],
      [JSON.stringify({ ciphertext: Buffer.from("not cms").toString("base64") }), /does not decrypt with this box's intake key/],
    ];
    for (const [input, reason] of cases) {
      const r = run(`secret-apply ${SHA}`, { input });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, reason);
      assert.ok(!existsSync(staged()) && !existsSync(pending()), "nothing staged");
    }
    assert.doesNotMatch(log("ds-release"), /release prod/, "no unit started");
  });

  it("4068: secret-apply refuses before decrypting without an intake key, a recorded overlay, or while a ds-prod-* unit runs", async () => {
    secretBox();
    const input = await cipher(NEW);
    assert.equal(run(`secret-apply ${SHA}`, { input, env: { STUB_CHECK_RC: "3" } }).status, 3);
    rmSync(join(tree(), "infra/deploy/compose/data-prod/.postgres-artifacts.json"));
    const r2 = run(`secret-apply ${SHA}`, { input });
    assert.equal(r2.status, 3);
    assert.match(r2.stderr, /no recorded image overlay/);
    rmSync(join(root, "etc/ds-platform/secret-intake"), { recursive: true });
    const r3 = run(`secret-apply ${SHA}`, { input });
    assert.equal(r3.status, 3);
    assert.match(r3.stderr, /no intake key on this box/);
    assert.ok(!existsSync(staged()));
    assert.doesNotMatch(log("ds-release"), /release prod/);
  });

  it("4068: secret-apply leaves no staged copy when ds-release starts no unit (a recorded verdict)", async () => {
    secretBox();
    writeFileSync(
      join(root, "usr/local/bin/ds-release"),
      '#!/usr/bin/env bash\n[[ $1 == release ]] && echo "ds-release: ds-prod-x-data-secret succeeded (recorded verdict; not re-run)"\nexit 0\n',
    );
    const r = run(`secret-apply ${SHA}`, { input: await cipher(NEW) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(staged()) && !existsSync(pending()));
  });

  // The unit's script, run for real: docker answers `check` with a failure while
  // data.env holds `failKey`, so both the success and the restore branch run.
  let unitInput;
  const runUnit = async (failKey, now = new Date(), upFailKey = "NO-SUCH-KEY", values = NEW) => {
    secretBox();
    unitInput = await cipher(values, now);
    assert.equal(run(`secret-apply ${SHA}`, { input: unitInput }).status, 0);
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'echo "docker $*" >> "$STUB_DIR/docker.log"',
        `[[ " $* " == *" /usr/local/bin/repo-check.sh "* ]] && grep -q '${failKey}' '${dataEnv()}' && exit 1`,
        `[[ " $* " == *" up "* ]] && grep -q '${upFailKey}' '${dataEnv()}' && exit 1`,
        "exit 0",
      ].join("\n") + "\n",
    );
    // `install -o root -g root` needs root; the owner is not what is tested here.
    writeFileSync(
      join(stubs, "install"),
      '#!/usr/bin/env bash\nargs=(); skip=0\nfor a in "$@"; do\n  if [[ $skip == 1 ]]; then skip=0; continue; fi\n  case $a in -o|-g) skip=1 ;; *) args+=("$a") ;; esac\ndone\nexec /usr/bin/install "${args[@]}"\n',
    );
    chmodSync(join(stubs, "docker"), 0o755);
    chmodSync(join(stubs, "install"), 0o755);
    return spawnSync("bash", ["--norc", "-euo", "pipefail", join(dir, "step.sh")], {
      env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: dir },
      encoding: "utf8",
    });
  };

  it("4068: the data-secret unit swaps data.env, recreates on the overlay and passes the check", async () => {
    const r = await runUnit("NO-SUCH-KEY");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(dataEnv(), "utf8"), /^PGBACKREST_REPO1_S3_KEY=NEWKEYID0002$/m);
    assert.equal(statSync(dataEnv()).mode & 0o777, 0o600);
    assert.ok(!existsSync(staged()) && !existsSync(previous()), "no copy left");
    assert.deepEqual(log("docker").trim().split("\n"), [
      "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --wait --wait-timeout 120 postgres pgbackrest",
      "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh",
    ]);
    assert.match(r.stdout, /repo2-tunnel: no key yet/);
  });

  it("4287: with the tunnel key on the box, the unit raises repo2's tunnel first, before data.env changes", async () => {
    mkdirSync(join(root, "etc/ds-platform/repo2-tunnel"), { recursive: true });
    writeFileSync(join(root, "etc/ds-platform/repo2-tunnel/id_ed25519"), "key\n", { mode: 0o600 });
    const r = await runUnit("NO-SUCH-KEY");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(log("docker").trim().split("\n"), [
      "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --no-deps repo2-tunnel",
      "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --wait --wait-timeout 120 postgres pgbackrest",
      "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh",
    ]);
  });

  it("4287: a tunnel Docker cannot start is a warning — a rotation that leaves repo2 alone goes on", async () => {
    mkdirSync(join(root, "etc/ds-platform/repo2-tunnel"), { recursive: true });
    writeFileSync(join(root, "etc/ds-platform/repo2-tunnel/id_ed25519"), "key\n", { mode: 0o600 });
    // upFailKey matches the old data.env only: the first `up` (the tunnel's) fails.
    const r = await runUnit("NO-SUCH-KEY", new Date(), "OLDKEYID0001");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /repo2-tunnel: WARNING: the tunnel could not be started; repo2 waits for it, repo1 is unaffected/);
    assert.match(readFileSync(dataEnv(), "utf8"), /^PGBACKREST_REPO1_S3_KEY=NEWKEYID0002$/m);
    assert.deepEqual(log("docker").trim().split("\n"), [
      "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --no-deps repo2-tunnel",
      "docker compose -f compose.yml -f .postgres-artifacts.json up -d --no-build --pull never --wait --wait-timeout 120 postgres pgbackrest",
      "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh",
    ]);
  });

  it("4068: a failed check puts the previous data.env back, recreates again and fails the unit", async () => {
    const r = await runUnit("NEWKEYID0002");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /restoring the previous data\.env/);
    assert.equal(readFileSync(dataEnv(), "utf8"), OLD_ENV);
    assert.equal(statSync(dataEnv()).mode & 0o777, 0o600);
    assert.ok(!existsSync(previous()));
    assert.equal(log("docker").trim().split("\n").filter((l) => l.includes(" up -d ")).length, 2, "recreated twice");
    assert.ok(existsSync(applied()) && !existsSync(pending()), "a rolled-back ciphertext is spent too");
  });

  it("4068: a restore whose recreate fails still checks, records the ciphertext spent and fails the unit", async () => {
    const r = await runUnit("NEWKEYID0002", new Date(), "OLDKEYID0001");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /WARNING: recreating postgres \+ pgbackrest with the previous values failed/);
    assert.equal(readFileSync(dataEnv(), "utf8"), OLD_ENV, "the previous data.env is back");
    assert.ok(!existsSync(previous()));
    assert.ok(existsSync(applied()) && !existsSync(pending()), "spent although the recreate failed");
    assert.equal(log("docker").trim().split("\n").filter((l) => l.includes("/usr/local/bin/repo-check.sh")).length, 2, "checked after the failed recreate too");
  });

  it("3670: a rolled-back first enable keeps the generated pass, not the keys; the retry supplies the keys only", async () => {
    const { GENERATE } = await import("./data-secret.mjs");
    const keys = {
      PGBACKREST_REPO2_S3_KEY: "OFFSITEKEY02",
      PGBACKREST_REPO2_S3_KEY_SECRET: "offsite/secret+2=",
      PGBACKREST_REPO2_S3_ENDPOINT: "s3.ap-southeast-2.idrivee2.com",
    };
    const r = await runUnit("OFFSITEKEY02", new Date(), "NO-SUCH-KEY", { ...keys, PGBACKREST_REPO2_CIPHER_PASS: GENERATE });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /keeping the generated offsite cipher pass/);
    assert.deepEqual(
      log("docker").trim().split("\n").filter((l) => l.includes("repo-check.sh")),
      [
        "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh 2",
        "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh",
      ],
      "the enable checks repo1 + repo2; the restore repo1 alone",
    );
    assert.doesNotMatch(log("docker"), /backup\.sh/, "no first full after a refused enable");
    const text = readFileSync(dataEnv(), "utf8");
    const pass = text.match(/^PGBACKREST_REPO2_CIPHER_PASS=([0-9a-f]{64})$/m);
    assert.ok(pass, "the pass stanza-create may have used survives the rollback");
    assert.ok(text.startsWith(OLD_ENV) && text.endsWith("\n"));
    assert.doesNotMatch(text, /^PGBACKREST_REPO2_S3_/m, "the keys stay out, so the repo stays off");
    assert.equal(statSync(dataEnv()).mode & 0o777, 0o600);
    assert.ok(!existsSync(`${staged()}.keep`) && !existsSync(previous()), "no copy left");
    assert.ok(!(r.stdout + r.stderr).includes(pass[1]), "the pass is never printed");
    const regenerate = run(`secret-apply ${SHA}`, {
      input: await cipher({ ...keys, PGBACKREST_REPO2_CIPHER_PASS: GENERATE }, new Date(Date.now() + 1000)),
    });
    assert.equal(regenerate.status, 2, regenerate.stderr);
    assert.match(regenerate.stderr, /PGBACKREST_REPO2_CIPHER_PASS already has a value/);
    const retry = run(`secret-apply ${SHA}`, { input: await cipher(keys, new Date(Date.now() + 2000)) });
    assert.equal(retry.status, 0, retry.stderr);
    const next = readFileSync(staged(), "utf8");
    assert.match(next, new RegExp(`^PGBACKREST_REPO2_CIPHER_PASS=${pass[1]}$`, "m"));
    assert.match(next, /^PGBACKREST_REPO2_S3_KEY=OFFSITEKEY02$/m);
    assert.ok(!existsSync(`${staged()}.keep`), "a rotation that generates nothing leaves no keep copy");
  });

  it("3670: an enable that passes checks repo1 + the new repo, keeps no copy and takes the repo's first full", async () => {
    const { GENERATE } = await import("./data-secret.mjs");
    const r = await runUnit("NO-SUCH-KEY", new Date(), "NO-SUCH-KEY", {
      PGBACKREST_REPO3_S3_KEY: "OFFSITEKEY03",
      PGBACKREST_REPO3_S3_KEY_SECRET: "offsite/secret+3=",
      PGBACKREST_REPO3_S3_ENDPOINT: "s3.bbm-sydney.example.test",
      PGBACKREST_REPO3_CIPHER_PASS: GENERATE,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(dataEnv(), "utf8"), /^PGBACKREST_REPO3_S3_KEY=OFFSITEKEY03$/m);
    assert.ok(!existsSync(`${staged()}.keep`) && !existsSync(previous()), "no copy left");
    assert.deepEqual(log("docker").trim().split("\n").slice(1), [
      "docker compose exec -T -u postgres pgbackrest /usr/local/bin/repo-check.sh 3",
      "docker compose exec -T pgbackrest /usr/local/bin/backup.sh full offsite 3",
    ]);
    assert.ok(existsSync(applied()) && !existsSync(pending()));
  });

  it("4068: a stage refused after it wrote leaves no staged copy and no pending record", async () => {
    secretBox();
    const input = await cipher(NEW);
    // openssl decrypts (so secret-stage writes both files), then exits non-zero.
    const real = spawnSync("bash", ["-c", "command -v openssl"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(
      join(stubs, "openssl"),
      `#!/usr/bin/env bash\n'${real}' "$@"; rc=$?\n[[ $1 == cms && $2 == -decrypt ]] && exit 1\nexit $rc\n`,
    );
    chmodSync(join(stubs, "openssl"), 0o755);
    const r = run(`secret-apply ${SHA}`, { input });
    assert.equal(r.status, 3, r.stderr);
    assert.ok(!existsSync(staged()) && !existsSync(pending()), "nothing left behind");
    assert.doesNotMatch(log("ds-release"), /release prod/);
  });

  it("4068: an applied ciphertext is spent: a replay starts nothing, an older one is refused, a newer one is staged", async () => {
    const before = new Date(Date.now() - 600 * 1000);
    const r = await runUnit("NO-SUCH-KEY");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(applied()) && !existsSync(pending()), "recorded once the verdict stands");
    assert.equal(statSync(applied()).mode & 0o777, 0o600);
    rmSync(join(dir, "ds-release.log"), { force: true });

    const replay = run(`secret-apply ${SHA}`, { input: unitInput });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stdout, /already applied/);
    assert.ok(!existsSync(staged()) && !existsSync(pending()), "nothing staged by a replay");

    const older = run(`secret-apply ${SHA}`, { input: await cipher({ PGBACKREST_REPO1_S3_KEY: "OLDKEYID0001" }, before) });
    assert.equal(older.status, 2, older.stderr);
    assert.match(older.stderr, /not newer than the last applied one/);
    assert.ok(!existsSync(staged()) && !existsSync(pending()));
    assert.doesNotMatch(log("ds-release"), /release prod/, "neither starts a unit");

    const newer = run(`secret-apply ${SHA}`, { input: await cipher(NEW, new Date(Date.now() + 2000)) });
    assert.equal(newer.status, 0, newer.stderr);
    assert.match(newer.stdout, /-data-secret started/);
  });

  it("4068: an unreadable applied record refuses the rotation", async () => {
    secretBox();
    writeFileSync(applied(), "not json\n", { mode: 0o600 });
    const r = run(`secret-apply ${SHA}`, { input: await cipher(NEW) });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /applied-secret record could not be read/);
    assert.ok(!existsSync(staged()));
  });

  // --- 4068: the relay on ds-api-prod --------------------------------------------------
  const relayBox = (image = `ds-api:${SHA}`) => {
    setRole("prod");
    secretRelease();
    writeFileSync(
      join(stubs, "docker"),
      `#!/usr/bin/env bash\n[[ $1 == inspect ]] && { printf '%s\\n' '${image}'; exit 0; }\nexit 1\n`,
    );
    chmodSync(join(stubs, "docker"), 0o755);
    writeFileSync(
      join(stubs, "ssh"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/ssh.log"',
        '[[ $1 == -n ]] || cat > "$STUB_DIR/hop-stdin.log"',
        'echo "hop answered: ${*: -1}"',
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "ssh"), 0o755);
  };

  it("4068: the relay hands each data-secret verb to its data verb over the hop, on the prod box only", () => {
    relayBox();
    const cases = [
      ["data-secret-recipient prod", "secret-recipient"],
      ["data-repo2-tunnel-key prod", "repo2-tunnel-key"],
      [`data-secret-status prod ${SHA}`, `status prod ${SHA}`],
      [`data-secret-finish prod ${SHA} failed`, `finish ${SHA} failed`],
      [`data-secret-apply prod ${SHA}`, `secret-apply ${SHA}`],
    ];
    for (const [command, hop] of cases) {
      const r = run(command, { input: '{"ciphertext":"QUJD"}' });
      assert.equal(r.status, 0, `${command}: ${r.stderr}`);
      assert.equal(r.stdout, `hop answered: ${hop}\n`);
    }
    assert.equal(log("hop-stdin"), '{"ciphertext":"QUJD"}', "only apply forwards stdin");
    assert.match(log("ssh"), /-i \S+\/home\/deploy\/\.ssh\/data-prod-hop .*StrictHostKeyChecking=yes .*deploy@192\.168\.0\.10/);
    assert.equal(log("ds-release"), "ds-release-called check prod\n");
    for (const role of ["data", "stage"]) {
      setRole(role);
      const r = run("data-secret-recipient prod");
      assert.equal(r.status, 3);
      assert.match(r.stderr, /is served by the prod box only/);
    }
  });

  it("4068: data-secret-apply refuses a SHA that is not live, an unknown live SHA, a running release step, and bad words", () => {
    relayBox(`ds-api:${"f".repeat(40)}`);
    const r1 = run(`data-secret-apply prod ${SHA}`, { input: "{}" });
    assert.equal(r1.status, 3);
    assert.match(r1.stderr, /is not the live prod SHA ffffffffffff/);
    relayBox("nginx:latest");
    assert.match(run(`data-secret-apply prod ${SHA}`, { input: "{}" }).stderr, /the live prod SHA is unknown/);
    relayBox();
    assert.equal(run(`data-secret-apply prod ${SHA}`, { input: "{}", env: { STUB_CHECK_RC: "3" } }).status, 3);
    assert.equal(log("ssh"), "", "no hop");
    for (const command of [
      "data-secret-recipient",
      "data-repo2-tunnel-key",
      "data-repo2-tunnel-key prod now",
      "data-secret-apply prod",
      `data-secret-finish prod ${SHA} maybe`,
      `data-secret-status stage-main ${SHA}`,
    ]) {
      assert.equal(run(command).status, 2, command);
    }
  });

  // --- 4153: the api-box secret change on ds-api-prod ----------------------------------
  const apiEnv = () => join(root, "etc/ds-platform/api.env");
  const apiCompose = () => join(tree(), "infra/deploy/compose/api-prod");
  const composeEnv = () => join(apiCompose(), ".env");
  const apiStaged = () => join(root, "etc/ds-platform/.api.env.next");
  const composeStaged = () => join(root, "etc/ds-platform/.api-compose.env.next");
  const apiBackup = () => join(root, "etc/ds-platform/.api.env.previous");
  const composeBackup = () => join(root, "etc/ds-platform/.api-compose.env.previous");
  const SERVER_KEY = `ysc2_${"S".repeat(40)}`;
  const SITE_KEY = `ysc1_${"P".repeat(40)}`;
  const OLD_API =
    "DATABASE_URL=postgresql://ds:db-password@192.168.0.10:5432/ds_prod\n" +
    `AUDIT_IDENTIFIER_PEPPER=${"a".repeat(64)}\nBOT_PROTECTION_ENABLED=true\nSMARTCAPTCHA_SERVER_KEY=${SERVER_KEY}\n`;
  const OLD_COMPOSE = `DEPLOY_SHA=${SHA}\nSMARTCAPTCHA_SITE_KEY=${SITE_KEY}\n`;
  const BOT_TOKEN = `123456789:${"T".repeat(35)}`;
  const OFF = {
    BOT_PROTECTION_ENABLED: "false",
    SMARTCAPTCHA_SERVER_KEY: "",
    SMARTCAPTCHA_SITE_KEY: "",
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  };
  const liveDocker = (image) => {
    writeFileSync(
      join(stubs, "docker"),
      `#!/usr/bin/env bash\necho "docker $*" >> "$STUB_DIR/docker.log"\n[[ $1 == inspect ]] && { printf '%s\\n' '${image}'; exit 0; }\nexit 0\n`,
    );
    chmodSync(join(stubs, "docker"), 0o755);
  };
  const apiBox = (image = `ds-api:${SHA}`) => {
    setRole("prod");
    secretRelease();
    liveDocker(image);
    writeFileSync(apiEnv(), OLD_API, { mode: 0o600 });
    mkdirSync(apiCompose(), { recursive: true });
    writeFileSync(composeEnv(), OLD_COMPOSE, { mode: 0o644 });
    const r = run("api-secret-recipient prod");
    assert.equal(r.status, 0, r.stderr);
  };
  const apiCipher = async (values, { now = new Date(), cert = intakeCert(), sha = SHA } = {}) => {
    const { encryptSecret, secretPlaintext } = await import("./data-secret.mjs");
    return JSON.stringify({ ciphertext: encryptSecret(secretPlaintext(values, { sha, now }), cert) });
  };
  const noValueIn = (text) => {
    for (const v of [BOT_TOKEN, SERVER_KEY, SITE_KEY, "db-password", "a".repeat(64)]) {
      assert.ok(!text.includes(v), "no value in the output");
    }
  };

  it("4153: api-secret-recipient generates ds-api-prod's own intake key, on the prod box only", () => {
    setRole("prod");
    const r = run("api-secret-recipient prod");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^-----BEGIN CERTIFICATE-----\n[\s\S]*-----END CERTIFICATE-----\n(sha256|SHA256) Fingerprint=/);
    assert.doesNotMatch(r.stdout, /PRIVATE KEY/);
    const subject = spawnSync("openssl", ["x509", "-in", intakeCert(), "-noout", "-subject"], { encoding: "utf8" });
    assert.match(subject.stdout, /CN ?= ?ds-api-prod-secret-intake/);
    assert.equal(statSync(join(root, "etc/ds-platform/secret-intake/key.pem")).mode & 0o777, 0o600);
    for (const role of ["data", "stage"]) {
      setRole(role);
      assert.equal(run("api-secret-recipient prod").status, 3, role);
    }
    for (const command of [
      "api-secret-recipient",
      "api-secret-apply prod",
      `api-secret-finish prod ${SHA} maybe`,
      `api-secret-status stage-main ${SHA}`,
    ]) {
      assert.equal(run(command, { input: "" }).status, 2, command);
    }
  });

  it("4153: api-secret-apply stages allowlisted lines of both files — replaced, appended, emptied — and starts the api-secret unit; no value printed", async () => {
    apiBox();
    const r = run(`api-secret-apply prod ${SHA}`, { input: await apiCipher(OFF) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /staged: BOT_PROTECTION_ENABLED, SMARTCAPTCHA_SERVER_KEY, SMARTCAPTCHA_SITE_KEY, TELEGRAM_BOT_TOKEN\n/,
    );
    assert.match(r.stdout, /-api-secret started/);
    noValueIn(r.stdout + r.stderr);
    assert.equal(
      readFileSync(apiStaged(), "utf8"),
      "DATABASE_URL=postgresql://ds:db-password@192.168.0.10:5432/ds_prod\n" +
        `AUDIT_IDENTIFIER_PEPPER=${"a".repeat(64)}\nBOT_PROTECTION_ENABLED=false\nSMARTCAPTCHA_SERVER_KEY=\nTELEGRAM_BOT_TOKEN=${BOT_TOKEN}\n`,
    );
    assert.equal(readFileSync(composeStaged(), "utf8"), `DEPLOY_SHA=${SHA}\nSMARTCAPTCHA_SITE_KEY=\n`);
    assert.equal(statSync(apiStaged()).mode & 0o777, 0o600);
    assert.equal(readFileSync(apiEnv(), "utf8"), OLD_API, "api.env changes only inside the unit");
    assert.equal(readFileSync(composeEnv(), "utf8"), OLD_COMPOSE);
    assert.ok(existsSync(pending()) && !existsSync(applied()));
    assert.match(log("ds-release"), new RegExp(`check prod\nds-release-called release prod ${SHA} api-secret \\S+\n$`));
    const script = readFileSync(join(dir, "step.sh"), "utf8");
    assert.match(script, /docker compose up -d --force-recreate --wait --wait-timeout 300/);
    assert.match(script, /\/v1\/health/);
  });

  it("4153: <generate> fills an absent name on the box and never prints it; it refuses a name that already has a value", async () => {
    apiBox();
    const { GENERATE } = await import("./data-secret.mjs");
    const r = run(`api-secret-apply prod ${SHA}`, { input: await apiCipher({ LIFECYCLE_IMPACT_TOKEN_SECRET: GENERATE }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /generated: LIFECYCLE_IMPACT_TOKEN_SECRET/);
    const secret = readFileSync(apiStaged(), "utf8").match(/^LIFECYCLE_IMPACT_TOKEN_SECRET=([0-9a-f]{64})$/m);
    assert.ok(secret, "a 64-hex value appended");
    assert.ok(!(r.stdout + r.stderr).includes(secret[1]));
    assert.ok(!existsSync(composeStaged()), "the compose .env is not touched");

    rmSync(apiStaged(), { force: true });
    rmSync(pending(), { force: true });
    const again = run(`api-secret-apply prod ${SHA}`, {
      input: await apiCipher({ AUDIT_IDENTIFIER_PEPPER: GENERATE }, { now: new Date(Date.now() + 1000) }),
    });
    assert.equal(again.status, 2, again.stderr);
    assert.match(again.stderr, /AUDIT_IDENTIFIER_PEPPER already has a value/);
    assert.ok(!existsSync(apiStaged()) && !existsSync(pending()), "nothing staged");
  });

  it("4153: api-secret-apply refuses an off-list name, a bad shape, a stale or foreign ciphertext and stages nothing", async () => {
    apiBox();
    const other = join(dir, "other.pem");
    const made = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "other.key"), "-out", other, "-subj", "/CN=other", "-days", "1"],
      { encoding: "utf8" },
    );
    assert.equal(made.status, 0, made.stderr);
    const cases = [
      [await apiCipher({ PGBACKREST_REPO1_S3_KEY: "ABCDEFGH1234" }), /bad payload for secret-stage/],
      [await apiCipher({ IDP_SIGN_IN_PAT: "abcdefgh1234" }), /bad payload for secret-stage/],
      [await apiCipher({ BOT_PROTECTION_ENABLED: "yes" }), /the value of BOT_PROTECTION_ENABLED is not its allowed shape/],
      [await apiCipher({ TELEGRAM_BOT_TOKEN: "1:has space inside the token value x" }), /TELEGRAM_BOT_TOKEN is not its allowed shape/],
      [await apiCipher(OFF, { now: new Date(Date.now() - 7 * 3600 * 1000) }), /encrypted more than 6 h ago/],
      [await apiCipher(OFF, { sha: "f".repeat(40) }), /encrypted for another prod SHA/],
      [await apiCipher(OFF, { cert: other }), /does not decrypt with this box's intake key/],
    ];
    for (const [input, reason] of cases) {
      const r = run(`api-secret-apply prod ${SHA}`, { input });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, reason);
      noValueIn(r.stdout + r.stderr);
      assert.ok(!existsSync(apiStaged()) && !existsSync(composeStaged()) && !existsSync(pending()), "nothing staged");
    }
    assert.doesNotMatch(log("ds-release"), /release prod/, "no unit started");
  });

  it("4153: api-secret-apply refuses a SHA that is not live, an unknown live SHA, a running release and a box with no intake key — before decrypting", async () => {
    apiBox();
    const input = await apiCipher(OFF);
    liveDocker(`ds-api:${"f".repeat(40)}`);
    const r1 = run(`api-secret-apply prod ${SHA}`, { input });
    assert.equal(r1.status, 3);
    assert.match(r1.stderr, /is not the live prod SHA ffffffffffff/);
    liveDocker("nginx:latest");
    assert.match(run(`api-secret-apply prod ${SHA}`, { input }).stderr, /the live prod SHA is unknown/);
    liveDocker(`ds-api:${SHA}`);
    const r3 = run(`api-secret-apply prod ${SHA}`, { input, env: { STUB_CHECK_RC: "3" } });
    assert.equal(r3.status, 3, "refused while a ds-prod-* unit runs");
    rmSync(join(root, "etc/ds-platform/secret-intake"), { recursive: true });
    const r4 = run(`api-secret-apply prod ${SHA}`, { input });
    assert.equal(r4.status, 3);
    assert.match(r4.stderr, /no intake key on this box: run api-secret-recipient first/);
    assert.ok(!existsSync(apiStaged()) && !existsSync(pending()));
    assert.doesNotMatch(log("ds-release"), /release prod/);
    setRole("data");
    assert.equal(run(`api-secret-apply prod ${SHA}`, { input }).status, 3, "the prod box only");
  });

  // The api-secret unit's script, run for real: the in-container /v1/health answers
  // with a failure while api.env holds `failValue`, and /v1/ready (DB + object
  // storage) while it holds `readyFailValue`.
  let apiUnitInput;
  const runApiUnit = async (failValue, now = new Date(), readyFailValue = "NO-SUCH-VALUE") => {
    apiBox();
    apiUnitInput = await apiCipher(OFF, { now });
    assert.equal(run(`api-secret-apply prod ${SHA}`, { input: apiUnitInput }).status, 0);
    rmSync(join(dir, "docker.log"), { force: true });
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'echo "docker $*" >> "$STUB_DIR/docker.log"',
        `[[ $1 == inspect ]] && { echo 'ds-api:${SHA}'; exit 0; }`,
        `[[ $1 == exec && $* == */v1/ready* ]] && grep -q -- '${readyFailValue}' '${apiEnv()}' && exit 1`,
        `[[ $1 == exec && $* == */v1/health* ]] && grep -q -- '${failValue}' '${apiEnv()}' && exit 1`,
        "exit 0",
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(stubs, "install"),
      '#!/usr/bin/env bash\nargs=(); skip=0\nfor a in "$@"; do\n  if [[ $skip == 1 ]]; then skip=0; continue; fi\n  case $a in -o|-g) skip=1 ;; *) args+=("$a") ;; esac\ndone\nexec /usr/bin/install "${args[@]}"\n',
    );
    chmodSync(join(stubs, "docker"), 0o755);
    chmodSync(join(stubs, "install"), 0o755);
    return spawnSync("bash", ["--norc", "-euo", "pipefail", join(dir, "step.sh")], {
      env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: dir },
      encoding: "utf8",
    });
  };

  it("4153: the api-secret unit swaps both files keeping their modes, recreates the live SHA's stack and checks /v1/health and /v1/ready", async () => {
    const r = await runApiUnit("NO-SUCH-VALUE");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(apiEnv(), "utf8"), /^BOT_PROTECTION_ENABLED=false$/m);
    assert.match(readFileSync(composeEnv(), "utf8"), /^SMARTCAPTCHA_SITE_KEY=$/m);
    assert.equal(statSync(apiEnv()).mode & 0o777, 0o600);
    assert.equal(statSync(composeEnv()).mode & 0o777, 0o644);
    for (const f of [apiStaged(), composeStaged(), apiBackup(), composeBackup()]) assert.ok(!existsSync(f), f);
    const calls = log("docker").trim().split("\n");
    assert.equal(calls[0], "docker compose up -d --force-recreate --wait --wait-timeout 300");
    assert.ok(
      calls.some((l) => l.startsWith("docker exec ds-api-prod-api-1 node -e ") && l.includes("/v1/health") && l.includes(SHA)),
      calls.join("\n"),
    );
    assert.ok(
      calls.some((l) => l.startsWith("docker exec ds-api-prod-api-1 node -e ") && l.includes("/v1/ready")),
      calls.join("\n"),
    );
    assert.ok(existsSync(applied()) && !existsSync(pending()));
    noValueIn(r.stdout + r.stderr);
  });

  it("4153: a healthy api whose /v1/ready reports down (a broken DATABASE_URL) puts both previous files back and fails the unit", async () => {
    const r = await runApiUnit("NO-SUCH-VALUE", new Date(), "BOT_PROTECTION_ENABLED=false");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /restoring the previous api\.env and compose \.env/);
    assert.equal(readFileSync(apiEnv(), "utf8"), OLD_API);
    assert.equal(readFileSync(composeEnv(), "utf8"), OLD_COMPOSE);
    assert.ok(!existsSync(apiBackup()) && !existsSync(composeBackup()));
    assert.equal(log("docker").split("\n").filter((l) => l.includes(" up -d ")).length, 2, "recreated twice");
    assert.ok(existsSync(applied()) && !existsSync(pending()), "a rolled-back ciphertext is spent too");
    noValueIn(r.stdout + r.stderr);
  });

  it("4153: a failed /v1/health puts both previous files back, recreates again and fails the unit", async () => {
    const r = await runApiUnit("BOT_PROTECTION_ENABLED=false");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /restoring the previous api\.env and compose \.env/);
    assert.equal(readFileSync(apiEnv(), "utf8"), OLD_API);
    assert.equal(readFileSync(composeEnv(), "utf8"), OLD_COMPOSE);
    assert.equal(statSync(apiEnv()).mode & 0o777, 0o600);
    assert.equal(statSync(composeEnv()).mode & 0o777, 0o644);
    assert.ok(!existsSync(apiBackup()) && !existsSync(composeBackup()));
    assert.equal(log("docker").split("\n").filter((l) => l.includes(" up -d ")).length, 2, "recreated twice");
    assert.ok(existsSync(applied()) && !existsSync(pending()), "a rolled-back ciphertext is spent too");
  });

  it("4153: an applied api ciphertext is spent: a replay starts nothing, an older one is refused", async () => {
    const before = new Date(Date.now() - 600 * 1000);
    assert.equal((await runApiUnit("NO-SUCH-VALUE")).status, 0);
    rmSync(join(dir, "ds-release.log"), { force: true });
    const replay = run(`api-secret-apply prod ${SHA}`, { input: apiUnitInput });
    assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stdout, /already applied/);
    const older = run(`api-secret-apply prod ${SHA}`, {
      input: await apiCipher({ BOT_PROTECTION_ENABLED: "true" }, { now: before }),
    });
    assert.equal(older.status, 2, older.stderr);
    assert.match(older.stderr, /not newer than the last applied one/);
    assert.ok(!existsSync(apiStaged()) && !existsSync(pending()));
    assert.doesNotMatch(log("ds-release"), /release prod/);
  });

  it("4153: api-secret-status and api-secret-finish read and close the attempt with the local ds-release", () => {
    apiBox();
    rmSync(join(dir, "ds-release.log"), { force: true });
    assert.equal(run(`api-secret-status prod ${SHA}`).status, 0);
    assert.equal(run(`api-secret-finish prod ${SHA} succeeded`).status, 0);
    assert.equal(
      log("ds-release"),
      `ds-release-called status prod ${SHA}\nds-release-called finish prod ${SHA} succeeded\n`,
    );
  });

  // --- 4089: the certified PostgreSQL artifact, delivered by the Actions release -------
  // #4104: the ids are the digests of the image targets a containerd-store `docker image
  // save` lists in index.json (ds-data-prod runs that store), so the fixture's ids are
  // the real digests of its target blobs.
  const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
  const digest = (body) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const TARGETS = ["postgres", "pgbackrest", "other"].map((role) => JSON.stringify({ schemaVersion: 2, mediaType: OCI_INDEX, role }));
  const [PG_ID, BR_ID, OTHER_ID] = TARGETS.map(digest);
  const CONFIGS = ["c1", "c2", "c3"];
  const pgCertificate = (over = {}) =>
    JSON.stringify({ schema: 1, sourceHash: "a".repeat(64), images: { postgres: { id: PG_ID }, pgbackrest: { id: BR_ID } }, ...over });
  const artifactDir = (sha = SHA) => join(root, "var/lib/ds-platform/postgres-artifact", sha);

  it("4089: postgres-artifact keeps a release's certificate and images on the prod box, one SHA at a time", () => {
    relayBox();
    const stale = artifactDir("f".repeat(40));
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "images.tar"), "old");
    const c = run(`postgres-artifact prod ${SHA} certificate`, { input: pgCertificate() });
    assert.equal(c.status, 0, String(c.stderr));
    assert.equal(readFileSync(join(artifactDir(), "certificate.json"), "utf8"), pgCertificate());
    assert.ok(!existsSync(stale), "an earlier SHA's delivery is removed");
    const i = run(`postgres-artifact prod ${SHA} images`, { input: Buffer.from("docker image archive") });
    assert.equal(i.status, 0, String(i.stderr));
    assert.equal(readFileSync(join(artifactDir(), "images.tar"), "utf8"), "docker image archive");
    assert.deepEqual(readdirSync(artifactDir()).sort(), ["certificate.json", "images.tar"], "no temp file left");
    assert.match(String(i.stdout), /postgres-artifact images of 0123456789ab stored/);
    assert.equal(log("ssh"), "", "the prod box keeps it; the release driver loads it into ds-data-prod");
  });

  it("4089: postgres-artifact refuses a malformed certificate, an oversized archive, a running release step, another box and bad words", () => {
    relayBox();
    for (const bad of ["not json", pgCertificate({ schema: 2 }), pgCertificate({ sourceHash: "x" }), pgCertificate({ images: { postgres: { id: PG_ID } } })]) {
      const r = run(`postgres-artifact prod ${SHA} certificate`, { input: bad });
      assert.equal(r.status, 2, bad);
      assert.ok(!existsSync(join(artifactDir(), "certificate.json")), bad);
    }
    const big = run(`postgres-artifact prod ${SHA} images`, { input: Buffer.alloc(64, 1), env: { DS_ENTRYPOINT_MAX_PG_ARTIFACT_BYTES: "32" } });
    assert.equal(big.status, 2);
    assert.match(String(big.stderr), /exceeds 32 bytes/);
    assert.ok(!existsSync(join(artifactDir(), "images.tar")));
    assert.equal(run(`postgres-artifact prod ${SHA} certificate`, { input: pgCertificate(), env: { STUB_CHECK_RC: "3" } }).status, 3);
    for (const role of ["data", "stage"]) {
      setRole(role);
      const r = run(`postgres-artifact prod ${SHA} certificate`, { input: pgCertificate() });
      assert.equal(r.status, 3, role);
      assert.match(r.stderr, /is served by the prod box only/);
    }
    for (const command of [`postgres-artifact prod ${SHA}`, `postgres-artifact stage-main ${SHA} images`, `postgres-artifact prod ${SHA} tree`, "postgres-artifact prod abc images"]) {
      assert.equal(run(command, { input: "" }).status, 2, command);
    }
  });

  const loadBox = () => {
    setRole("data");
    writeFileSync(
      join(stubs, "docker"),
      [
        "#!/usr/bin/env bash",
        'echo "docker $*" >> "$STUB_DIR/docker.log"',
        '[[ $1 == load && $2 == -i ]] && { cp -- "$3" "$STUB_DIR/loaded.tar"; echo "Loaded image ID: sha256:1111"; exit "${STUB_LOAD_RC:-0}"; }',
        '[[ $1 == image && $2 == inspect ]] && { echo "${STUB_INSPECT_ID:-${@: -1}}"; exit 0; }',
        "exit 1",
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "docker"), 0o755);
  };
  // A `docker image save <id> <id>` archive of the containerd store, as measured on Docker
  // 29.4.2 (#4104): blobs/, blobs/sha256/, the blobs, index.json, manifest.json, oci-layout.
  const imageArchive = ({ ids = [PG_ID, BR_ID], tags = {}, extra = [], entry = (e) => e, index = (i) => i, drop = [], blob = (b) => b } = {}) => {
    const roles = ids.map((id) => [PG_ID, BR_ID, OTHER_ID].indexOf(id));
    const members = [
      { name: "blobs/", type: "5" },
      { name: "blobs/sha256/", type: "5" },
      ...CONFIGS.map((c) => ({ name: `blobs/sha256/${digest(c).slice(7)}`, body: c })),
      ...TARGETS.map((t, i) => ({ name: `blobs/sha256/${digest(t).slice(7)}`, body: blob(t, i) })),
      {
        name: "index.json",
        body: JSON.stringify(
          index({ schemaVersion: 2, mediaType: OCI_INDEX, manifests: ids.map((id, i) => entry({ mediaType: OCI_INDEX, digest: id, size: Buffer.byteLength(TARGETS[roles[i]]) }, i)) }),
        ),
      },
      {
        name: "manifest.json",
        body: JSON.stringify(ids.map((id, i) => ({ Config: `blobs/sha256/${digest(CONFIGS[roles[i]]).slice(7)}`, RepoTags: tags[id] ?? null, Layers: [] }))),
      },
      { name: "oci-layout", body: '{"imageLayoutVersion":"1.0.0"}' },
      ...extra,
    ];
    return tarArchive(members.filter((m) => !drop.includes(m.name)));
  };
  const load = (input, env) => run(`postgres-load ${SHA} ${PG_ID.slice(7)} ${BR_ID.slice(7)}`, { input, env });

  it("4089: postgres-load docker-loads exactly the certified untagged images, checks their ids and keeps no copy", () => {
    loadBox();
    const archive = imageArchive();
    const r = load(archive);
    assert.equal(r.status, 0, String(r.stderr));
    assert.deepEqual(readFileSync(join(dir, "loaded.tar")), archive);
    assert.match(String(r.stdout), new RegExp(`certified images ${PG_ID.slice(7, 19)} / ${BR_ID.slice(7, 19)} of 0123456789ab loaded`));
    assert.equal(log("docker"), `docker load -i ${log("docker").split("\n")[0].split(" ")[3]}\ndocker image inspect --format {{.Id}} ${PG_ID}\ndocker image inspect --format {{.Id}} ${BR_ID}\n`);
    const work = join(root, "var/lib/ds-platform");
    assert.deepEqual(existsSync(work) ? readdirSync(work).filter((n) => n.includes("postgres-load")) : [], [], "the upload is removed");
  });

  it("4089 / 4104: postgres-load refuses an archive with an extra image, a wrong id, a tag, a name or a member outside the containerd archive before loading it", () => {
    loadBox();
    const want = new RegExp(`are not the certified ${PG_ID.slice(0, 19)}… / ${BR_ID.slice(0, 19)}…`);
    const cases = [
      [imageArchive({ ids: [PG_ID, BR_ID, OTHER_ID] }), /holds 3 images, not the 2 certified/],
      [imageArchive({ ids: [PG_ID, OTHER_ID] }), want],
      [imageArchive({ ids: [PG_ID, PG_ID] }), /are not the certified/],
      [imageArchive({ tags: { [BR_ID]: ["postgres:17"] } }), /an image carries a tag/],
      [imageArchive({ extra: [{ name: "repositories", body: JSON.stringify({ postgres: { 17: BR_ID.slice(7) } }) }] }), /a member outside a containerd image archive/],
      [imageArchive({ extra: [{ name: "extra.json", body: "{}" }] }), /a member outside a containerd image archive/],
      [imageArchive({ extra: [{ name: "blobs/sha512/", type: "5" }] }), /a member outside a containerd image archive/],
      [imageArchive({ drop: ["index.json"] }), /no index\.json/],
      [imageArchive({ drop: ["oci-layout"] }), /no oci-layout/],
      [imageArchive({ entry: (e, i) => (i === 1 ? { ...e, annotations: { "io.containerd.image.name": "docker.io/library/postgres:17" } } : e) }), /an index\.json entry names an image/],
      [imageArchive({ entry: (e, i) => (i === 0 ? { ...e, annotations: { "org.opencontainers.image.ref.name": "17" } } : e) }), /an index\.json entry names an image/],
      [imageArchive({ entry: (e) => ({ ...e, platform: { os: "linux" } }) }), /an index\.json entry/],
      [imageArchive({ entry: (e, i) => (i === 0 ? { ...e, size: e.size + 1 } : e) }), /blob is absent or not of its size/],
      [imageArchive({ blob: (b, i) => (i === 0 ? b.replace("postgres", "postgreZ") : b) }), /blob is not of its digest/],
      [imageArchive({ index: (x) => ({ ...x, annotations: {} }) }), /index\.json is not an OCI image index/],
      [
        imageArchive({ extra: [{ name: "manifest.json", body: "[]" }] }),
        /more than one manifest\.json/,
      ],
      [Buffer.from("not a tar archive at all"), /not a docker image archive/],
      [imageArchive({ extra: [{ name: ".//manifest.json", body: "[]" }] }), /a member name not in normal form/],
      [imageArchive({ extra: [{ name: "./manifest.json", body: "[]" }] }), /a member name not in normal form/],
      [imageArchive({ extra: [{ name: "a/../manifest.json", body: "[]" }] }), /a member name not in normal form/],
      [imageArchive({ extra: [{ name: "../escape", body: "x" }] }), /a member name not in normal form/],
      [imageArchive({ extra: [{ name: "././@LongLink", type: "L", body: "manifest.json\0" }, { name: "decoy", body: "[]" }] }), /not a plain ustar header/],
      [imageArchive({ extra: [{ name: "pax", type: "x", body: "22 path=manifest.json\n" }, { name: "decoy", body: "[]" }] }), /not a plain ustar header/],
      [imageArchive({ extra: [{ name: "manifest.json", type: "2", link: "index.json" }] }), /a link or special member/],
      [imageArchive({ extra: [{ name: "manifest.json", prefix: "x", body: "[]" }] }), /not a plain ustar header/],
      [imageArchive({ extra: [{ name: "gnu", magic: "ustar ", body: "x" }] }), /not a plain ustar header/],
    ];
    for (const [input, why] of cases) {
      const r = load(input);
      assert.equal(r.status, 3, String(why));
      assert.match(String(r.stderr), why);
      assert.equal(String(r.stderr).trim().split("\n").length, 1, "a status line only");
    }
    assert.equal(log("docker"), "", "nothing loaded");
  });

  it("4089: postgres-load refuses when the loaded ids are not the certified ones", () => {
    loadBox();
    const r = load(imageArchive(), { STUB_INSPECT_ID: `sha256:${"4".repeat(64)}` });
    assert.equal(r.status, 3);
    assert.match(String(r.stderr), new RegExp(`docker load of 0123456789ab did not yield the certified image ${PG_ID.slice(0, 19)}`));
  });

  it("4089: postgres-load refuses an oversized stream, a failed load, another box and bad words", () => {
    loadBox();
    const big = load(Buffer.alloc(64, 1), { DS_ENTRYPOINT_MAX_PG_ARTIFACT_BYTES: "32" });
    assert.equal(big.status, 2);
    assert.equal(log("docker"), "", "nothing loaded");
    assert.equal(load(imageArchive(), { STUB_LOAD_RC: "1" }).status, 3);
    const pg = PG_ID.slice(7);
    const br = BR_ID.slice(7);
    for (const command of [
      "postgres-load",
      `postgres-load ${SHA}`,
      `postgres-load ${SHA} ${pg}`,
      `postgres-load ${SHA} ${pg} ${br} x`,
      `postgres-load abc ${pg} ${br}`,
      `postgres-load ${SHA} ${pg.slice(1)} ${br}`,
      `postgres-load ${SHA} ${pg} ${pg}`,
    ]) {
      assert.equal(run(command, { input: "" }).status, 2, command);
    }
    setRole("prod");
    const r = load(imageArchive());
    assert.equal(r.status, 3);
    assert.match(r.stderr, /is served by the data box only/);
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
        `docker compose exec -T pgbackrest gosu postgres pgbackrest --stanza=ds info @${compose}\n` +
        // #4298: repo1's config names repo1 alone; each offsite repo that is on is
        // read under its own config.
        `docker compose exec -T pgbackrest sh -c ${OFFSITE_INFO_SH} @${compose}\n`,
    );
  });

  it("4298: backup-info reads each offsite repo that is on through pgbackrest-repo.sh, 20 lines each, never failing the verb", () => {
    const sidecar = mkdtempSync(join(tmpdir(), "offsite-info-"));
    const bin = join(sidecar, "bin");
    mkdirSync(bin);
    mkdirSync(join(sidecar, "offsite", "repo3"), { recursive: true });
    writeFileSync(join(sidecar, "offsite", "repo3", "pgbackrest.conf"), "");
    writeFileSync(join(bin, "gosu"), '#!/usr/bin/env bash\nshift; exec "$@"\n', { mode: 0o755 });
    const repo = join(sidecar, "pgbackrest-repo.sh");
    writeFileSync(repo, '#!/usr/bin/env bash\nfor i in $(seq 1 30); do echo "repo$1 line $i ${*:2}"; done\nexit 1\n', { mode: 0o755 });
    const script = OFFSITE_INFO_SH.replaceAll("/etc/pgbackrest/offsite", join(sidecar, "offsite")).replaceAll(
      "/usr/local/bin/pgbackrest-repo.sh",
      repo,
    );
    const r = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines[0], "offsite repo3:");
    assert.equal(lines[1], "repo3 line 1 info");
    assert.equal(lines.length, 21);
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
    assert.deepEqual(JSON.parse(String(r.stdout)), { role: "prod", mode: "read", verbs: ["capabilities", "schema", "observe", "rehearse", "rehearse-restore", "rehearsal-status", "release-journal", "host-state", "recovery-bundle", "recovery-check"] });
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
    "rehearse-restore",
    `rehearse-restore ${SHA.slice(0, 12)}`,
    `rehearse-restore ${SHA} now`,
    `rehearse-restore --apply ${SHA}`,
    `rehearsal-status`,
    "release-journal",
    `release-journal ${SHA.slice(0, 12)}`,
    `release-journal ${SHA} now`,
    `release-journal ../${SHA}`,
    "host-state now",
    `host-state ${SHA}`,
    "read-schema",
    "read-host-state",
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

  it("3648: rehearse-restore with nothing pending checks the SHA, ships the migrations and starts the restore-only unit", () => {
    rehearseBoxes();
    const r = readRun(`rehearse-restore ${SHA}`, { env: rehearseEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "ds-read-entrypoint: state started\n");
    assert.deepEqual(decrypt(r.stdout), { verb: "rehearse-restore", sha: SHA, state: "started", pending: 0 });
    assert.match(log("curl").split("\n")[0], new RegExp(`/compare/refs/heads/main\\.\\.\\.${SHA}$`));
    assert.equal(log("ds-release"), "ds-release-called check prod\ndata-ds-release check prod\n");
    const hops = log("ssh").trimEnd().split("\n").map((l) => l.split("deploy@192.168.0.10 ")[1]);
    assert.deepEqual(hops, ["check", `rehearse-restore ${SHA}`]);
    // The same lock as `rehearse`; the harness's restore-only start.
    assert.match(log("flock"), new RegExp(`^flock -n -E 75 \\S*/run/ds-platform/ds-rehearsal\\.lock python3 -I \\S*rehearse-migration\\.py start ${SHA} \\S+ --restore-only$`, "m"));
    const unit = readFileSync(join(dir, "fake.log"), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l)).find((c) => c.tool === "systemd-run");
    assert.ok(unit.args.includes(`--unit=ds-rehearse-${SHA.slice(0, 12)}`), "the same unit");
  });

  for (const [label, compare] of [["ahead of main", "ahead"], ["diverged from main", "diverged"], ["unknown to GitHub", null]]) {
    it(`3648: rehearse-restore rejects (exit 2) a SHA ${label}, before any download or hop`, () => {
      rehearseBoxes({ compare });
      const r = readRun(`rehearse-restore ${SHA}`, { env: rehearseEnv() });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /contained in main/);
      assert.ok(!log("curl").includes("codeload"), "no download");
      assert.ok(!log("ssh").includes("rehearse"), "no data verb");
    });
  }

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

  // --- 4067: a failed release's journal, key-free --------------------------------------
  const journalBox = ({ status, failure, lines = 3 } = {}) => {
    readBoxes();
    writeFileSync(
      join(stubs, "journalctl"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/journalctl.log"',
        `for i in $(seq 1 ${lines}); do echo "2026-11-13T10:00:0$((i % 10))+00:00 ds-api-prod node[1]: $2 line $i"; done`,
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "journalctl"), 0o755);
    const sha12 = SHA.slice(0, 12);
    if (status) {
      mkdirSync(join(root, "var/lib/ds-platform/release/prod"), { recursive: true });
      writeFileSync(join(root, `var/lib/ds-platform/release/prod/${SHA}.json`), JSON.stringify(status(sha12)));
    }
    if (failure !== undefined) {
      mkdirSync(join(root, "var/lib/ds-platform/release-driver"), { recursive: true });
      writeFileSync(join(root, `var/lib/ds-platform/release-driver/${SHA}.failure`), failure);
    }
    return sha12;
  };

  it("4067: release-journal answers the driver's journal, the failed step units and the failure note, encrypted", () => {
    const note = { phase: "postgres-verify", reason: "PostgreSQL guard: missing/stale artifact certification" };
    const sha12 = journalBox({
      status: (s) => ({
        steps: [
          { name: "pull", unit: `ds-prod-${s}-pull`, rc: 0 },
          { name: "migrate", unit: `ds-prod-${s}-migrate`, rc: 1 },
          { name: "prune", unit: `ds-prod-${s}-prune`, rc: null },
          { name: "other", unit: `ds-prod-ffffffffffff-migrate`, rc: 1 },
          { name: "evil", unit: `ds-prod-${s}-x; reboot`, rc: 1 },
        ],
      }),
      failure: `${JSON.stringify(note)}\n`,
    });
    const r = readRun(`release-journal ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "", "status lines only: the journal leaves encrypted");
    assert.doesNotMatch(r.stdout.toString("latin1"), /line 1/);
    const answer = decrypt(r.stdout);
    assert.equal(answer.verb, "release-journal");
    assert.equal(answer.sha, SHA);
    assert.deepEqual(answer.failure, note);
    assert.deepEqual(
      answer.units.map((u) => u.unit),
      [
        `ds-prod-${sha12}-driver`,
        `ds-prod-${sha12}-migrate`,
        `ds-prod-${sha12}-prune`,
        `ds-prod-${sha12}-api-secret`,
        `ds-prod-${sha12}-data-secret`,
      ],
    );
    assert.deepEqual(answer.units[0].lines.map((l) => l.split(": ").at(-1)), [
      `ds-prod-${sha12}-driver line 1`,
      `ds-prod-${sha12}-driver line 2`,
      `ds-prod-${sha12}-driver line 3`,
    ]);
    assert.equal(answer.units[0].truncated, false);
    assert.equal(
      log("journalctl"),
      [
        ["driver", " -t release-driver"],
        ["migrate", ""],
        ["prune", ""],
        ["api-secret", ""],
        ["data-secret", ""],
      ]
        .map(([u, match]) => `-u ds-prod-${sha12}-${u}${match} -n 400 -o short-iso -q --no-pager\n`)
        .join(""),
    );
    assert.equal(log("ds-release") + log("docker"), "", "no release check");
    assert.match(log("ssh"), new RegExp(`read-secret-journal ${SHA}\\n$`), "one hop: read-secret-journal <sha>");
  });

  it("4280: release-journal answers the SHA's data-secret and api-secret unit journals, never a value line", () => {
    const sha12 = journalBox({});
    // A planted data.env with secret-looking values; the secret units' stub journal
    // carries pgBackRest's error line and a line that would print a value.
    mkdirSync(join(dataRoot(), "etc/ds-platform"), { recursive: true });
    writeFileSync(
      join(dataRoot(), "etc/ds-platform/data.env"),
      "PGBACKREST_REPO3_S3_KEY_SECRET=planted-secret-4280\nPGBACKREST_REPO3_S3_ENDPOINT=s3.example.test\n",
    );
    writeFileSync(
      join(stubs, "journalctl"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/journalctl.log"',
        'echo "2026-11-26T10:00:00+00:00 ds-data-prod bash[1]: $2 line 1"',
        'case $2 in *-secret)',
        '  echo "2026-11-26T10:00:01+00:00 ds-data-prod bash[1]: P00 ERROR: [039]: HTTP request failed with 403 (Forbidden) ?list-type=2"',
        `  echo "2026-11-26T10:00:02+00:00 ds-data-prod bash[1]: PGBACKREST_REPO3_S3_KEY_SECRET=$(grep -o 'planted-[a-z0-9-]*' '${join(dataRoot(), "etc/ds-platform/data.env")}')" ;;`,
        "esac",
      ].join("\n") + "\n",
    );
    const r = readRun(`release-journal ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    const byName = Object.fromEntries(answer.units.map((u) => [u.unit.slice(`ds-prod-${sha12}-`.length), u]));
    for (const unit of ["api-secret", "data-secret"]) {
      assert.deepEqual(byName[unit].lines.map((l) => l.split("]: ").slice(1).join("]: ")), [
        `ds-prod-${sha12}-${unit} line 1`,
        "P00 ERROR: [039]: HTTP request failed with 403 (Forbidden) ?list-type=2",
      ]);
      assert.equal(byName[unit].truncated, false);
    }
    assert.doesNotMatch(JSON.stringify(answer), /planted-secret-4280/);
    assert.doesNotMatch(r.stdout.toString("latin1") + r.stderr, /planted-secret-4280/);
    assert.equal(byName.driver.lines.length, 1, "the release units read as before");
  });

  it("4280: release-journal drops a secret unit's docker compose interpolation warning, which can quote a value fragment", () => {
    const sha12 = journalBox({});
    writeFileSync(
      join(stubs, "journalctl"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/journalctl.log"',
        'echo "2026-11-26T10:00:00+00:00 ds-api-prod bash[1]: $2 line 1"',
        // compose quotes the text after a "$" of a .env value as the variable's name
        `echo '2026-11-26T10:00:01+00:00 ds-api-prod bash[1]: time="2026-11-26T10:00:01Z" level=warning msg="The \\"fragOf4280value\\" variable is not set. Defaulting to a blank string."'`,
        `echo '2026-11-26T10:00:02+00:00 ds-api-prod bash[1]: WARN[0000] The "fragOf4280value" variable is not set. Defaulting to a blank string.'`,
      ].join("\n") + "\n",
    );
    const answer = decrypt(readRun(`release-journal ${SHA}`).stdout);
    const byName = Object.fromEntries(answer.units.map((u) => [u.unit.slice(`ds-prod-${sha12}-`.length), u]));
    for (const unit of ["api-secret", "data-secret"])
      assert.deepEqual(byName[unit].lines.map((l) => l.split("]: ").at(-1)), [`ds-prod-${sha12}-${unit} line 1`], unit);
    assert.equal(byName.driver.lines.length, 3, "the release units keep their lines");
  });

  it("4280: release-journal answers an empty data-secret journal with no reason — no rotation ran", () => {
    const sha12 = journalBox({});
    writeFileSync(join(stubs, "journalctl"), '#!/usr/bin/env bash\necho "$*" >> "$STUB_DIR/journalctl.log"\n');
    const answer = decrypt(readRun(`release-journal ${SHA}`).stdout);
    assert.deepEqual(answer.units.at(-1), { unit: `ds-prod-${sha12}-data-secret`, lines: [], truncated: false });
  });

  for (const [what, body, reason] of [
    ["an unreachable data box", 'echo "ssh: connect to host: secret detail" >&2\nexit 255', "ds-data-prod is unreachable"],
    ["a hop that times out", "exit 124", "the read timed out"],
    ["a data box that predates the verb", 'echo "ds-deploy-entrypoint: rejected: unknown command" >&2\nexit 2', "ds-data-prod does not serve read-secret-journal (the next release installs it)"],
    ["a refused hop", 'echo "refused: secret detail" >&2\nexit 3', "ds-data-prod does not serve read-secret-journal (the next release installs it)"],
    ["any other hop failure", 'echo "secret detail"\nexit 1', "the read failed"],
  ]) {
    it(`4280: release-journal with ${what} answers the data-secret unit with a fixed reason, not as an empty journal`, () => {
      const sha12 = journalBox({});
      writeFileSync(join(stubs, "ssh"), `#!/usr/bin/env bash\n${body}\n`);
      const r = readRun(`release-journal ${SHA}`);
      assert.equal(r.status, 0, r.stderr);
      const answer = decrypt(r.stdout);
      const data = answer.units.at(-1);
      assert.equal(data.unit, `ds-prod-${sha12}-data-secret`);
      assert.equal(data.reason, reason);
      assert.deepEqual(data.lines, [], "a failed hop's output never reads as the unit's journal");
      assert.equal(answer.units[0].lines.length, 3, "the api box's units still answer");
      assert.ok(!("reason" in answer.units[0]), "a readable unit carries no reason");
      assert.doesNotMatch(JSON.stringify(answer) + r.stderr, /secret detail/);
      assert.equal(releaseJournalLines(answer).find((l) => l.startsWith(`== ${data.unit}`)), `== ${data.unit} (not read — ${reason})`);
    });
  }

  it("4067: release-journal bounds each unit's tail and answers the driver's alone with no status file or note", () => {
    const sha12 = journalBox({ lines: 4000, failure: "not json" });
    const r = readRun(`release-journal ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    assert.equal(answer.failure, null);
    assert.deepEqual(
      answer.units.map((u) => u.unit),
      [`ds-prod-${sha12}-driver`, `ds-prod-${sha12}-api-secret`, `ds-prod-${sha12}-data-secret`],
    );
    for (const u of answer.units) assert.ok(Buffer.byteLength(u.lines.join("\n")) <= 256 * 1024, u.unit);
    // the stub ignores -n: the byte bound holds the answer
    assert.ok(Buffer.byteLength(answer.units[0].lines.join("\n")) <= 256 * 1024);
    assert.equal(answer.units[0].truncated, true);
    assert.match(answer.units[0].lines.at(-1), /line 4000$/);
  });

  it("4124: release-journal reads the driver unit by its release-driver identifier, so sudo audit lines never push out the data-prod phases", () => {
    const sha12 = journalBox({
      status: (s) => ({ steps: [{ name: "migrate", unit: `ds-prod-${s}-migrate`, rc: 1 }] }),
    });
    // The measured shape (prod-observe run 44035314228): the driver's own lines between
    // root's sudo audit lines; the app phases alone fill a 400-line window with ~250 of them.
    const at = (i) =>
      `2026-11-17T10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}+00:00 ds-api-prod`;
    const sudo = (i) => `${at(i)} sudo[${1000 + i}]:     root : PWD=/ ; USER=root ; COMMAND=/usr/bin/docker compose ps -q`;
    const driver = (i, text) => `${at(i)} release-driver[77]: ${text}`;
    const statusLines = [
      "▶ postgres-verify",
      "▶ postgres-load",
      "✓ postgres-load",
      "▶ data-env",
      "▶ data-prod up",
      "↳ PostgreSQL checkpoint written (storage driver overlay2)",
      "✓ data-prod up",
      "▶ backup",
      "↳ pre-migrate incr backup taken",
      "✓ backup",
    ];
    const fixture = [];
    let n = 0;
    for (const text of statusLines) fixture.push(sudo(n++), driver(n++, text), sudo(n++));
    for (let i = 0; i < 150; i++) fixture.push(driver(n++, `▶ app step ${i}`), sudo(n++), sudo(n++));
    const journal = join(stubs, "journal.fixture");
    writeFileSync(journal, `${fixture.join("\n")}\n`);
    // journalctl as journald answers it: -t keeps one SYSLOG_IDENTIFIER, -n the last lines.
    writeFileSync(
      join(stubs, "journalctl"),
      [
        "#!/usr/bin/env bash",
        'echo "$*" >> "$STUB_DIR/journalctl.log"',
        'ident="" lines=0',
        'while (($#)); do case $1 in -t) ident=$2; shift ;; -n) lines=$2; shift ;; esac; shift; done',
        `if [[ -n $ident ]]; then grep -E "^[^ ]+ [^ ]+ $ident\\[" "${journal}"; else cat "${journal}"; fi | tail -n "$lines"`,
      ].join("\n") + "\n",
    );
    chmodSync(join(stubs, "journalctl"), 0o755);
    const r = readRun(`release-journal ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    const [driverUnit, migrateUnit] = decrypt(r.stdout).units;
    assert.equal(driverUnit.unit, `ds-prod-${sha12}-driver`);
    const kept = driverUnit.lines.map((l) => l.split("]: ").slice(1).join("]: "));
    for (const text of statusLines) assert.ok(kept.includes(text), `the driver's answer keeps «${text}»`);
    assert.equal(driverUnit.lines.filter((l) => / sudo\[/.test(l)).length, 0, "no sudo audit line");
    assert.equal(driverUnit.lines.length, statusLines.length + 150);
    assert.equal(driverUnit.truncated, false);
    assert.equal(migrateUnit.unit, `ds-prod-${sha12}-migrate`, "a step unit reads as before, unfiltered");
    assert.equal(
      log("journalctl"),
      `-u ds-prod-${sha12}-driver -t release-driver -n 400 -o short-iso -q --no-pager\n` +
        `-u ds-prod-${sha12}-migrate -n 400 -o short-iso -q --no-pager\n` +
        `-u ds-prod-${sha12}-api-secret -n 400 -o short-iso -q --no-pager\n` +
        `-u ds-prod-${sha12}-data-secret -n 400 -o short-iso -q --no-pager\n`,
    );
  });

  it("4067: release-journal refuses (exit 3) with no recipient certificate and on any box but the prod box", () => {
    journalBox();
    rmSync(recipient());
    const r = readRun(`release-journal ${SHA}`);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /the read-result recipient certificate is not installed/);
    setRole("data");
    assert.equal(readRun(`release-journal ${SHA}`).status, 3);
    assert.equal(log("journalctl"), "");
  });

  // --- 4144: the prod boxes' host state, key-free --------------------------------------
  // Both halves run the same probe: ds-api-prod's locally under `root`, ds-data-prod's
  // through the hop under `dataRoot()`. The stubs tell the boxes apart by the basename
  // of DS_ENTRYPOINT_ROOT (`root` / `data-root`).
  const PG_VOLUME = () => join(dataRoot(), "var/lib/docker/volumes/ds-data-prod_pgdata/_data");
  const hostBox = ({
    names = { root: "ds-api-prod-host", "data-root": "ds-data-prod-host" },
    hosts = { root: true, "data-root": true },
    resolves = { root: ["s3.twcstorage.ru", "ds-api-prod-host"], "data-root": ["s3.twcstorage.ru", "ds-data-prod-host"] },
    upstream = { root: "Global: 1.1.1.1 8.8.8.8\nLink 2 (eth0): 1.1.1.1\n", "data-root": "Global: 1.1.1.1\n" },
    archiver = "42|0|2026-11-17T18:59:01Z||",
  } = {}) => {
    readBoxes();
    const box = 'box=$(basename "$DS_ENTRYPOINT_ROOT")';
    for (const [b, r] of [["root", root], ["data-root", dataRoot()]]) {
      mkdirSync(join(r, "proc"), { recursive: true });
      writeFileSync(join(r, "proc/uptime"), "12345.67 99999.00\n");
      writeFileSync(join(r, "etc/resolv.conf"), "# managed\nnameserver 127.0.0.53\nnameserver not-an-ip\noptions edns0\n");
      writeFileSync(
        join(r, "etc/hosts"),
        `127.0.0.1 localhost\n${hosts[b] ? `127.0.1.1 ${names[b]} ${names[b].split(".")[0]}\n` : ""}`,
      );
      writeFileSync(join(dir, `hostname.${b}`), `${names[b]}\n`);
      writeFileSync(join(dir, `resolves.${b}`), resolves[b].map((n) => `${n}\n`).join(""));
      if (upstream[b] !== null) writeFileSync(join(dir, `resolvectl.${b}`), upstream[b]);
    }
    mkdirSync(PG_VOLUME(), { recursive: true });
    const stub = (name, lines) => {
      writeFileSync(join(stubs, name), ["#!/usr/bin/env bash", `echo "$*" >> "$STUB_DIR/${name}.log"`, box, ...lines].join("\n") + "\n");
      chmodSync(join(stubs, name), 0o755);
    };
    stub("hostname", ['[[ $# -eq 0 ]] || exit 2', 'cat "$STUB_DIR/hostname.$box"']);
    stub("getent", ['[[ $1 == hosts && $# -eq 2 ]] || exit 2', 'grep -qxF -- "$2" "$STUB_DIR/resolves.$box" || exit 2', 'echo "10.0.0.1 $2"']);
    stub("resolvectl", ['[[ $* == dns ]] || exit 2', '[[ -f $STUB_DIR/resolvectl.$box ]] || exit 1', 'cat "$STUB_DIR/resolvectl.$box"']);
    stub("docker", [
      `[[ $box == data-root ]] || exit 9`,
      'case " $* " in',
      `  *" volume inspect "*) echo "${PG_VOLUME()}" ;;`,
      `  *" psql "*) ${archiver === null ? "exit 1" : `echo '${archiver}'`} ;;`,
      '  *" pgbackrest version "*) echo "pgBackRest 2.60.0" ;;',
      // #4287: the repo2 tunnel container's address (ds-recovery offsite-via), if running.
      '  " inspect --format "*) [[ -f $STUB_DIR/tunnel-ip ]] || exit 1; cat "$STUB_DIR/tunnel-ip" ;;',
      "  *) exit 7 ;;",
      "esac",
    ]);
    // #4280: curl as it answers each offsite host — "<exit> <-w output>" in curl.<host>.
    stub("curl", [
      `[[ $box == data-root ]] || exit 9`,
      'host=${*: -1}; host=${host#https://}; host=${host%/}',
      'read -r rc out < "$STUB_DIR/curl.$host" || { rc=7 out="000 0.000000 0.000000"; }',
      'printf "%s" "$out"',
      'exit "$rc"',
    ]);
  };
  const curlAnswers = (answers) => {
    for (const [host, reply] of Object.entries(answers)) writeFileSync(join(dir, `curl.${host}`), `${reply}\n`);
  };
  const KEYS = (o) => Object.keys(o).sort();
  // The closed list: every object of the answer carries exactly HOST_STATE_FIELDS' keys.
  const closed = (answer) => {
    assert.deepEqual(KEYS(answer), [...HOST_STATE_FIELDS.answer].sort());
    for (const role of ["api", "data"]) {
      const b = answer[role];
      if (b.reachable === false) {
        assert.deepEqual(KEYS(b), [...HOST_STATE_FIELDS.unreachable].sort());
        continue;
      }
      assert.deepEqual(KEYS(b), [...HOST_STATE_FIELDS.box[role]].sort(), role);
      for (const [field, value] of Object.entries(b)) {
        if (field === "role" || field === "takenAt") continue;
        if (field === "offsite" && Array.isArray(value)) {
          for (const repo of value) assert.deepEqual(KEYS(repo), [...HOST_STATE_FIELDS.offsiteRepo].sort());
          continue;
        }
        if ("error" in value) {
          assert.deepEqual(KEYS(value), ["error"], `${role}.${field}`);
          continue;
        }
        if (field === "disk") {
          assert.deepEqual(KEYS(value), [...HOST_STATE_FIELDS.disk[role]].sort());
          for (const v of Object.values(value))
            if (!("error" in v)) assert.deepEqual(KEYS(v), [...HOST_STATE_FIELDS.volume].sort());
          continue;
        }
        assert.deepEqual(KEYS(value), [...HOST_STATE_FIELDS[field]].sort(), `${role}.${field}`);
      }
    }
  };

  it("4144: host-state answers both boxes' resolver, self-hostname, disk and uptime, and the data box's archiver and pgBackRest, encrypted", () => {
    hostBox();
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "", "status lines only: the host state leaves encrypted");
    assert.doesNotMatch(r.stdout.toString("latin1"), /ds-data-prod-host|pgBackRest/);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.equal(answer.verb, "host-state");
    const { api, data } = answer;
    assert.equal(api.role, "api");
    assert.equal(data.role, "data");
    assert.deepEqual(api.uptime, { seconds: 12345 });
    assert.deepEqual(api.resolver, {
      nameservers: ["127.0.0.53"],
      upstream: ["1.1.1.1", "8.8.8.8"],
      probeName: "s3.twcstorage.ru",
      probeResolves: true,
    });
    assert.deepEqual(data.resolver.upstream, ["1.1.1.1"]);
    assert.deepEqual(api.selfHostname, { hostname: "ds-api-prod-host", getentResolves: true, inEtcHosts: true });
    assert.deepEqual(data.selfHostname, { hostname: "ds-data-prod-host", getentResolves: true, inEtcHosts: true });
    for (const v of [api.disk.root, data.disk.root, data.disk.postgresData]) {
      for (const k of ["bytesTotal", "bytesUsed", "bytesFree", "inodesTotal", "inodesUsed", "inodesFree"])
        assert.ok(Number.isSafeInteger(v[k]) && v[k] >= 0, k);
      assert.ok(v.bytesTotal > 0);
      assert.match(v.mount, /^\//);
    }
    assert.deepEqual(data.archiver, {
      archivedCount: 42,
      failedCount: 0,
      lastArchivedTime: "2026-11-17T18:59:01Z",
      lastFailedTime: null,
      lastFailedWal: null,
    });
    assert.deepEqual(data.pgbackrest, { version: "pgBackRest 2.60.0" });
    assert.equal(log("ds-release"), "", "no release check: it answers during a release");
    assert.equal(log("ssh").trim().split("\n").at(-1).split(" ").at(-1), "read-host-state");
    assert.match(log("docker"), /^volume inspect --format \{\{\.Mountpoint\}\} ds-data-prod_pgdata$/m);
    assert.match(log("docker"), /^compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U ds -d ds_prod -c SELECT .* FROM pg_stat_archiver$/m);
    assert.match(log("docker"), /^compose exec -T postgres pgbackrest version$/m);
    assert.deepEqual(data.offsite, [], "no offsite endpoint set: no probe");
    assert.equal(log("curl"), "");
  });

  // --- 4280: each offsite repo's reachability from ds-data-prod ------------------------
  const offsiteBox = () => {
    hostBox();
    writeFileSync(
      join(dataRoot(), "etc/ds-platform/data.env"),
      "PGBACKREST_REPO2_S3_KEY=planted-key-4280\nPGBACKREST_REPO2_S3_ENDPOINT=https://e2.example.test\n" +
        "PGBACKREST_REPO2_S3_KEY_SECRET=planted-secret-4280\nPGBACKREST_REPO3_S3_KEY_SECRET=planted-secret3-4280\n",
    );
    const conf = join(dataRoot(), "home/deploy/ds-platform/infra/deploy/compose/data-prod/pgbackrest");
    mkdirSync(conf, { recursive: true });
    writeFileSync(join(conf, "pgbackrest.conf"), "#repo3: repo3-type=s3\n#repo3: repo3-s3-endpoint=s3.onidel.test\n");
  };

  it("4280: host-state answers one line per offsite repo, from data.env's endpoint or the committed one, and never a data.env value", () => {
    offsiteBox();
    curlAnswers({ "e2.example.test": "0 403 0.051 0.123", "s3.onidel.test": "35 000 0.040 0.000000" });
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.deepEqual(answer.data.offsite, [
      { repo: 2, host: "e2.example.test", state: "reachable", http: 403 },
      { repo: 3, host: "s3.onidel.test", state: "tls-fail", http: null },
    ]);
    assert.deepEqual(hostStateLines(answer).filter((l) => l.startsWith("offsite")), [
      "offsite repo2 e2.example.test: reachable http=403",
      "offsite repo3 s3.onidel.test: tls-fail http=-",
    ]);
    const everything = JSON.stringify(answer) + r.stdout.toString("latin1") + r.stderr + log("curl") + log("ssh");
    assert.doesNotMatch(everything, /planted-/);
    // anonymous: no curlrc, no netrc, no user, no header; capped at 8 s
    for (const line of log("curl").trim().split("\n")) {
      assert.match(line, /^-q -s -o \/dev\/null --max-time 8 --proto =https -w .* https:\/\/[a-z0-9.]+\/$/);
      assert.doesNotMatch(line, /(^| )(-u|--user|-H|--header|-n|--netrc|-K|--config)( |$)/);
    }
  });

  it("4280: host-state answers an endpoint it cannot parse as host[:port] by a fixed entry — the repo is never dropped, the value never echoed", () => {
    offsiteBox();
    writeFileSync(
      join(dataRoot(), "etc/ds-platform/data.env"),
      "PGBACKREST_REPO2_S3_ENDPOINT=http://e2.example.test/planted-path\nPGBACKREST_REPO3_S3_ENDPOINT=s3.onidel.test # planted-comment\n",
    );
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.deepEqual(answer.data.offsite, [
      { repo: 2, host: null, state: "endpoint-unparsed", http: null },
      { repo: 3, host: null, state: "endpoint-unparsed", http: null },
    ]);
    assert.deepEqual(hostStateLines(answer).filter((l) => l.startsWith("offsite")), [
      "offsite repo2: endpoint-unparsed (not an https host[:port])",
      "offsite repo3: endpoint-unparsed (not an https host[:port])",
    ]);
    assert.equal(log("curl"), "", "no probe of an unparsed endpoint");
    assert.doesNotMatch(JSON.stringify(answer) + r.stdout.toString("latin1") + r.stderr, /planted-|example\.test|onidel/);
  });

  for (const [what, reply, state, http] of [
    ["refused TCP", "7 000 0.000000 0.000000", "tcp-refused", null],
    ["a TCP timeout", "28 000 0.000000 0.000000", "timeout", null],
    ["a TLS handshake timeout", "28 000 0.050000 0.000000", "timeout", null],
    ["an unresolved name", "6 000 0.000000 0.000000", "dns-fail", null],
    ["a failed TLS handshake", "35 000 0.050000 0.000000", "tls-fail", null],
    ["an HTTP answer", "0 200 0.050000 0.120000", "reachable", 200],
    ["an HTTP error status", "22 404 0.050000 0.120000", "reachable", 404],
  ])
    it(`4280: host-state classifies ${what} as ${state}`, () => {
      offsiteBox();
      curlAnswers({ "e2.example.test": reply });
      const answer = decrypt(readRun("host-state").stdout);
      assert.deepEqual(answer.data.offsite[0], { repo: 2, host: "e2.example.test", state, http });
    });

  // --- 4287: repo2's IDrive endpoint is probed through the repo2 tunnel, as pgBackRest reaches it
  const IDRIVE = "s3.ap-southeast-2.idrivee2.com";
  const tunnelBox = () => {
    offsiteBox();
    writeFileSync(join(dataRoot(), "etc/ds-platform/data.env"), `PGBACKREST_REPO2_S3_ENDPOINT=${IDRIVE}\n`);
    const lib = join(dataRoot(), "usr/local/lib/ds-platform");
    mkdirSync(lib, { recursive: true });
    copyFileSync(resolve(here, "../../infra/deploy/bin/ds-recovery"), join(lib, "ds-recovery"));
    chmodSync(join(lib, "ds-recovery"), 0o755);
  };

  it("4287: host-state probes repo2's IDrive endpoint through the running tunnel, keeping the name for TLS", () => {
    tunnelBox();
    writeFileSync(join(dir, "tunnel-ip"), "172.30.0.5\n");
    curlAnswers({ [IDRIVE]: "0 403 0.051 0.123" });
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.deepEqual(answer.data.offsite[0], { repo: 2, host: IDRIVE, state: "reachable", http: 403 });
    const probes = log("curl").trim().split("\n").filter((l) => l.endsWith(`https://${IDRIVE}/`));
    assert.equal(probes.length, 1, log("curl"));
    assert.match(probes[0], new RegExp(` --connect-to ${IDRIVE.replaceAll(".", "\\.")}:443:172\\.30\\.0\\.5:443 `));
    assert.match(
      log("docker"),
      /^inspect --format .*"ds-data-prod_repo2-tunnel".* ds-data-prod-repo2-tunnel-1$/m,
      "the tunnel's address on its compose network",
    );
  });

  it("4287: host-state answers tunnel-down for repo2 while its tunnel is not running — no direct probe", () => {
    tunnelBox();
    curlAnswers({ "s3.onidel.test": "0 403 0.051 0.123" });
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.deepEqual(answer.data.offsite, [
      { repo: 2, host: IDRIVE, state: "tunnel-down", http: null },
      { repo: 3, host: "s3.onidel.test", state: "reachable", http: 403 },
    ]);
    const curls = log("curl").trim().split("\n");
    assert.deepEqual(curls.filter((l) => l.includes(IDRIVE)), [], "never past the tunnel to IDrive's own address");
    assert.deepEqual(curls.filter((l) => l.includes("--connect-to")), [], "no tunnel route for a tunnel that is down");
    assert.equal(curls.filter((l) => l.endsWith("https://s3.onidel.test/")).length, 1, "repo3 is still probed, directly");
    assert.deepEqual(hostStateLines(answer).filter((l) => l.startsWith("offsite repo2")), [
      `offsite repo2 ${IDRIVE}: tunnel-down http=-`,
    ]);
  });

  it("4287: host-state probes any other repo2 endpoint directly, as pgBackRest then reaches it", () => {
    offsiteBox();
    const lib = join(dataRoot(), "usr/local/lib/ds-platform");
    mkdirSync(lib, { recursive: true });
    copyFileSync(resolve(here, "../../infra/deploy/bin/ds-recovery"), join(lib, "ds-recovery"));
    chmodSync(join(lib, "ds-recovery"), 0o755);
    writeFileSync(join(dir, "tunnel-ip"), "172.30.0.5\n");
    curlAnswers({ "e2.example.test": "0 403 0.051 0.123" });
    const answer = decrypt(readRun("host-state").stdout);
    assert.deepEqual(answer.data.offsite[0], { repo: 2, host: "e2.example.test", state: "reachable", http: 403 });
    assert.doesNotMatch(log("curl"), /--connect-to/);
  });

  it("4144: host-state reports a dead resolver as measured values, never an aborted answer", () => {
    hostBox({ resolves: { root: [], "data-root": [] }, upstream: { root: "Global: 1.1.1.1\n", "data-root": null } });
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const { api, data } = decrypt(r.stdout);
    assert.equal(api.resolver.probeResolves, false);
    assert.equal(data.resolver.probeResolves, false);
    assert.deepEqual(data.resolver.upstream, { error: "resolvectl failed" });
    assert.equal(api.selfHostname.getentResolves, false);
    assert.deepEqual(data.pgbackrest, { version: "pgBackRest 2.60.0" }, "the other probes still answer");
  });

  it("4144: host-state shows a self-hostname missing from /etc/hosts and getent; a failed probe gives its own error", () => {
    hostBox({
      names: { root: "ds-api-prod-host", "data-root": "8529185-kw435155.twc1.net" },
      hosts: { root: true, "data-root": false },
      resolves: { root: ["s3.twcstorage.ru", "ds-api-prod-host"], "data-root": ["s3.twcstorage.ru"] },
      archiver: null,
    });
    const r = readRun("host-state");
    assert.equal(r.status, 0, r.stderr);
    const answer = decrypt(r.stdout);
    closed(answer);
    assert.deepEqual(answer.data.selfHostname, {
      hostname: "8529185-kw435155.twc1.net",
      getentResolves: false,
      inEtcHosts: false,
    });
    assert.deepEqual(answer.data.archiver, { error: "pg_stat_archiver read failed" });
    assert.deepEqual(answer.data.pgbackrest, { version: "pgBackRest 2.60.0" });
    assert.deepEqual(answer.api.selfHostname, { hostname: "ds-api-prod-host", getentResolves: true, inEtcHosts: true });
  });

  for (const [what, body, reason] of [
    ["an unreachable data box", 'echo "ssh: connect to host: secret detail" >&2\nexit 255', "ds-data-prod is unreachable"],
    ["a hop that times out", "exit 124", "the read timed out"],
    ["a data box that predates the verb", 'echo "ds-deploy-entrypoint: rejected: unknown command" >&2\nexit 2', "ds-data-prod does not serve read-host-state (the next release installs it)"],
  ]) {
    it(`4144: host-state with ${what} answers the api half and a fixed reason for the data half`, () => {
      hostBox();
      writeFileSync(join(stubs, "ssh"), `#!/usr/bin/env bash\n${body}\n`);
      const r = readRun("host-state");
      assert.equal(r.status, 0, r.stderr);
      const answer = decrypt(r.stdout);
      closed(answer);
      assert.deepEqual(answer.data, { reachable: false, reason });
      assert.equal(answer.api.selfHostname.hostname, "ds-api-prod-host");
      assert.doesNotMatch(JSON.stringify(answer), /secret detail/);
    });
  }

  it("4144: host-state rejects a data half that carries an unlisted field — nothing of it leaves", () => {
    hostBox();
    const r0 = readRun("host-state");
    const good = decrypt(r0.stdout).data;
    for (const bad of [
      { ...good, env: "DS_SECRET=x" },
      { ...good, archiver: { ...good.archiver, password: "DS_SECRET=x" } },
      { ...good, resolver: { ...good.resolver, nameservers: ["DS_SECRET=x"] } },
      { ...good, selfHostname: { ...good.selfHostname, hostname: "DS_SECRET=x" } },
      { ...good, uptime: { error: "DS_SECRET=x".repeat(40) } },
      // #4287: a null host belongs to an unparsed endpoint only, and an unparsed one has none.
      { ...good, offsite: [{ repo: 2, host: null, state: "reachable", http: 200 }] },
      { ...good, offsite: [{ repo: 2, host: null, state: "tunnel-down", http: null }] },
      { ...good, offsite: [{ repo: 2, host: "DS_SECRET.example.test", state: "endpoint-unparsed", http: null }] },
    ]) {
      writeFileSync(join(dir, "bad.json"), JSON.stringify(bad));
      writeFileSync(join(stubs, "ssh"), `#!/usr/bin/env bash\ncat "${join(dir, "bad.json")}"\n`);
      const r = readRun("host-state");
      assert.equal(r.status, 0, r.stderr);
      const answer = decrypt(r.stdout);
      closed(answer);
      assert.deepEqual(answer.data, { reachable: false, reason: "the data box answer is not a host-state answer" });
      assert.doesNotMatch(JSON.stringify(answer), /DS_SECRET/);
    }
  });

  it("4144: host-state refuses (exit 3) with no recipient certificate; read-host-state is the data box's verb only", () => {
    hostBox();
    rmSync(recipient());
    const r = readRun("host-state");
    assert.equal(r.status, 3);
    assert.match(r.stderr, /the read-result recipient certificate is not installed/);
    assert.equal(log("ssh"), "");
    assert.equal(readRun("read-host-state", { bin: ENTRYPOINT }).status, 3, "not on the prod box");
    assert.equal(readRun("read-host-state now", { bin: ENTRYPOINT }).status, 2);
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

  it("3648: the data box's rehearse-restore takes the archive like rehearse and rejects a bad arity", () => {
    rehearseBoxes();
    const data = (command, input) =>
      spawnSync("bash", [ENTRYPOINT], {
        env: { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, STUB_DIR: dir, DS_ENTRYPOINT_ROOT: dataRoot(), SSH_ORIGINAL_COMMAND: command, ...rehearseEnv() },
        input,
      });
    const big = data(`rehearse-restore ${SHA}`, Buffer.alloc(16 * 1024 * 1024 + 1));
    assert.equal(big.status, 2, String(big.stderr));
    assert.match(String(big.stderr), /the migration archive exceeds 16777216 bytes/);
    for (const command of ["rehearse-restore", `rehearse-restore ${SHA} --apply`, `rehearse-restore ${SHA.slice(0, 12)}`]) {
      assert.equal(data(command, Buffer.alloc(0)).status, 2, command);
    }
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
    ["a table outside the emptiness list", "observe table-empty", JSON.stringify({ table: "pg_authid" }), /bad parameters for table-empty/],
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
        "CREATE TABLE experts (id uuid PRIMARY KEY)",
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
        // 0 and 1 both read <10 above; the emptiness read tells them apart (#4176).
        ["table-empty", { table: "experts" }, { empty: true }],
        ["table-empty", { table: "consent_records" }, { empty: false }],
        ["table-empty", { table: "users" }, { empty: false }],
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
        for (const kind of Object.values(result)) assert.ok(["count", "distinct", "flag"].includes(kind), `${name}: ${kind}`);
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

  it("3647: buckets under 10 fold into one suppressed bucket; counts under 10 read <10; flags read true/false; anything undeclared is refused", () => {
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
      // A flag answers exactly true or false and is never folded (#4176).
      [{ e: "flag" }, [{ e: true }], { e: true }],
      [{ e: "flag" }, [{ e: false }], { e: false }],
      [{ e: "flag" }, [{ e: 0 }], null],
      [{ e: "flag" }, [{ e: 1 }], null],
      [{ e: "flag" }, [{ e: "true" }], null],
      [{ e: "flag" }, [{ e: null }], null],
      [{ e: "flag" }, [{ e: true, n: 3 }], null],
      [{ e: "flag" }, [{ e: true }, { e: false }], null],
      [{ e: "flag" }, [], null],
      [{ e: "nope" }, [{ e: 12 }], null],
    ];
    const got = readObservePy(`print(json.dumps([m.shape(r, rows) for r, rows, _ in json.loads(${JSON.stringify(JSON.stringify(cases))})]))`);
    assert.deepEqual(got, cases.map(([, , want]) => want));
  });
});
