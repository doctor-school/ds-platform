// Bash-level tests of infra/deploy/bin/release-driver, the box-side stage release
// driver (Issue #2985; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §3 item 2, §5). The script runs for real against a fixture root (DS_DRIVER_ROOT)
// with `sudo`, `systemctl`, `systemd-run` and `curl` stubbed on PATH and a stub
// ds-release / node inside the root, so its env check, manifest check, lease, the
// started / attached / already-succeeded decisions, the unit state and the unit's
// own run are exercised end to end.
// Needs bash, python3, flock, stat and tar — CI Linux; skipped on Windows and where absent.
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
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  IMAGE_REGISTRY,
  RECORDED_IMAGE_NAMES,
  RELEASE_MANIFEST_REFS,
  validateImageManifest,
} from "./lib/registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(here, "../../infra/deploy/bin/release-driver");
const DS_RELEASE = resolve(here, "../../infra/deploy/bin/ds-release");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "b".repeat(40);
const UNIT = `ds-stage-main-${SHA.slice(0, 12)}-driver`;

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v python3 && command -v flock && command -v stat && command -v tar"], {
    stdio: "ignore",
  }).status === 0;
const SKIP = !toolsPresent && "needs Linux bash, python3, flock, stat and tar";

const pick = (file, name) => {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  assert.ok(line, `${file} defines ${name}`);
  return line;
};
const value = (file, name) => pick(file, name).slice(name.length + 2, -1);

test("2985: the driver checks env and sha with ds-release's own regexes", () => {
  for (const name of ["ENV_RE", "SHA_RE", "USER_RE"]) {
    assert.equal(pick(DRIVER, name), pick(DS_RELEASE, name), `${name} is one definition`);
  }
});

test("2985: the driver's image set and manifest refs are the registry's", () => {
  assert.deepEqual(value(DRIVER, "IMAGE_NAMES").split(" "), [...RECORDED_IMAGE_NAMES]);
  const hotfix = RELEASE_MANIFEST_REFS.find((ref) => ref instanceof RegExp);
  assert.equal(value(DRIVER, "MANIFEST_REF_RE"), `^(main|${hotfix.source.slice(1, -1).replaceAll("\\/", "/")})$`);
  assert.equal(
    value(DRIVER, "IMAGE_REF_RE"),
    `^${IMAGE_REGISTRY.replace(/\./g, "\\.")}/([a-z0-9][a-z0-9-]*)@sha256:[0-9a-f]{64}$`,
  );
});

const digestOf = (hex) => `sha256:${hex.repeat(64)}`;
const IMAGES = Object.fromEntries(
  RECORDED_IMAGE_NAMES.map((name, i) => [name, `${IMAGE_REGISTRY}/${name}@${digestOf("abcde"[i])}`]),
);
const manifest = (over = {}) => JSON.stringify({ sha: SHA, ref: "main", images: { ...IMAGES }, ...over });

// Each sample is judged by the driver AND by slot.mjs's validator; they must agree.
const SAMPLES = {
  good: manifest(),
  hotfix: manifest({ ref: "hotfix/12-fix-x" }),
  "wrong sha": manifest({ sha: OTHER }),
  "non-sha256 digest": manifest({ images: { ...IMAGES, api: `${IMAGE_REGISTRY}/api@sha512:${"a".repeat(64)}` } }),
  "short digest": manifest({ images: { ...IMAGES, api: `${IMAGE_REGISTRY}/api@sha256:${"a".repeat(63)}` } }),
  "unknown image": manifest({ images: { ...IMAGES, worker: `${IMAGE_REGISTRY}/worker@${digestOf("f")}` } }),
  "missing image": manifest({ images: { api: IMAGES.api } }),
  "another image's digest": manifest({ images: { ...IMAGES, api: IMAGES.portal } }),
  "pr namespace": manifest({ ref: "pr/7" }),
  "trailing newline in a digest": manifest({ images: { ...IMAGES, api: `${IMAGES.api}\n` } }),
  "extra key": manifest({ run: 1 }),
  "not json": "{",
};

