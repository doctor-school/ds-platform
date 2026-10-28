// Bash-level tests of infra/deploy/bin/release-driver, the box-side stage release
// driver (Issue #2985; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §3 item 2, §5). The script runs for real against a fixture root (DS_DRIVER_ROOT)
// with `sudo`, `systemctl`, `systemd-run`, `curl` and `docker` stubbed on PATH and a stub
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  IMAGE_REGISTRY,
  LATER_RECORDED_IMAGE_NAMES,
  RECORDED_IMAGE_NAMES,
  REGISTRY_PULL_TOKEN_FILE,
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
  spawnSync(
    "bash",
    [
      "-c",
      "command -v python3 && command -v flock && command -v stat && command -v tar",
    ],
    {
      stdio: "ignore",
    },
  ).status === 0;
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
    assert.equal(
      pick(DRIVER, name),
      pick(DS_RELEASE, name),
      `${name} is one definition`,
    );
  }
});

// #3297: the lock directory and its checks are one definition in both scripts.
const fn = (file, name) => {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(`\n${name}() {\n`);
  assert.ok(start >= 0, `${file} defines ${name}()`);
  return text.slice(start, text.indexOf("\n}\n", start) + 3);
};

test("3297: the driver locks where ds-release locks: a root-owned dir for root, never /run/lock itself", () => {
  for (const name of [
    "default_lock_dir",
    "lock_dir_problem",
    "lock_file_problem",
  ]) {
    assert.equal(
      fn(DRIVER, name),
      fn(DS_RELEASE, name),
      `${name} is one definition`,
    );
  }
  const body = fn(DRIVER, "default_lock_dir");
  assert.match(body, /\$EUID -eq 0 \]\]; then printf '\/run\/ds-platform'/);
  assert.match(
    body,
    /\/run\/lock\/ds-platform-%s/,
    "a non-root caller locks in its own subdirectory",
  );
  assert.match(pick(DRIVER, "LOCK_DIR"), /\$\(default_lock_dir\)/);
  assert.match(pick(DS_RELEASE, "LOCK_DIR"), /\$\(default_lock_dir\)/);
});

test("2985: the driver's image set and manifest refs are the registry's", () => {
  assert.deepEqual(value(DRIVER, "IMAGE_NAMES").split(" "), [
    ...RECORDED_IMAGE_NAMES,
  ]);
  assert.deepEqual(value(DRIVER, "LATER_IMAGE_NAMES").split(" "), [
    ...LATER_RECORDED_IMAGE_NAMES,
  ]);
  assert.equal(value(DRIVER, "IMAGE_REGISTRY"), IMAGE_REGISTRY);
  assert.equal(
    pick(DRIVER, "REGISTRY_PULL_TOKEN"),
    `REGISTRY_PULL_TOKEN=$ROOT${REGISTRY_PULL_TOKEN_FILE}`,
  );
  const hotfix = RELEASE_MANIFEST_REFS.find((ref) => ref instanceof RegExp);
  assert.equal(
    value(DRIVER, "MANIFEST_REF_RE"),
    `^(main|${hotfix.source.slice(1, -1).replaceAll("\\/", "/")})$`,
  );
  assert.equal(
    value(DRIVER, "IMAGE_REF_RE"),
    `^${IMAGE_REGISTRY.replace(/\./g, "\\.")}/([a-z0-9][a-z0-9-]*)@sha256:[0-9a-f]{64}$`,
  );
});

const digestOf = (hex) => `sha256:${hex.repeat(64)}`;
const IMAGES = Object.fromEntries(
  RECORDED_IMAGE_NAMES.map((name, i) => [
    name,
    `${IMAGE_REGISTRY}/${name}@${digestOf("abcdef"[i])}`,
  ]),
);
const manifest = (over = {}) =>
  JSON.stringify({ sha: SHA, ref: "main", images: { ...IMAGES }, ...over });

