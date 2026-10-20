// Bash-level tests of infra/deploy/bin/ds-deploy-entrypoint, the forced command of
// every CI key (Issue #2984; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §4, §8 step (c)). The script runs for real against a fixture root
// (DS_ENTRYPOINT_ROOT) with `sudo` and `logger` stubbed on PATH, a fake ds-release
// and a fake release driver, so the allowlist, the argument checks, the log lines
// and the report upload are exercised end to end.
// Needs bash, tar and find — CI Linux; skipped where they are absent.
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

const here = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint");
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
const SHA = "0123456789abcdef0123456789abcdef01234567";

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v tar && command -v find && command -v install"], {
    stdio: "ignore",
  }).status === 0;
const SKIP = !toolsPresent && "needs Linux bash, tar, find and install";

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
  for (const { name, type = "0", link = "", body = "" } of entries) {
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
    stub(join(root, "usr/local/bin/ds-release"), 'echo "ds-release-called $*"');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (command, { input } = {}) => {
    const env = {
      ...process.env,
      PATH: `${stubs}${delimiter}${process.env.PATH}`,
      STUB_DIR: dir,
      DS_ENTRYPOINT_ROOT: root,
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
  const installDriver = () => {
    const driver = join(root, "usr/local/lib/ds-platform/release-driver");
    mkdirSync(dirname(driver), { recursive: true });
    writeFileSync(driver, '#!/usr/bin/env bash\necho "driver-called $*"\n');
    chmodSync(driver, 0o755);
  };
  const setRole = (role) => writeFileSync(join(root, "etc/ds-platform/box-role"), `${role}\n`);

  it("status dispatches to sudo ds-release status with the validated args", () => {
    const r = run(`status stage-pr-42 ${SHA}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-called status stage-pr-42 ${SHA}\n`);
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
    assert.match(log("sudo"), /--no-same-owner/);
  });

  const unsafe = [
    ["a .. path", [{ name: "../escape", body: "x" }]],
    ["a nested .. path", [{ name: "a/../../escape", body: "x" }]],
    ["an absolute path", [{ name: "/tmp/escape", body: "x" }]],
    ["a symlink", [{ name: "link", type: "2", link: "/etc/passwd" }]],
    ["a hard link", [{ name: "f", body: "x" }, { name: "hard", type: "1", link: "f" }]],
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

  it("upload-report refuses a stream that is not a tar archive", () => {
    setRole("stage");
    const r = run(`upload-report ${SHA}`, { input: Buffer.from("not a tar stream at all\n") });
    assert.equal(r.status, 3);
    assert.doesNotMatch(log("sudo"), /tar -xf/);
  });
});