describe("2985: release-driver", { skip: SKIP }, () => {
  let dir, root, stubs, units, home;

  const stub = (path, body) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-driver-"));
    root = join(dir, "root");
    stubs = join(dir, "stubs");
    units = join(dir, "units");
    home = join(dir, "home");
    for (const d of [stubs, units, home, join(root, "etc/ds-platform")]) mkdirSync(d, { recursive: true });
    // sudo: record, then run as the caller; `install -o/-g` would need root.
    stub(
      join(stubs, "sudo"),
      [
        'echo "$*" >> "$STUB_DIR/sudo.log"',
        "args=(); skip=0",
        'for a in "$@"; do',
        "  if [[ $skip == 1 ]]; then skip=0; continue; fi",
        '  case $a in -o|-g) [[ $1 == install ]] && { skip=1; continue; } ;; esac',
        '  args+=("$a")',
        "done",
        'exec "${args[@]}"',
      ].join("\n"),
    );
    // systemctl: `show` answers from $STUB_DIR/units/<unit>.props; stop / reset-failed
    // forget the unit, as systemd forgets a reset transient unit.
    stub(
      join(stubs, "systemctl"),
      [
        'case $1 in',
        '  show) unit=${!#}; unit=${unit%.service}',
        '    if [[ -f $STUB_DIR/units/$unit.props ]]; then cat "$STUB_DIR/units/$unit.props"',
        "    else printf 'LoadState=not-found\\nActiveState=inactive\\nSubState=dead\\nExecMainCode=0\\nExecMainStatus=0\\n'; fi ;;",
        '  stop|reset-failed) echo "$1 $2" >> "$STUB_DIR/systemctl.log"; rm -f "$STUB_DIR/units/${2%.service}.props" ;;',
        "esac",
      ].join("\n"),
    );
    // systemd-run: record the argv, and the unit is running from now on.
    stub(
      join(stubs, "systemd-run"),
      [
        'printf "%s\\n" "$@" > "$STUB_DIR/systemd-run.args"',
        "for a; do [[ $a == --unit=* ]] && unit=${a#--unit=}; done",
        "printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nExecMainCode=0\\nExecMainStatus=0\\n' > \"$STUB_DIR/units/$unit.props\"",
      ].join("\n"),
    );
    // ds-release: `lease` refuses when $STUB_DIR/lease names another SHA; `status`
    // prints $STUB_DIR/status.json or a null record.
    stub(
      join(root, "usr/local/bin/ds-release"),
      [
        'echo "$*" >> "$STUB_DIR/ds-release.log"',
        'case $1 in',
        '  lease) if [[ -f $STUB_DIR/lease ]]; then',
        '      echo "ds-release: refused: env $2 is leased by release $(cat "$STUB_DIR/lease"), which has not finished" >&2; exit 3',
        '    fi; echo "ds-release: env $2 is free" ;;',
        '  status) if [[ -f $STUB_DIR/status.json ]]; then cat "$STUB_DIR/status.json"; else echo \'{"release":null,"unitAlive":null}\'; fi ;;',
        "esac",
      ].join("\n"),
    );
    setRole("stage");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const setRole = (role) => writeFileSync(join(root, "etc/ds-platform/box-role"), `${role}\n`);
  const setUnit = (props) =>
    writeFileSync(
      join(units, `${UNIT}.props`),
      Object.entries(props)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  const setRecord = (state) =>
    writeFileSync(join(dir, "status.json"), JSON.stringify({ release: { sha: SHA, state }, unitAlive: null }));
  const log = (name) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };

  const run = (args, { input = manifest(), env: extra = {} } = {}) => {
    const r = spawnSync("bash", [DRIVER, ...args], {
      env: {
        ...process.env,
        PATH: `${stubs}${delimiter}${process.env.PATH}`,
        HOME: home,
        STUB_DIR: dir,
        DS_DRIVER_ROOT: root,
        DS_DRIVER_LOCK_DIR: join(dir, "lock"),
        ...extra,
      },
      input,
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  const notStarted = () => assert.equal(log("systemd-run.args"), "", "no unit was started");

  it("starts the converge unit for a valid manifest, one status line and nothing else", () => {
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-driver: started ${UNIT}\n`);
    assert.equal(r.stderr, "");
    const saved = join(root, "var/lib/ds-platform/release-driver", `${SHA}.json`);
    assert.equal(readFileSync(saved, "utf8"), manifest());
    assert.equal(statSync(saved).mode & 0o777, 0o600, "the manifest is saved root-only");
    assert.equal(statSync(dirname(saved)).mode & 0o777, 0o700);
    const argv = log("systemd-run.args").trim().split("\n");
    for (const want of [
      `--unit=${UNIT}`,
      "--remain-after-exit",
      "KillMode=mixed",
      `StandardInput=file:${saved}`,
      "StandardOutput=journal",
      "StandardError=journal",
    ]) {
      assert.ok(argv.includes(want), `systemd-run gets ${want}: ${argv.join(" ")}`);
    }
    assert.ok(argv.some((a) => /^--uid=[a-z_][a-z0-9_-]*$/.test(a)), "the unit runs as the calling user");
    assert.deepEqual(argv.slice(-4), ["/usr/local/lib/ds-platform/release-driver", "_run", "stage-main", SHA]);
    assert.match(log("ds-release.log"), new RegExp(`^lease stage-main ${SHA}$`, "m"));
  });

  it("attaches to a running unit without starting another", () => {
    setUnit({ LoadState: "loaded", ActiveState: "active", SubState: "running", ExecMainCode: 0, ExecMainStatus: 0 });
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-driver: attached ${UNIT}\n`);
    notStarted();
  });

  it("answers already-succeeded for a finished rc-0 unit whose release record closed succeeded", () => {
    setUnit({ LoadState: "loaded", ActiveState: "active", SubState: "exited", ExecMainCode: 1, ExecMainStatus: 0 });
    setRecord("succeeded");
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "ds-release-driver: already-succeeded\n");
    notStarted();
    assert.equal(log("systemctl.log"), "", "the finished unit is kept: its rc answers status");
  });

  for (const [what, props, record] of [
    ["a failed unit", { ActiveState: "failed", SubState: "failed", ExecMainCode: 1, ExecMainStatus: 1 }, "failed"],
    ["an rc-0 unit whose release is still open", { ActiveState: "active", SubState: "exited", ExecMainCode: 1, ExecMainStatus: 0 }, "running"],
  ]) {
    it(`resets ${what} of the same SHA and starts it again`, () => {
      setUnit({ LoadState: "loaded", ...props });
      setRecord(record);
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${UNIT}\n`);
      assert.equal(log("systemctl.log"), `stop ${UNIT}.service\nreset-failed ${UNIT}.service\n`);
    });
  }

  it("refuses while another SHA holds the env lease", () => {
    writeFileSync(join(dir, "lease"), OTHER.slice(0, 12));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, `ds-release-driver: refused: env stage-main is leased by release ${OTHER.slice(0, 12)}, which has not finished\n`);
    notStarted();
  });

  it("refuses a PR slot and any env the stage box does not serve", () => {
    let r = run(["stage-pr-7", SHA]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /PR slots stay operator-driven/);
    r = run(["prod", SHA]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /the stage box serves stage-main, not prod/);
    notStarted();
  });

  it("refuses on a prod box until the prod driver lands", () => {
    setRole("prod");
    const r = run(["prod", SHA]);
    assert.equal(r.status, 3);
    assert.equal(r.stderr, "ds-release-driver: refused: prod release driver lands with #2986\n");
    notStarted();
  });

  it("refuses on a box without a role", () => {
    rmSync(join(root, "etc/ds-platform/box-role"));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /no known role/);
  });

  it("rejects bad arguments as usage", () => {
    for (const args of [[], ["stage-main"], ["stage-main", "abc"], ["staging", SHA], ["stage-main", SHA, "x"]]) {
      const r = run(args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    }
    notStarted();
  });

  it("refuses an oversized manifest", () => {
    const r = run(["stage-main", SHA], { input: "x".repeat(65537) });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /exceeds 65536 bytes/);
  });

  for (const [what, text] of Object.entries(SAMPLES)) {
    it(`judges the ${what} manifest exactly as slot.mjs does`, () => {
      let accepted = true;
      try {
        const doc = JSON.parse(text);
        if (Object.keys(doc).sort().join(",") !== "images,ref,sha") throw new Error("keys");
        validateImageManifest(doc, { sha: SHA, acceptRefs: RELEASE_MANIFEST_REFS, consumer: "slot main" });
      } catch {
        accepted = false;
      }
      const r = run(["stage-main", SHA], { input: text });
      if (accepted) {
        assert.equal(r.status, 0, r.stderr);
      } else {
        assert.equal(r.status, 3, r.stdout);
        assert.match(r.stderr, /^ds-release-driver: refused: bad manifest: /);
        notStarted();
      }
    });
  }

  describe("unit-state", () => {
    const state = () => {
      const r = run(["unit-state", "stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    for (const [what, props, active, rc] of [
      ["no unit", null, "absent", null],
      ["an activating unit", { LoadState: "loaded", ActiveState: "activating", SubState: "start", ExecMainCode: 0, ExecMainStatus: 0 }, "activating", null],
      ["a running unit", { LoadState: "loaded", ActiveState: "active", SubState: "running", ExecMainCode: 0, ExecMainStatus: 0 }, "active", null],
      ["an rc-0 finished unit", { LoadState: "loaded", ActiveState: "active", SubState: "exited", ExecMainCode: 1, ExecMainStatus: 0 }, "inactive", 0],
      ["a failed unit", { LoadState: "loaded", ActiveState: "failed", SubState: "failed", ExecMainCode: 1, ExecMainStatus: 3 }, "failed", 3],
      ["a killed unit", { LoadState: "loaded", ActiveState: "failed", SubState: "failed", ExecMainCode: 2, ExecMainStatus: 9 }, "failed", 137],
      ["a loaded unit that never ran", { LoadState: "loaded", ActiveState: "inactive", SubState: "dead", ExecMainCode: 0, ExecMainStatus: 0 }, "absent", null],
    ]) {
      it(`reports ${what} as ${active}`, () => {
        if (props) setUnit(props);
        assert.deepEqual(state(), { unit: UNIT, active, rc });
      });
    }
  });

  describe("_run", () => {
    beforeEach(() => {
      // The codeload tarball: one top-level directory, as GitHub serves it.
      const src = join(dir, "src", `ds-platform-${SHA}`, "tools/staging");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "slot.mjs"), "// the tree\n");
      assert.equal(
        spawnSync("tar", ["czf", join(dir, "codeload.tar.gz"), "-C", join(dir, "src"), `ds-platform-${SHA}`]).status,
        0,
      );
      stub(
        join(stubs, "curl"),
        ['echo "$*" > "$STUB_DIR/curl.args"', 'while [[ $1 != -o ]]; do shift; done', 'cp "$STUB_DIR/codeload.tar.gz" "$2"'].join("\n"),
      );
      stub(
        join(root, "usr/local/bin/node"),
        [
          'printf "%s\\n" "$@" > "$STUB_DIR/node.args"',
          'cat "$1" > "$STUB_DIR/node.saw-tree" 2>/dev/null || true',
          'cat > "$STUB_DIR/node.stdin"',
          'exit "${NODE_RC:-0}"',
        ].join("\n"),
      );
    });

    it("downloads exactly the SHA and runs the local converge from its tree, manifest on stdin", () => {
      const r = run(["_run", "stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(log("curl.args"), new RegExp(`https://codeload\\.github\\.com/doctor-school/ds-platform/tar\\.gz/${SHA}`));
      const argv = log("node.args").trim().split("\n");
      assert.match(argv[0], /\/tree\/tools\/staging\/slot\.mjs$/);
      assert.deepEqual(argv.slice(1), ["up", "main", "--ref", SHA, "--local", "--images-file", "/dev/stdin"]);
      assert.equal(log("node.saw-tree"), "// the tree\n", "the tarball was extracted with its top directory stripped");
      assert.equal(log("node.stdin"), manifest());
      assert.deepEqual(readdirSync(home), [], "the work directory is removed");
    });

    it("exits with the converge's exit status", () => {
      const r = run(["_run", "stage-main", SHA], { env: { NODE_RC: "5" } });
      assert.equal(r.status, 5);
      assert.deepEqual(readdirSync(home), []);
    });

    it("converges stage-main only", () => {
      assert.equal(run(["_run", "stage-pr-7", SHA]).status, 2);
    });
  });
});