// Each sample is judged by the driver AND by slot.mjs's validator; they must agree.
const SAMPLES = {
  good: manifest(),
  // #3171: a rollback target recorded before the sign-in host image.
  "pre-login": manifest({
    images: Object.fromEntries(
      Object.entries(IMAGES).filter(([name]) => name !== "login"),
    ),
  }),
  hotfix: manifest({ ref: "hotfix/12-fix-x" }),
  "wrong sha": manifest({ sha: OTHER }),
  "non-sha256 digest": manifest({
    images: {
      ...IMAGES,
      api: `${IMAGE_REGISTRY}/api@sha512:${"a".repeat(64)}`,
    },
  }),
  "short digest": manifest({
    images: {
      ...IMAGES,
      api: `${IMAGE_REGISTRY}/api@sha256:${"a".repeat(63)}`,
    },
  }),
  "missing image": manifest({ images: { api: IMAGES.api } }),
  "another image's digest": manifest({
    images: { ...IMAGES, api: IMAGES.portal },
  }),
  "pr namespace": manifest({ ref: "pr/7" }),
  "trailing newline in a digest": manifest({
    images: { ...IMAGES, api: `${IMAGES.api}\n` },
  }),
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
    for (const d of [stubs, units, home, join(root, "etc/ds-platform")])
      mkdirSync(d, { recursive: true });
    // sudo: record, then run as the caller; `install -o/-g` would need root.
    stub(
      join(stubs, "sudo"),
      [
        'echo "$*" >> "$STUB_DIR/sudo.log"',
        "args=(); skip=0",
        'for a in "$@"; do',
        "  if [[ $skip == 1 ]]; then skip=0; continue; fi",
        "  case $a in -o|-g) [[ $1 == install ]] && { skip=1; continue; } ;; esac",
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
        "case $1 in",
        "  show) unit=${!#}; unit=${unit%.service}",
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
        "case $1 in",
        "  lease) if [[ -f $STUB_DIR/lease ]]; then",
        '      echo "ds-release: refused: env $2 is leased by release $(cat "$STUB_DIR/lease"), which has not finished" >&2; exit 3',
        '    fi; echo "ds-release: env $2 is free" ;;',
        '  status) if [[ -f $STUB_DIR/status.json ]]; then cat "$STUB_DIR/status.json"; else echo \'{"release":null,"unitAlive":null}\'; fi ;;',
        // #2987: `check` refuses while $STUB_DIR/live-step names a running unit.
        "  check) if [[ -f $STUB_DIR/live-step ]]; then",
        '      echo "ds-release: refused: $(cat "$STUB_DIR/live-step").service is still running (sudo journalctl -fu x); wait for it to end" >&2; exit 3',
        '    fi; echo "ds-release: no step unit is running" ;;',
        "esac",
      ].join("\n"),
    );
    // curl: the GitHub compare answers from $STUB_DIR/compare.json (exit 22, as
    // `curl -f` on an HTTP error, when it is absent).
    stub(
      join(stubs, "curl"),
      [
        'echo "$*" >> "$STUB_DIR/curl.log"',
        // #3157: compare main...<sha> answers from compare.json, any other base (the
        // live prod SHA) from compare-live.json.
        // #2987: the Releases listing answers from releases.json.
        "case ${!#} in */compare/main...*) f=$STUB_DIR/compare.json ;; */releases*) f=$STUB_DIR/releases.json ;; *) f=$STUB_DIR/compare-live.json ;; esac",
        "[[ -f $f ]] || exit 22",
        'cat "$f"',
      ].join("\n"),
    );
    // docker: login reads the token on stdin; `manifest inspect --verbose <ref>`
    // answers from $STUB_DIR/registry/<repo:tag with / and : as _>.json.
    stub(
      join(stubs, "docker"),
      [
        'echo "$*" >> "$STUB_DIR/docker.log"',
        'echo "${DOCKER_CONFIG:-unset} $(stat -c %a "${DOCKER_CONFIG:-/nonexistent}" 2>/dev/null)" >> "$STUB_DIR/docker.config"',
        "case $1 in",
        '  login) cat > "$STUB_DIR/docker.login-stdin"; [[ -f $STUB_DIR/login-fails ]] && exit 1',
        '    echo "{}" > "$DOCKER_CONFIG/config.json"; exit 0 ;;',
        "  logout) exit 0 ;;",
        // #3157: the running api container's image, from $STUB_DIR/live-image.
        // #3354: the n-th inspect answers from live-image.<n> when that file exists.
        '  inspect) n=$(( $(cat "$STUB_DIR/inspect.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_DIR/inspect.count"',
        '    f=$STUB_DIR/live-image; [[ -f $f.$n ]] && f=$f.$n',
        '    [[ -f $f ]] || exit 1; cat "$f" ;;',
        "  manifest) ref=${!#}; f=$STUB_DIR/registry/${ref//[\\/:]/_}.json",
        '    [[ -f $f ]] || { echo "no such manifest" >&2; exit 1; }; cat "$f" ;;',
        "esac",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "etc/ds-platform/registry-pull-token"),
      "s3cr3t-pull-value\n",
    );
    setCompare("behind");
    mkdirSync(join(dir, "registry"));
    for (const name of RECORDED_IMAGE_NAMES)
      serve(name, IMAGES[name].split("@")[1]);
    setRole("stage");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const setCompare = (status) =>
    writeFileSync(
      join(dir, "compare.json"),
      JSON.stringify({ status, ahead_by: 0 }),
    );
  const serve = (name, digest, tag = SHA) =>
    writeFileSync(
      join(dir, "registry", `${IMAGE_REGISTRY}_${name}_${tag}.json`),
      JSON.stringify(
        {
          Ref: `${IMAGE_REGISTRY}/${name}:${tag}`,
          Descriptor: {
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            digest,
            size: 1,
          },
        },
        null,
        2,
      ),
    );
  const setRole = (role) =>
    writeFileSync(join(root, "etc/ds-platform/box-role"), `${role}\n`);
  const setUnit = (props, unit = UNIT) =>
    writeFileSync(
      join(units, `${unit}.props`),
      Object.entries(props)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  const setRecord = (state) =>
    writeFileSync(
      join(dir, "status.json"),
      JSON.stringify({ release: { sha: SHA, state }, unitAlive: null }),
    );
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

  const notStarted = () =>
    assert.equal(log("systemd-run.args"), "", "no unit was started");

  it("starts the converge unit for a valid manifest, one status line and nothing else", () => {
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-driver: started ${UNIT}\n`);
    assert.equal(r.stderr, "");
    const saved = join(
      root,
      "var/lib/ds-platform/release-driver",
      `${SHA}.json`,
    );
    assert.equal(readFileSync(saved, "utf8"), manifest());
    assert.equal(
      statSync(saved).mode & 0o777,
      0o600,
      "the manifest is saved root-only",
    );
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
      assert.ok(
        argv.includes(want),
        `systemd-run gets ${want}: ${argv.join(" ")}`,
      );
    }
    assert.ok(
      argv.some((a) => /^--uid=[a-z_][a-z0-9_-]*$/.test(a)),
      "the unit runs as the calling user",
    );
    assert.deepEqual(argv.slice(-4), [
      "/usr/local/lib/ds-platform/release-driver",
      "_run",
      "stage-main",
      SHA,
    ]);
    assert.match(
      log("ds-release.log"),
      new RegExp(`^lease stage-main ${SHA}$`, "m"),
    );
  });

  it("attaches to a running unit without starting another", () => {
    setUnit({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "running",
      ExecMainCode: 0,
      ExecMainStatus: 0,
    });
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-driver: attached ${UNIT}\n`);
    notStarted();
  });

  it("attaches to a running unit of the SHA before asking GitHub or the registry", () => {
    setUnit({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "running",
      ExecMainCode: 0,
      ExecMainStatus: 0,
    });
    rmSync(join(dir, "compare.json")); // a GitHub rate limit or outage
    writeFileSync(join(dir, "login-fails"), ""); // and a registry outage
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `ds-release-driver: attached ${UNIT}\n`);
    assert.equal(log("curl.log"), "", "GitHub is not asked");
    assert.equal(log("docker.log"), "", "the registry is not asked");
    notStarted();
  });

  it("answers already-succeeded for a finished rc-0 unit whose release record closed succeeded", () => {
    setUnit({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "exited",
      ExecMainCode: 1,
      ExecMainStatus: 0,
    });
    setRecord("succeeded");
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "ds-release-driver: already-succeeded\n");
    notStarted();
    assert.equal(
      log("systemctl.log"),
      "",
      "the finished unit is kept: its rc answers status",
    );
  });

  for (const [what, props, record] of [
    [
      "a failed unit",
      {
        ActiveState: "failed",
        SubState: "failed",
        ExecMainCode: 1,
        ExecMainStatus: 1,
      },
      "failed",
    ],
    [
      "an rc-0 unit whose release is still open",
      {
        ActiveState: "active",
        SubState: "exited",
        ExecMainCode: 1,
        ExecMainStatus: 0,
      },
      "running",
    ],
  ]) {
    it(`resets ${what} of the same SHA and starts it again`, () => {
      setUnit({ LoadState: "loaded", ...props });
      setRecord(record);
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${UNIT}\n`);
      assert.equal(
        log("systemctl.log"),
        `stop ${UNIT}.service\nreset-failed ${UNIT}.service\n`,
      );
    });
  }

  it("refuses while another SHA holds the env lease", () => {
    writeFileSync(join(dir, "lease"), OTHER.slice(0, 12));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `ds-release-driver: refused: env stage-main is leased by release ${OTHER.slice(0, 12)}, which has not finished\n`,
    );
    notStarted();
  });

  describe("3297: the lock directory", () => {
    const lockDir = () => join(dir, "lock");

    it("creates the lock directory 0755, owned by the caller, and locks there", () => {
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(statSync(lockDir()).mode & 0o777, 0o755);
      assert.ok(
        existsSync(join(lockDir(), "ds-release-driver-stage-main.lock")),
      );
    });

    it("refuses, naming the path and its owner, a lock path that exists but cannot be opened", () => {
      const lock = join(lockDir(), "ds-release-driver-stage-main.lock");
      mkdirSync(lock, { recursive: true }); // EISDIR for every uid, root included
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 3);
      assert.equal(r.stdout, "");
      assert.match(
        r.stderr,
        new RegExp(
          `^ds-release-driver: refused: cannot open lock ${lock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(owner [a-z_][a-z0-9_-]*\\)\n$`,
        ),
      );
      assert.doesNotMatch(r.stderr, /Permission denied|Is a directory/);
      notStarted();
    });

    it("refuses a group- or other-writable lock directory", () => {
      mkdirSync(lockDir());
      chmodSync(lockDir(), 0o1777);
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /^ds-release-driver: refused: lock directory \S+ is group- or other-writable \(mode 1777\)\n$/,
      );
      notStarted();
    });

    it("refuses a lock directory that is a symlink", () => {
      mkdirSync(join(dir, "elsewhere"));
      symlinkSync(join(dir, "elsewhere"), lockDir());
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /^ds-release-driver: refused: lock directory \S+ is a symlink\n$/,
      );
      notStarted();
    });
  });

  it("asks GitHub, without a token, whether the SHA is on main", () => {
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    const call = log("curl.log").trim();
    assert.match(
      call,
      new RegExp(
        `https://api\\.github\\.com/repos/doctor-school/ds-platform/compare/main\\.\\.\\.${SHA}$`,
      ),
    );
    assert.doesNotMatch(call, /Authorization|token/i);
  });

  it("starts for a SHA identical to main", () => {
    setCompare("identical");
    assert.equal(run(["stage-main", SHA]).status, 0);
  });

  for (const status of ["diverged", "ahead"]) {
    it(`refuses a SHA whose compare with main is ${status} (fork or unmerged commit)`, () => {
      setCompare(status);
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 3);
      assert.equal(r.stdout, "");
      assert.equal(
        r.stderr,
        `ds-release-driver: refused: ${SHA} is not on main (compare status: ${status})\n`,
      );
      notStarted();
      assert.equal(log("docker.log"), "", "the registry is not asked");
    });
  }

  it("refuses closed when GitHub cannot answer (404, rate limit, network)", () => {
    rmSync(join(dir, "compare.json"));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(
      r.stderr,
      `ds-release-driver: refused: cannot confirm ${SHA} is on main (GitHub compare unavailable)\n`,
    );
    notStarted();
  });

  it("refuses closed on a compare answer without a status", () => {
    writeFileSync(join(dir, "compare.json"), "not json");
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /is not on main \(compare status: unknown\)/);
    notStarted();
  });

  it("checks every digest against the release-namespace tag of the SHA, then logs out", () => {
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    const calls = log("docker.log").trim().split("\n");
    assert.equal(
      calls[0],
      `login ${IMAGE_REGISTRY} -u ds-platform --password-stdin`,
    );
    assert.equal(
      log("docker.login-stdin"),
      "s3cr3t-pull-value\n",
      "the token travels on stdin",
    );
    assert.deepEqual(
      calls.filter((c) => c.startsWith("manifest")),
      RECORDED_IMAGE_NAMES.map(
        (name) => `manifest inspect --verbose ${IMAGE_REGISTRY}/${name}:${SHA}`,
      ),
    );
    assert.equal(calls.at(-1), `logout ${IMAGE_REGISTRY}`);
    assert.doesNotMatch(
      log("sudo.log"),
      /s3cr3t-pull-value/,
      "the token is never in an argv",
    );
  });

  it("logs in to the registry under a docker config dir of its own, root-only and removed after", () => {
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    const configs = log("docker.config").trim().split("\n");
    const [first] = configs;
    const [path, mode] = first.split(" ");
    assert.notEqual(path, "unset", "DOCKER_CONFIG is set for the probe");
    assert.notEqual(path, join(home, ".docker"), "not the shared docker login");
    assert.equal(mode, "700", "the probe's config dir is root-only");
    assert.ok(
      configs.every((c) => c.split(" ")[0] === path),
      "login, every inspect and the logout share that one dir",
    );
    assert.equal(existsSync(path), false, "the dir is removed on exit");
    assert.equal(existsSync(join(home, ".docker")), false);
  });

  it("removes the probe's docker config dir when the login fails", () => {
    writeFileSync(join(dir, "login-fails"), "");
    assert.equal(run(["stage-main", SHA]).status, 3);
    const [path] = log("docker.config").trim().split(" ");
    assert.notEqual(path, "unset");
    assert.equal(existsSync(path), false);
  });

  it("keeps only the saved manifest of the SHA it starts", () => {
    const saved = join(root, "var/lib/ds-platform/release-driver");
    mkdirSync(saved, { recursive: true });
    writeFileSync(join(saved, `${"b".repeat(40)}.json`), "{}");
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(saved), [`${SHA}.json`]);
  });

  it("refuses a manifest digest the registry does not serve for the SHA", () => {
    serve("portal", digestOf("9"));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(
      r.stderr,
      "ds-release-driver: refused: the manifest digest of portal is not the one the registry serves for this commit\n",
    );
    notStarted();
    assert.match(log("docker.log"), /logout/);
  });

  it("refuses when the release-namespace tag of the SHA is missing", () => {
    rmSync(join(dir, "registry", `${IMAGE_REGISTRY}_api_${SHA}.json`));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(
      r.stderr,
      "ds-release-driver: refused: the registry serves no single-manifest api tag of this commit\n",
    );
    notStarted();
  });

  it("refuses when the box cannot log in to the registry", () => {
    writeFileSync(join(dir, "login-fails"), "");
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.equal(
      r.stderr,
      "ds-release-driver: refused: cannot read the registry with the box's pull credential\n",
    );
    notStarted();
  });

  // #3254: a manifest of a newer tree may carry an image this installed driver does not
  // know yet (the driver itself is installed from the tree it ships). The extra image
  // keeps the whole provenance check; slot.mjs / prod.mjs of the shipped tree judge
  // the image set itself.
  describe("3254: an image the driver does not know", () => {
    const WORKER = `${IMAGE_REGISTRY}/worker@${digestOf("f")}`;
    const withWorker = (images = {}) =>
      manifest({ images: { ...IMAGES, worker: WORKER, ...images } });

    it("starts for a manifest with an extra, well-formed, registry-served image", () => {
      serve("worker", digestOf("f"));
      const r = run(["stage-main", SHA], { input: withWorker() });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(
        log("docker.log")
          .trim()
          .split("\n")
          .filter((c) => c.startsWith("manifest")),
        [...RECORDED_IMAGE_NAMES, "worker"].map(
          (name) =>
            `manifest inspect --verbose ${IMAGE_REGISTRY}/${name}:${SHA}`,
        ),
        "every manifest image, the extra one too, is checked against the registry",
      );
      assert.match(log("systemd-run.args"), /--unit=/);
    });

    for (const name of ["Worker", "-worker", "work_er"]) {
      it(`refuses an extra image named ${name}`, () => {
        const r = run(["stage-main", SHA], {
          input: manifest({
            images: {
              ...IMAGES,
              [name]: `${IMAGE_REGISTRY}/${name}@${digestOf("f")}`,
            },
          }),
        });
        assert.equal(r.status, 3, r.stdout);
        assert.equal(
          r.stderr,
          "ds-release-driver: refused: bad manifest: the manifest image names are not all image names\n",
        );
        notStarted();
        assert.equal(log("docker.log"), "", "nothing is asked of the registry");
      });
    }

    it("refuses an extra image whose digest reference names another image", () => {
      const r = run(["stage-main", SHA], {
        input: withWorker({ worker: IMAGES.api }),
      });
      assert.equal(r.status, 3, r.stdout);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: bad manifest: the manifest image worker is not a sha256 digest reference of worker\n",
      );
      notStarted();
    });

    it("refuses an extra image whose digest the registry does not serve for the SHA", () => {
      serve("worker", digestOf("9"));
      const r = run(["stage-main", SHA], { input: withWorker() });
      assert.equal(r.status, 3, r.stdout);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: the manifest digest of worker is not the one the registry serves for this commit\n",
      );
      notStarted();
    });

    it("refuses an extra image the registry has no tag of the SHA for", () => {
      const r = run(["stage-main", SHA], { input: withWorker() });
      assert.equal(r.status, 3, r.stdout);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: the registry serves no single-manifest worker tag of this commit\n",
      );
      notStarted();
    });

    it("still refuses a manifest without a required image", () => {
      serve("worker", digestOf("f"));
      const images = { ...IMAGES, worker: WORKER };
      delete images.api;
      const r = run(["stage-main", SHA], {
        input: manifest({ images }),
      });
      assert.equal(r.status, 3, r.stdout);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: bad manifest: the manifest images lack api\n",
      );
      notStarted();
    });
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

  describe("3157: the prod release driver", () => {
    const PROD_UNIT = `ds-prod-${SHA.slice(0, 12)}-driver`;
    const exited = (status) => ({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "exited",
      ExecMainCode: 1,
      ExecMainStatus: status,
    });
    const LIVE = "d".repeat(40);
    const setLive = (status, image = `ds-api:${LIVE}`) => {
      writeFileSync(join(dir, "live-image"), `${image}\n`);
      writeFileSync(join(dir, "compare-live.json"), JSON.stringify({ status }));
    };
    const DOWNGRADE = `ds-release-driver: refused: ${SHA} does not descend from the live prod SHA ${LIVE.slice(0, 12)} — a downgrade is a rollback (deploy-prod.yml with mode: rollback)\n`;
    beforeEach(() => {
      setRole("prod");
      setLive("ahead");
    });

    it("asks GitHub whether the SHA descends from the live prod SHA it reads from the running api", () => {
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(
        log("docker.log"),
        /^inspect ds-api-prod-api-1 --format \{\{\.Config\.Image\}\}$/m,
      );
      assert.match(
        log("curl.log"),
        new RegExp(`/compare/${LIVE}\\.\\.\\.${SHA}`),
      );
    });

    it("starts a re-run of the live SHA itself (identical)", () => {
      setLive("identical");
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
    });

    it("refuses a downgrade: a SHA that does not descend from the live prod SHA", () => {
      for (const status of ["behind", "diverged"]) {
        setLive(status);
        const r = run(["prod", SHA]);
        assert.equal(r.status, 3, status);
        assert.equal(r.stderr, DOWNGRADE, status);
      }
      rmSync(join(dir, "compare-live.json")); // GitHub cannot answer: closed
      const r = run(["prod", SHA]);
      assert.equal(r.status, 3);
      assert.equal(r.stderr, DOWNGRADE);
      notStarted();
    });

    it("refuses when the live prod SHA is unknown (no running api)", () => {
      for (const image of [null, "ds-api:local", "absent"]) {
        if (image === null) rmSync(join(dir, "live-image"));
        else setLive("ahead", image);
        const r = run(["prod", SHA]);
        assert.equal(r.status, 3, String(image));
        assert.equal(
          r.stderr,
          "ds-release-driver: refused: the live prod SHA is unknown (no running ds-api-prod-api-1) — release it from the workstation path\n",
        );
      }
      notStarted();
    });

    it("never asks the live SHA on the stage box", () => {
      setRole("stage");
      const r = run(["stage-main", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(log("docker.log"), /^inspect ds-api-prod-api-1\b/m);
    });

    it("starts the release unit for prod on a prod-role box, after the lease", () => {
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
      assert.equal(r.stderr, "");
      const argv = log("systemd-run.args").trim().split("\n");
      for (const want of [
        `--unit=${PROD_UNIT}`,
        "--remain-after-exit",
        "KillMode=mixed",
      ]) {
        assert.ok(
          argv.includes(want),
          `systemd-run gets ${want}: ${argv.join(" ")}`,
        );
      }
      assert.deepEqual(argv.slice(-4), [
        "/usr/local/lib/ds-platform/release-driver",
        "_run",
        "prod",
        SHA,
      ]);
      assert.match(
        log("ds-release.log"),
        new RegExp(`^lease prod ${SHA}$`, "m"),
      );
      assert.match(log("curl.log"), new RegExp(`/compare/main\\.\\.\\.${SHA}`));
    });

    it("refuses stage-main and PR slots on the prod box", () => {
      for (const env of ["stage-main", "stage-pr-7"]) {
        const r = run([env, SHA]);
        assert.equal(r.status, 3, env);
        assert.equal(
          r.stderr,
          `ds-release-driver: refused: the prod box serves prod, not ${env}\n`,
        );
      }
      notStarted();
    });

    it("refuses a SHA that is not on main", () => {
      for (const status of ["ahead", "diverged"]) {
        setCompare(status);
        const r = run(["prod", SHA]);
        assert.equal(r.status, 3, status);
        assert.match(
          r.stderr,
          new RegExp(`is not on main \\(compare status: ${status}\\)`),
        );
      }
      notStarted();
    });

    it("refuses a manifest digest the registry does not serve for the SHA", () => {
      serve("api", digestOf("f"));
      const r = run(["prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /refused: the manifest digest of api is not the one the registry serves/,
      );
      notStarted();
    });

    it("attaches to a running release unit of the SHA, before GitHub or the registry", () => {
      setUnit(
        {
          LoadState: "loaded",
          ActiveState: "active",
          SubState: "running",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        PROD_UNIT,
      );
      rmSync(join(dir, "compare.json"));
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: attached ${PROD_UNIT}\n`);
      assert.equal(log("curl.log"), "");
      notStarted();
    });

    it("answers already-succeeded for an rc-0 unit whose release closed succeeded", () => {
      setUnit(exited(0), PROD_UNIT);
      setRecord("succeeded");
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "ds-release-driver: already-succeeded\n");
      notStarted();
    });

    it("starts a failed release of the SHA again", () => {
      setUnit(exited(1), PROD_UNIT);
      setRecord("failed");
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
      assert.match(
        log("systemctl.log"),
        new RegExp(`reset-failed ${PROD_UNIT}\\.service`),
      );
    });

    it("refuses while another SHA holds the prod lease", () => {
      writeFileSync(join(dir, "lease"), OTHER);
      const r = run(["prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /refused: env prod is leased by release/);
      notStarted();
    });
  });

  describe("3354: the prod redeploy of the live SHA", () => {
    const PROD_UNIT = `ds-prod-${SHA.slice(0, 12)}-driver`;
    const RB_UNIT = `ds-prod-${SHA.slice(0, 12)}-rollback`;
    const LIVE = "d".repeat(40);
    const exited = (status) => ({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "exited",
      ExecMainCode: 1,
      ExecMainStatus: status,
    });
    const running = {
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "running",
      ExecMainCode: 0,
      ExecMainStatus: 0,
    };
    // The running api carries <image>; a compare of another live SHA answers <status>.
    const setLive = (sha, status = "identical") => {
      writeFileSync(join(dir, "live-image"), `ds-api:${sha}\n`);
      writeFileSync(join(dir, "compare-live.json"), JSON.stringify({ status }));
    };
    beforeEach(() => {
      setRole("prod");
      setLive(SHA);
    });

    it("re-runs the live SHA's finished, succeeded release as a fresh unit run — never already-succeeded", () => {
      setUnit(exited(0), PROD_UNIT);
      setRecord("succeeded");
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
      assert.equal(r.stderr, "");
      // The finished unit is reset first, so its name is free for the new run.
      assert.equal(
        log("systemctl.log"),
        `stop ${PROD_UNIT}.service\nreset-failed ${PROD_UNIT}.service\n`,
      );
      const argv = log("systemd-run.args").trim().split("\n");
      for (const want of [
        `--unit=${PROD_UNIT}`,
        "--remain-after-exit",
        "KillMode=mixed",
        "StandardOutput=journal",
        "StandardError=journal",
      ]) {
        assert.ok(argv.includes(want), `systemd-run gets ${want}`);
      }
      assert.deepEqual(argv.slice(-4), [
        "/usr/local/lib/ds-platform/release-driver",
        "_redeploy",
        "prod",
        SHA,
      ]);
      // The release's own checks and lease.
      assert.match(
        log("ds-release.log"),
        new RegExp(`^lease prod ${SHA}$`, "m"),
      );
      assert.match(log("curl.log"), new RegExp(`/compare/main\\.\\.\\.${SHA}`));
      assert.match(
        log("docker.log"),
        /^inspect ds-api-prod-api-1 --format \{\{\.Config\.Image\}\}$/m,
      );
      assert.match(log("docker.log"), /^manifest inspect --verbose /m);
    });

    it("re-reads the live SHA under the driver lock: a rollback that ended meanwhile refuses the redeploy", () => {
      setUnit(exited(0), PROD_UNIT);
      setRecord("succeeded");
      // The first inspect (before the lock) finds <sha> live; the one under the lock
      // finds the SHA a break-glass rollback put back in between.
      writeFileSync(join(dir, "live-image.2"), `ds-api:${LIVE}\n`);
      writeFileSync(join(dir, "compare-live.json"), JSON.stringify({ status: "ahead" }));
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3, r.stderr);
      assert.match(
        r.stderr,
        new RegExp(`not the live prod SHA ${LIVE.slice(0, 12)} — a newer SHA is a release`),
      );
      assert.equal(
        (log("docker.log").match(/^inspect ds-api-prod-api-1 /gm) ?? []).length,
        2,
        "the live SHA is read again under the lock",
      );
      assert.doesNotMatch(log("ds-release.log"), /^lease /m);
      assert.equal(log("systemctl.log"), "");
      assert.equal(log("systemd-run.args"), "");
    });

    it("`status prod <sha>` keeps finding the redeploy: unit-state reports the same unit running", () => {
      setUnit(exited(0), PROD_UNIT);
      setRecord("succeeded");
      assert.equal(run(["redeploy", "prod", SHA]).status, 0);
      const r = run(["unit-state", "prod", SHA], { input: "" });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        unit: PROD_UNIT,
        active: "active",
        rc: null,
        previousSha: null,
      });
    });

    it("starts for a live SHA with no finished unit on the box (a reboot forgot it)", () => {
      setRecord("succeeded");
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
    });

    it("attaches to a running unit of the SHA, before GitHub or the registry", () => {
      setUnit(running, PROD_UNIT);
      rmSync(join(dir, "compare.json"));
      writeFileSync(join(dir, "login-fails"), "");
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: attached ${PROD_UNIT}\n`);
      assert.equal(log("curl.log"), "");
      notStarted();
    });

    for (const [status, mode] of [
      [
        "ahead",
        "a newer SHA is a release (deploy-prod.yml with mode: release)",
      ],
      [
        "behind",
        "an older SHA is a rollback (deploy-prod.yml with mode: rollback)",
      ],
      ["diverged", "a redeploy re-runs the live SHA only"],
    ]) {
      it(`refuses a SHA that is not the live one (compare ${status}), naming the right mode`, () => {
        setLive(LIVE, status);
        const r = run(["redeploy", "prod", SHA]);
        assert.equal(r.status, 3);
        assert.equal(
          r.stderr,
          `ds-release-driver: refused: ${SHA} is not the live prod SHA ${LIVE.slice(0, 12)} — ${mode}\n`,
        );
        notStarted();
      });
    }

    it("refuses when the live prod SHA is unknown (no running api)", () => {
      rmSync(join(dir, "live-image"));
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: the live prod SHA is unknown (no running ds-api-prod-api-1) — there is no release to redeploy\n",
      );
      notStarted();
    });

    it("refuses a SHA not on main and a digest the registry does not serve, as a release does", () => {
      setCompare("diverged");
      let r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /is not on main \(compare status: diverged\)/);
      setCompare("behind");
      serve("api", digestOf("f"));
      r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /the manifest digest of api is not the one the registry serves/,
      );
      notStarted();
    });

    it("waits while the SHA's rollback unit runs, and while another SHA holds the lease", () => {
      setUnit(running, RB_UNIT);
      let r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.equal(
        r.stderr,
        `ds-release-driver: refused: ${RB_UNIT} is still running; wait for it to end\n`,
      );
      rmSync(join(units, `${RB_UNIT}.props`));
      writeFileSync(join(dir, "lease"), OTHER);
      r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /refused: env prod is leased by release/);
      notStarted();
    });

    it("serves prod on the prod box only", () => {
      for (const env of ["stage-main", "stage-pr-7"]) {
        const r = run(["redeploy", env, SHA]);
        assert.equal(r.status, 3, env);
        assert.equal(
          r.stderr,
          `ds-release-driver: refused: a redeploy serves prod only, not ${env}\n`,
        );
      }
      setRole("stage");
      const r = run(["redeploy", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.equal(
        r.stderr,
        "ds-release-driver: refused: the stage box serves stage-main, not prod\n",
      );
      notStarted();
    });

    it("rejects bad arguments as usage", () => {
      for (const args of [
        ["redeploy", "prod"],
        ["redeploy", "prod", SHA.slice(0, 12)],
        ["redeploy", "prod", SHA, "extra"],
      ]) {
        assert.equal(run(args).status, 2, args.join(" "));
      }
      notStarted();
    });

    it("a release of the live SHA still answers already-succeeded (only a redeploy re-runs it)", () => {
      setUnit(exited(0), PROD_UNIT);
      setRecord("succeeded");
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "ds-release-driver: already-succeeded\n");
      notStarted();
    });
  });

  describe("2987: the box-side prod rollback", () => {
    const RB_UNIT = `ds-prod-${SHA.slice(0, 12)}-rollback`;
    const PROD_UNIT = `ds-prod-${SHA.slice(0, 12)}-driver`;
    const LIVE = "d".repeat(40);
    const TOOLING = "/usr/local/lib/ds-platform/tree";
    const exited = (status) => ({
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "exited",
      ExecMainCode: 1,
      ExecMainStatus: status,
    });
    const running = {
      LoadState: "loaded",
      ActiveState: "active",
      SubState: "running",
      ExecMainCode: 0,
      ExecMainStatus: 0,
    };
    const setLive = (status) => {
      writeFileSync(join(dir, "live-image"), `ds-api:${LIVE}\n`);
      writeFileSync(join(dir, "compare-live.json"), JSON.stringify({ status }));
    };
    const release = (tag, target, extra = {}) => ({
      tag_name: tag,
      target_commitish: target,
      draft: false,
      ...extra,
    });
    const setReleases = (list) =>
      writeFileSync(join(dir, "releases.json"), JSON.stringify(list));
    const installTree = (sha = LIVE) => {
      const tree = join(root, TOOLING, "tools/deploy");
      mkdirSync(tree, { recursive: true });
      writeFileSync(join(tree, "prod.mjs"), "// the tooling tree\n");
      writeFileSync(
        join(root, "usr/local/lib/ds-platform/installed-tree"),
        `${sha} ${TOOLING}\n`,
      );
    };
    const recordFile = () =>
      join(root, "var/lib/ds-platform/release-driver/rollback", `${SHA}.json`);
    const readRecord = () => JSON.parse(readFileSync(recordFile(), "utf8"));

    beforeEach(() => {
      setRole("prod");
      setLive("behind");
      setReleases([
        release("release-2026.10.20-1", LIVE),
        release("release-2026.10.19-2", SHA),
        release("release-2026.10.19-1", OTHER),
      ]);
      installTree();
    });

    it("starts its own unit and record, without a lease, after the live-unit check excluding exactly itself", () => {
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${RB_UNIT}\n`);
      assert.equal(r.stderr, "");
      const calls = log("ds-release.log");
      assert.match(calls, new RegExp(`^check --except ${RB_UNIT} prod$`, "m"));
      assert.doesNotMatch(
        calls,
        /^(lease|release|finish|status)\b/m,
        "never the release record, never a lease",
      );
      const saved = join(
        root,
        "var/lib/ds-platform/release-driver/rollback",
        `${SHA}.images.json`,
      );
      assert.equal(readFileSync(saved, "utf8"), manifest());
      assert.equal(statSync(saved).mode & 0o777, 0o600);
      const argv = log("systemd-run.args").trim().split("\n");
      for (const want of [
        `--unit=${RB_UNIT}`,
        "--remain-after-exit",
        "KillMode=mixed",
        `StandardInput=file:${saved}`,
      ]) {
        assert.ok(argv.includes(want), `systemd-run gets ${want}`);
      }
      assert.deepEqual(argv.slice(-4), [
        "/usr/local/lib/ds-platform/release-driver",
        "_rollback",
        "prod",
        SHA,
      ]);
      const record = readRecord();
      assert.equal(record.kind, "rollback");
      assert.equal(record.state, "running");
      assert.equal(record.unit, RB_UNIT);
      assert.equal(record.from, LIVE);
      assert.equal(statSync(recordFile()).mode & 0o777, 0o600);
      assert.ok(
        !existsSync(
          join(root, "var/lib/ds-platform/release-driver", `${SHA}.json`),
        ),
        "the release manifest slot of the SHA is untouched",
      );
      assert.match(
        log("curl.log"),
        new RegExp(`/compare/${LIVE}\\.\\.\\.${SHA}`),
      );
      assert.match(log("curl.log"), /\/releases\?per_page=100/);
    });

    for (const status of ["ahead", "identical", "diverged"]) {
      it(`refuses a target whose compare with the live SHA is ${status}: a rollback never moves production forward`, () => {
        setLive(status);
        const r = run(["rollback", "prod", SHA]);
        assert.equal(r.status, 3);
        assert.match(
          r.stderr,
          new RegExp(
            `is not behind the live prod SHA ${LIVE.slice(0, 12)} \\(compare status: ${status}\\)`,
          ),
        );
        notStarted();
      });
    }

    it("refuses closed when the live SHA is unknown or GitHub cannot compare", () => {
      rmSync(join(dir, "compare-live.json"));
      assert.equal(run(["rollback", "prod", SHA]).status, 3);
      rmSync(join(dir, "live-image"));
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /live prod SHA is unknown/);
      notStarted();
    });

    it("3297: refuses, naming the path and its owner, a lock path that exists but cannot be opened", () => {
      const lock = join(dir, "lock", "ds-release-driver-prod.lock");
      mkdirSync(lock, { recursive: true });
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.ok(
        r.stderr.startsWith(
          `ds-release-driver: refused: cannot open lock ${lock} (owner `,
        ),
        r.stderr,
      );
      assert.doesNotMatch(r.stderr, /Permission denied|Is a directory/);
      notStarted();
    });

    it("refuses a SHA that is not the target of one of the latest 3 release-* Releases", () => {
      setReleases([
        release("release-2026.10.21-1", LIVE),
        release("release-2026.10.20-3", OTHER),
        release("release-2026.10.20-2", OTHER),
        release("release-2026.10.18-1", SHA), // the 4th newest
        release("release-2026.10.22-1", SHA, { draft: true }), // a draft is no release
        release("v9.9.9", SHA), // not a release-* tag
      ]);
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /is not the target of one of the latest 3 release-\* Releases/,
      );
      notStarted();
    });

    it("orders the Releases by date and sequence, not by listing order", () => {
      setReleases([
        release("release-2026.10.18-1", SHA),
        release("release-2026.10.20-10", OTHER),
        release("release-2026.10.20-9", OTHER),
        release("release-2026.10.19-1", LIVE),
      ]);
      assert.equal(
        run(["rollback", "prod", SHA]).status,
        3,
        "the 4th newest by key",
      );
    });

    it("refuses closed when GitHub cannot list the Releases", () => {
      rmSync(join(dir, "releases.json"));
      assert.equal(run(["rollback", "prod", SHA]).status, 3);
      writeFileSync(join(dir, "releases.json"), "{}");
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /cannot read the GitHub Releases/);
      notStarted();
    });

    it("refuses a target that is not on main, or whose digests the registry does not serve", () => {
      setCompare("diverged");
      assert.equal(run(["rollback", "prod", SHA]).status, 3);
      setCompare("behind");
      serve("api", digestOf("9"));
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        /manifest digest of api is not the one the registry serves/,
      );
      notStarted();
    });

    it("refuses a bad manifest before anything is asked", () => {
      const r = run(["rollback", "prod", SHA], {
        input: manifest({ ref: "pr/7" }),
      });
      assert.equal(r.status, 3);
      assert.match(r.stderr, /bad manifest/);
      assert.equal(log("curl.log"), "");
      notStarted();
    });

    it("is refused on the stage box and for any env but prod", () => {
      setRole("stage");
      const stage = run(["rollback", "prod", SHA]);
      assert.equal(stage.status, 3);
      assert.match(stage.stderr, /served by the prod box only/);
      setRole("prod");
      for (const env of ["stage-main", "stage-pr-4"]) {
        const r = run(["rollback", env, SHA]);
        assert.equal(r.status, 3, env);
        assert.match(r.stderr, /a rollback serves prod only/);
      }
      notStarted();
    });

    it("refuses without a recorded tooling tree", () => {
      rmSync(join(root, "usr/local/lib/ds-platform/installed-tree"));
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /no tooling tree is recorded/);
      notStarted();
    });

    it("refuses while any release step runs, naming the unit", () => {
      writeFileSync(
        join(dir, "live-step"),
        `ds-prod-${SHA.slice(0, 12)}-migrate`,
      );
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(
        r.stderr,
        new RegExp(
          `ds-prod-${SHA.slice(0, 12)}-migrate\\.service is still running`,
        ),
      );
      notStarted();
      assert.ok(!existsSync(recordFile()), "no record before the unit starts");
    });

    it("attaches to its running unit before GitHub or the registry", () => {
      setUnit(running, RB_UNIT);
      rmSync(join(dir, "compare.json"));
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: attached ${RB_UNIT}\n`);
      assert.equal(log("curl.log"), "");
      notStarted();
    });

    it("resets a finished rollback unit of the SHA and starts a fresh attempt", () => {
      setUnit(exited(1), RB_UNIT);
      const r = run(["rollback", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(
        log("systemctl.log"),
        new RegExp(`^reset-failed ${RB_UNIT}\\.service$`, "m"),
      );
      assert.equal(r.stdout, `ds-release-driver: started ${RB_UNIT}\n`);
    });

    describe("3219: a re-run after lost contact", () => {
      const writeRecord = (state) => {
        mkdirSync(join(recordFile(), ".."), { recursive: true });
        writeFileSync(
          recordFile(),
          JSON.stringify({ kind: "rollback", sha: SHA, state, from: LIVE }),
        );
      };
      const setLiveTarget = () =>
        writeFileSync(join(dir, "live-image"), `ds-api:${SHA}\n`);

      it("answers already-succeeded for the live target whose rc-0 rollback recorded succeeded — no lock, no record write, no unit touch", () => {
        setLiveTarget();
        setUnit(exited(0), RB_UNIT);
        writeRecord("succeeded");
        const before = readFileSync(recordFile(), "utf8");
        rmSync(join(dir, "compare.json"));
        const r = run(["rollback", "prod", SHA]);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout, "ds-release-driver: already-succeeded\n");
        assert.equal(readFileSync(recordFile(), "utf8"), before);
        assert.doesNotMatch(log("systemctl.log"), /^(stop|reset-failed) /m);
        assert.equal(log("ds-release.log"), "", "no release check, no lease");
        assert.equal(log("curl.log"), "", "no GitHub, no registry");
        notStarted();
      });

      for (const [label, unit, state] of [
        ["a failed record", exited(0), "failed"],
        ["a record still running", exited(0), "running"],
        ["a non-zero unit", exited(1), "succeeded"],
      ]) {
        it(`keeps refusing a live target with ${label}`, () => {
          setLiveTarget();
          setUnit(unit, RB_UNIT);
          writeRecord(state);
          setLive("identical");
          writeFileSync(join(dir, "live-image"), `ds-api:${SHA}\n`);
          const r = run(["rollback", "prod", SHA]);
          assert.equal(r.status, 3);
          assert.match(r.stderr, /is not behind the live prod SHA/);
          notStarted();
        });
      }

      it("keeps refusing a live target without any rollback record", () => {
        setLive("identical");
        setLiveTarget();
        const r = run(["rollback", "prod", SHA]);
        assert.equal(r.status, 3);
        assert.match(r.stderr, /is not behind the live prod SHA/);
        notStarted();
      });
    });

    it("a release of the SHA waits while its rollback runs", () => {
      setLive("identical");
      setUnit(running, RB_UNIT);
      const r = run(["prod", SHA]);
      assert.equal(r.status, 3);
      assert.match(r.stderr, new RegExp(`${RB_UNIT} is still running`));
      notStarted();
      // Refused before anything of the release happens: no lease is taken (it would
      // hold prod for a release that never started), no finished unit is reset, no
      // manifest is saved.
      assert.doesNotMatch(log("ds-release.log"), /^(lease|status)\b/m);
      assert.equal(log("systemctl.log"), "");
      assert.ok(
        !existsSync(
          join(root, "var/lib/ds-platform/release-driver", `${SHA}.json`),
        ),
      );
    });

    it("a later release of the rolled-off SHA re-runs: its superseded record never answers already-succeeded", () => {
      setLive("ahead");
      setUnit(exited(0), PROD_UNIT);
      writeFileSync(
        join(dir, "status.json"),
        JSON.stringify({
          release: { sha: SHA, state: "superseded" },
          unitAlive: null,
        }),
      );
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `ds-release-driver: started ${PROD_UNIT}\n`);
    });

    describe("rollback-status", () => {
      it("reports no record and an absent unit before any rollback", () => {
        const r = run(["rollback-status", "prod", SHA]);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          rollback: null,
          driver: {
            unit: RB_UNIT,
            active: "absent",
            rc: null,
            previousSha: null,
          },
        });
        assert.equal(log("ds-release.log"), "", "never the release record");
      });

      it("returns the rollback record and the -rollback unit's state", () => {
        assert.equal(run(["rollback", "prod", SHA]).status, 0);
        setUnit(exited(0), RB_UNIT);
        const r = run(["rollback-status", "prod", SHA]);
        assert.equal(r.status, 0, r.stderr);
        const doc = JSON.parse(r.stdout);
        assert.equal(doc.rollback.kind, "rollback");
        assert.equal(doc.rollback.state, "running");
        assert.deepEqual(doc.driver, {
          unit: RB_UNIT,
          active: "inactive",
          rc: 0,
          previousSha: null,
        });
        assert.equal(r.stdout.split("\n").length, 2, "one line");
      });

      it("names a corrupt record", () => {
        mkdirSync(dirname(recordFile()), { recursive: true });
        writeFileSync(recordFile(), "{nope");
        const r = run(["rollback-status", "prod", SHA]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /corrupt rollback record/);
      });

      it("is refused on the stage box", () => {
        setRole("stage");
        assert.equal(run(["rollback-status", "prod", SHA]).status, 3);
      });
    });

    describe("_rollback", () => {
      beforeEach(() => {
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

      it("runs prod.mjs --local --rollback from the tooling tree, never a codeload of the target", () => {
        const r = run(["_rollback", "prod", SHA]);
        assert.equal(r.status, 0, r.stderr);
        const argv = log("node.args").trim().split("\n");
        assert.equal(argv[0], join(root, TOOLING, "tools/deploy/prod.mjs"));
        assert.deepEqual(argv.slice(1), [
          "--local",
          "--rollback",
          SHA,
          "--images-file",
          "-",
        ]);
        assert.equal(log("node.saw-tree"), "// the tooling tree\n");
        assert.equal(log("node.stdin"), manifest());
        assert.equal(
          log("curl.log"),
          "",
          "the driver fetches nothing: prod.mjs fetches the target tree",
        );
        assert.equal(readRecord().state, "succeeded");
      });

      it("a second rollback (after a rollback) still runs from the tooling tree", () => {
        assert.equal(run(["_rollback", "prod", SHA]).status, 0);
        assert.equal(run(["_rollback", "prod", OTHER]).status, 0);
        const argv = log("node.args").trim().split("\n");
        assert.equal(argv[0], join(root, TOOLING, "tools/deploy/prod.mjs"));
        assert.deepEqual(argv.slice(1), [
          "--local",
          "--rollback",
          OTHER,
          "--images-file",
          "-",
        ]);
      });

      it("a red rollback is the unit's exit status and its record's verdict", () => {
        assert.equal(
          run(["_rollback", "prod", SHA], { env: { NODE_RC: "1" } }).status,
          1,
        );
        assert.equal(readRecord().state, "failed");
        assert.equal(readRecord().kind, "rollback");
      });

      it("fails without a recorded tooling tree", () => {
        rmSync(join(root, "usr/local/lib/ds-platform/installed-tree"));
        assert.equal(run(["_rollback", "prod", SHA]).status, 1);
        assert.equal(log("node.args"), "");
      });
    });
  });

  describe("3157: record-previous and previousSha", () => {
    const PREVIOUS = "c".repeat(40);
    const saved = () =>
      join(root, "var/lib/ds-platform/release-driver", `${SHA}.previous`);
    const previousOf = () => {
      const r = run(["unit-state", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).previousSha;
    };

    it("reports no previous SHA until one is recorded", () => {
      assert.equal(previousOf(), null);
    });

    it("records the previous SHA root-only and reports it as previousSha", () => {
      const r = run(["record-previous", "prod", SHA, PREVIOUS]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(saved(), "utf8"), `${PREVIOUS}\n`);
      assert.equal(statSync(saved()).mode & 0o777, 0o600);
      assert.equal(previousOf(), PREVIOUS);
    });

    it("keeps the first recorded basis: a re-run after the swap reads the SHA itself", () => {
      run(["record-previous", "prod", SHA, PREVIOUS]);
      assert.equal(run(["record-previous", "prod", SHA, SHA]).status, 0);
      assert.equal(previousOf(), PREVIOUS);
    });

    it("records nothing for none, and a later real basis still lands", () => {
      assert.equal(run(["record-previous", "prod", SHA, "none"]).status, 0);
      assert.equal(existsSync(saved()), false);
      run(["record-previous", "prod", SHA, PREVIOUS]);
      assert.equal(previousOf(), PREVIOUS);
    });

    it("rejects a bad previous SHA as usage (a full 40-hex SHA or none, as release-runner's --previous-sha)", () => {
      for (const args of [
        ["record-previous", "prod", SHA, "xyz"],
        ["record-previous", "prod", SHA, PREVIOUS.slice(0, 12)],
        ["record-previous", "prod", SHA],
        ["record-previous", "prod", "abc", PREVIOUS],
      ]) {
        assert.equal(run(args).status, 2, args.join(" "));
      }
      assert.equal(existsSync(saved()), false);
    });

    it("drops another SHA's recorded basis when a release starts", () => {
      setRole("prod");
      writeFileSync(join(dir, "live-image"), `ds-api:${PREVIOUS}\n`);
      writeFileSync(
        join(dir, "compare-live.json"),
        JSON.stringify({ status: "ahead" }),
      );
      const dirOf = join(root, "var/lib/ds-platform/release-driver");
      mkdirSync(dirOf, { recursive: true });
      writeFileSync(join(dirOf, `${OTHER}.previous`), `${PREVIOUS}\n`);
      run(["record-previous", "prod", SHA, PREVIOUS]);
      const r = run(["prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(readdirSync(dirOf).sort(), [
        `${SHA}.json`,
        `${SHA}.previous`,
      ]);
    });
  });

  it("refuses on a box without a role", () => {
    rmSync(join(root, "etc/ds-platform/box-role"));
    const r = run(["stage-main", SHA]);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /no known role/);
  });

  it("rejects bad arguments as usage", () => {
    for (const args of [
      [],
      ["stage-main"],
      ["stage-main", "abc"],
      ["staging", SHA],
      ["stage-main", SHA, "x"],
    ]) {
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
        if (Object.keys(doc).sort().join(",") !== "images,ref,sha")
          throw new Error("keys");
        validateImageManifest(doc, {
          sha: SHA,
          acceptRefs: RELEASE_MANIFEST_REFS,
          consumer: "slot main",
        });
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
      [
        "an activating unit",
        {
          LoadState: "loaded",
          ActiveState: "activating",
          SubState: "start",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        "activating",
        null,
      ],
      [
        "a running unit",
        {
          LoadState: "loaded",
          ActiveState: "active",
          SubState: "running",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        "active",
        null,
      ],
      [
        "an rc-0 finished unit",
        {
          LoadState: "loaded",
          ActiveState: "active",
          SubState: "exited",
          ExecMainCode: 1,
          ExecMainStatus: 0,
        },
        "inactive",
        0,
      ],
      [
        "a failed unit",
        {
          LoadState: "loaded",
          ActiveState: "failed",
          SubState: "failed",
          ExecMainCode: 1,
          ExecMainStatus: 3,
        },
        "failed",
        3,
      ],
      [
        "a killed unit",
        {
          LoadState: "loaded",
          ActiveState: "failed",
          SubState: "failed",
          ExecMainCode: 2,
          ExecMainStatus: 9,
        },
        "failed",
        9,
      ],
      [
        "a non-zero exit systemd still shows active (exited)",
        {
          LoadState: "loaded",
          ActiveState: "active",
          SubState: "exited",
          ExecMainCode: 1,
          ExecMainStatus: 4,
        },
        "failed",
        4,
      ],
      [
        "an rc-0 unit systemd shows inactive (dead)",
        {
          LoadState: "loaded",
          ActiveState: "inactive",
          SubState: "dead",
          ExecMainCode: 1,
          ExecMainStatus: 0,
        },
        "inactive",
        0,
      ],
      [
        "a deactivating unit",
        {
          LoadState: "loaded",
          ActiveState: "deactivating",
          SubState: "stop-sigterm",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        "active",
        null,
      ],
      [
        "a unit systemd does not know",
        {
          LoadState: "not-found",
          ActiveState: "inactive",
          SubState: "dead",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        "absent",
        null,
      ],
      [
        "a loaded unit that never ran",
        {
          LoadState: "loaded",
          ActiveState: "inactive",
          SubState: "dead",
          ExecMainCode: 0,
          ExecMainStatus: 0,
        },
        "absent",
        null,
      ],
    ]) {
      it(`reports ${what} as ${active}`, () => {
        if (props) setUnit(props);
        assert.deepEqual(state(), {
          unit: UNIT,
          active,
          rc,
          previousSha: null,
        });
      });
    }
  });

  describe("_run", () => {
    beforeEach(() => {
      // The codeload tarball: one top-level directory, as GitHub serves it.
      const src = join(dir, "src", `ds-platform-${SHA}`, "tools/staging");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "slot.mjs"), "// the tree\n");
      const deploy = join(dir, "src", `ds-platform-${SHA}`, "tools/deploy");
      mkdirSync(deploy, { recursive: true });
      writeFileSync(join(deploy, "prod.mjs"), "// the prod tree\n");
      assert.equal(
        spawnSync("tar", [
          "czf",
          join(dir, "codeload.tar.gz"),
          "-C",
          join(dir, "src"),
          `ds-platform-${SHA}`,
        ]).status,
        0,
      );
      stub(
        join(stubs, "curl"),
        [
          'echo "$*" > "$STUB_DIR/curl.args"',
          "while [[ $1 != -o ]]; do shift; done",
          'cp "$STUB_DIR/codeload.tar.gz" "$2"',
        ].join("\n"),
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
      assert.match(
        log("curl.args"),
        new RegExp(
          `https://codeload\\.github\\.com/doctor-school/ds-platform/tar\\.gz/${SHA}`,
        ),
      );
      const argv = log("node.args").trim().split("\n");
      assert.match(argv[0], /\/tree\/tools\/staging\/slot\.mjs$/);
      assert.deepEqual(argv.slice(1), [
        "up",
        "main",
        "--ref",
        SHA,
        "--local",
        "--images-file",
        "-",
      ]);
      assert.equal(
        log("node.saw-tree"),
        "// the tree\n",
        "the tarball was extracted with its top directory stripped",
      );
      assert.equal(log("node.stdin"), manifest());
      assert.deepEqual(readdirSync(home), [], "the work directory is removed");
    });

    it("exits with the converge's exit status", () => {
      const r = run(["_run", "stage-main", SHA], { env: { NODE_RC: "5" } });
      assert.equal(r.status, 5);
      assert.deepEqual(readdirSync(home), []);
    });

    it("runs stage-main and prod only", () => {
      assert.equal(run(["_run", "stage-pr-7", SHA]).status, 2);
    });

    it("3157: releases prod from exactly the SHA's tree: prod.mjs --local, manifest on stdin", () => {
      const r = run(["_run", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(
        log("curl.args"),
        new RegExp(
          `https://codeload\\.github\\.com/doctor-school/ds-platform/tar\\.gz/${SHA}`,
        ),
      );
      const argv = log("node.args").trim().split("\n");
      assert.match(argv[0], /\/tree\/tools\/deploy\/prod\.mjs$/);
      assert.deepEqual(argv.slice(1), ["--local", "--images-file", "-"]);
      assert.equal(log("node.saw-tree"), "// the prod tree\n");
      assert.equal(log("node.stdin"), manifest());
      assert.deepEqual(readdirSync(home), [], "the work directory is removed");
    });

    it("3354: a redeploy runs the live SHA's own prod.mjs --local --redeploy, manifest on stdin", () => {
      const r = run(["_redeploy", "prod", SHA]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(
        log("curl.args"),
        new RegExp(
          `https://codeload\\.github\\.com/doctor-school/ds-platform/tar\\.gz/${SHA}`,
        ),
      );
      const argv = log("node.args").trim().split("\n");
      assert.match(argv[0], /\/tree\/tools\/deploy\/prod\.mjs$/);
      assert.deepEqual(argv.slice(1), [
        "--local",
        "--redeploy",
        "--images-file",
        "-",
      ]);
      assert.equal(log("node.stdin"), manifest());
      assert.equal(
        run(["_redeploy", "prod", SHA], { env: { NODE_RC: "4" } }).status,
        4,
      );
      assert.equal(run(["_redeploy", "stage-main", SHA]).status, 2);
    });

    it("3157: a red prod release is the unit's exit status", () => {
      assert.equal(
        run(["_run", "prod", SHA], { env: { NODE_RC: "1" } }).status,
        1,
      );
    });
  });
});
