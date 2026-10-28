// tools/staging/edge-config.test.mjs — Issue #2920.
//
// The stage `main` converge owns the shared stg-infra edge config: every file the
// stg-infra compose bind-mounts from its own dir is installed from the converged
// SHA's tree into the box's compose dir, the Caddyfile is validated in the running
// caddy container, only stale services are restarted (never recreated), any failure
// puts the previous files back, and a marker records the installed SHA.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  STG_INFRA_COMPOSE_DIR,
  applyStageEdgeConfig,
  caddyValidateInContainerScript,
  composeDirBindMounts,
  edgeConfigCopyScript,
  edgeConfigMarkerScript,
  stgInfraRuntimeConfigTarget,
} from "./edge-config.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const COMPOSE = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "..",
    "infra",
    "deploy",
    "compose",
    "stg-infra",
    "compose.yml",
  ),
  "utf8",
);
const MOUNTS = composeDirBindMounts(COMPOSE);
const TARGET = stgInfraRuntimeConfigTarget(MOUNTS);

test("2920: the inventory is every bind mount the stg-infra compose takes from its own dir", () => {
  assert.deepEqual(MOUNTS, [
    {
      service: "postgres",
      file: "postgres/postgresql.conf",
      mounted: "/etc/postgresql/postgresql.conf",
    },
    { service: "caddy", file: "Caddyfile", mounted: "/etc/caddy/Caddyfile" },
  ]);
});

test("2920: the inventory skips mounts outside the compose dir, named volumes and other top-level keys", () => {
  const text = `services:
  a:
    volumes:
      - ./one.conf:/etc/one.conf:ro # comment
      - ../../x/two.conf:/etc/two.conf:ro
      - data:/data
  b:
    image: b
    volumes:
      - "./dir/three.json:/three.json"
volumes:
  data:
`;
  assert.deepEqual(composeDirBindMounts(text), [
    { service: "a", file: "one.conf", mounted: "/etc/one.conf" },
    { service: "b", file: "dir/three.json", mounted: "/three.json" },
  ]);
  assert.throws(
    () =>
      composeDirBindMounts(
        "services:\n  a:\n    volumes:\n      - ./a/../b.conf:/x\n",
      ),
    /bind mount/,
  );
  assert.throws(() => composeDirBindMounts("services: {}\n"), /no bind mount/);
});

test("2920: the stg-infra target finds containers by compose labels and restarts with `docker restart`, never a recreate", () => {
  assert.equal(TARGET.composeDir, STG_INFRA_COMPOSE_DIR);
  assert.equal(
    STG_INFRA_COMPOSE_DIR,
    "/srv/ds-platform/infra/deploy/compose/stg-infra",
  );
  // No compose CLI: on this box compose needs stage.env sourced for interpolation.
  assert.doesNotMatch(TARGET.containerLookup, /docker compose/);
  assert.match(
    TARGET.containerLookup,
    /label=com\.docker\.compose\.project=stg-infra/,
  );
  const restart = TARGET.restartScript(["caddy"]);
  assert.match(restart, /sudo docker restart "\$container_id"/);
  assert.doesNotMatch(
    restart,
    /force-recreate|docker compose|docker rm|network disconnect/,
  );
  // A restart waits for the service to be healthy (postgres serves every slot).
  assert.match(restart, /State\.Health/);
});

const REAL_SECRET = "REAL-STAGE-SECRET-2920";

/**
 * A fake `sudo` + `docker` on PATH. `docker exec` models the running caddy: its env
 * holds the real stage.env values (REAL_SECRET) unless an `-e NAME=VALUE` overrides
 * them, and an invalid run dumps every env value it sees plus one error line, as an
 * adapted-config error can.
 */
function fakeBox(dir, { validates = true } = {}) {
  const bin = join(dir, "bin");
  const d = dir.replaceAll("\\", "/");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n');
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bash
case "$1" in
  ps) echo "id-caddy" ;;
  inspect) echo "caddy:2.11.4-alpine" ;;
  exec)
    shift
    declare -A env=([STAGE_GATE_TOKEN]=${REAL_SECRET} [STAGE_BASIC_AUTH_HASH]=${REAL_SECRET} [STAGE_BASE_DOMAIN]=${REAL_SECRET})
    stdin=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -i) stdin=1; shift ;;
        -e) env[\${2%%=*}]=\${2#*=}; shift 2 ;;
        *) break ;;
      esac
    done
    shift # container id
    if [ "$1" = caddy ] && [ "$2" = hash-password ]; then echo '$2a$14$standinhash'; exit 0; fi
    [ "$stdin" = 1 ] && cat > "${d}/validated"
    for k in "\${!env[@]}"; do echo "$k=\${env[$k]}" >> "${d}/seen-env"; done
    ${validates ? "echo 'Valid configuration'" : `echo "adapted: {\\"token\\":\\"\${env[STAGE_GATE_TOKEN]}\\"}"; echo "Error: adapting config: bad directive near \${env[STAGE_GATE_TOKEN]}"; exit 1`} ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, "sudo"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);
  return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
}

function bash(script, env) {
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env });
}

test("2920: the copy installs each mounted file byte-exact from the converged tree, and refuses a missing one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-2920-"));
  try {
    const src = join(dir, "src");
    const dst = join(dir, "dst");
    mkdirSync(join(src, "postgres"), { recursive: true });
    mkdirSync(join(dst, "postgres"), { recursive: true });
    writeFileSync(join(src, "Caddyfile"), "new caddy\n");
    writeFileSync(join(src, "postgres", "postgresql.conf"), "new pg\n");
    writeFileSync(join(dst, "Caddyfile"), "old caddy\n");
    const env = fakeBox(dir);
    const target = { ...TARGET, composeDir: dst.replaceAll("\\", "/") };
    const ok = bash(
      edgeConfigCopyScript({ sourceDir: src.replaceAll("\\", "/"), target }),
      env,
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /runtime-config-install=done/);
    assert.equal(readFileSync(join(dst, "Caddyfile"), "utf8"), "new caddy\n");
    assert.equal(
      readFileSync(join(dst, "postgres", "postgresql.conf"), "utf8"),
      "new pg\n",
    );

    rmSync(join(src, "Caddyfile"));
    const missing = bash(
      edgeConfigCopyScript({ sourceDir: src.replaceAll("\\", "/"), target }),
      env,
    );
    assert.match(missing.stdout, /runtime-config-install=FAILED Caddyfile/);
    // A refused copy leaves the installed file as it was.
    assert.equal(readFileSync(join(dst, "Caddyfile"), "utf8"), "new caddy\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("2920: the Caddyfile is validated inside the running caddy container, on stand-ins for every variable it reads", () => {
  const script = caddyValidateInContainerScript(TARGET);
  assert.match(script, /sudo docker exec -i \$\{stand_ins/);
  assert.match(script, /caddy validate --adapter caddyfile/);
  assert.doesNotMatch(script, /docker run|tail -n 40/);
  const caddyfile = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "infra",
      "deploy",
      "compose",
      "stg-infra",
      "Caddyfile",
    ),
    "utf8",
  );
  for (const validates of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "ds-2920-"));
    try {
      writeFileSync(join(dir, "Caddyfile"), caddyfile);
      const target = { ...TARGET, composeDir: dir.replaceAll("\\", "/") };
      const run = bash(
        caddyValidateInContainerScript(target),
        fakeBox(dir, { validates }),
      );
      assert.equal(run.status, 0, run.stderr);
      assert.equal(readFileSync(join(dir, "validated"), "utf8"), caddyfile);
      // Every variable the real Caddyfile reads reached the validator as a stand-in.
      const seen = readFileSync(join(dir, "seen-env"), "utf8");
      assert.match(seen, /STAGE_BASIC_AUTH_HASH=\$2a\$14\$standinhash/);
      assert.match(seen, /STAGE_BASE_DOMAIN=stage\.example\.test/);
      assert.match(seen, /STAGE_GATE_TOKEN=ds-validate-stand-in/);
      assert.match(seen, /STAGE_BASIC_AUTH_USER=ds-validate-stand-in/);
      assert.doesNotMatch(seen, new RegExp(REAL_SECRET));
      assert.match(
        run.stdout,
        validates
          ? /caddy-validate=VALID caddy:2\.11\.4-alpine/
          : /caddy-validate=INVALID/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("2920: a validator output that would echo a secret never reaches the printed log", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-2920-"));
  try {
    writeFileSync(
      join(dir, "Caddyfile"),
      "x {\n\tbasic_auth { {$STAGE_BASIC_AUTH_USER} {$STAGE_BASIC_AUTH_HASH} }\n\theader X {env.STAGE_GATE_TOKEN}\n}\n",
    );
    const target = { ...TARGET, composeDir: dir.replaceAll("\\", "/") };
    const run = bash(
      caddyValidateInContainerScript(target),
      fakeBox(dir, { validates: false }),
    );
    assert.match(run.stdout, /caddy-validate=INVALID/);
    // Only the error line is printed, and it carries the stand-in, never the real value.
    assert.match(
      run.stdout,
      /Error: adapting config: bad directive near ds-validate-stand-in/,
    );
    assert.doesNotMatch(run.stdout, /adapted:/);
    assert.doesNotMatch(run.stdout + run.stderr, new RegExp(REAL_SECRET));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("2920: the marker records the installed SHA and time next to the files, and prints them", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-2920-"));
  try {
    const target = { ...TARGET, composeDir: dir.replaceAll("\\", "/") };
    const now = new Date("2026-10-28T10:00:00.000Z");
    const out = bash(
      edgeConfigMarkerScript({ sha: SHA, now, target }),
      fakeBox(dir),
    );
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      out.stdout,
      new RegExp(
        `stage-edge-config=installed ${SHA} at 2026-10-28T10:00:00.000Z`,
      ),
    );
    assert.equal(
      readFileSync(join(dir, ".ds-edge-config"), "utf8"),
      `sha=${SHA}\ninstalled=2026-10-28T10:00:00.000Z\n`,
    );
    assert.throws(
      () => edgeConfigMarkerScript({ sha: "abc", now, target }),
      /full SHA/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Records every box call; `answers` maps a recognisable script fragment to its output. */
function recorder(answers) {
  const calls = [];
  const answer = (script) => {
    for (const [needle, out] of answers)
      if (script.includes(needle))
        return typeof out === "function" ? out() : out;
    return "";
  };
  return {
    calls,
    capture: async (script) => {
      calls.push(script);
      const out = answer(script);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const COMPOSE_CAT = "/compose.yml";
const HAPPY = [
  [COMPOSE_CAT, COMPOSE],
  ["runtime-config-backup", `runtime-config-backup=taken ${SHA}`],
  ["runtime-config-install", "runtime-config-install=done"],
  ["caddy-validate", "caddy-validate=VALID caddy:2.11.4-alpine"],
  [
    "runtime-config-restore",
    "runtime-config-restore=restored (backup taken for x)",
  ],
  ["stage-edge-config=installed", `stage-edge-config=installed ${SHA} at t`],
];

function kinds(calls) {
  return calls.map((script) =>
    script.includes(COMPOSE_CAT) && script.startsWith("cat")
      ? "inventory"
      : script.includes("runtime-config-backup")
        ? "backup"
        : script.includes("runtime-config-install")
          ? "install"
          : script.includes("caddy-validate")
            ? "validate"
            : script.includes("mounted_file_matches")
              ? "compare"
              : script.includes("docker restart")
                ? "restart"
                : script.includes("runtime-config-restore")
                  ? "restore"
                  : script.includes("stage-edge-config=installed")
                    ? "marker"
                    : "other",
  );
}

test("2920: the converge inventories, backs up, installs, validates, restarts only the stale and records the marker", async () => {
  let compares = 0;
  const box = recorder([
    [
      "mounted_file_matches",
      () =>
        ++compares === 1
          ? "postgres=match\ncaddy=mismatch\n"
          : "postgres=match\ncaddy=match\n",
    ],
    ...HAPPY,
  ]);
  const result = await applyStageEdgeConfig({
    sha: SHA,
    sourceDir: "$HOME/ds-platform.slots/main/infra/deploy/compose/stg-infra",
    capture: box.capture,
    log: () => {},
  });
  assert.deepEqual(kinds(box.calls), [
    "inventory",
    "backup",
    "install",
    "validate",
    "compare",
    "restart",
    "compare",
    "marker",
  ]);
  assert.match(box.calls[5], /for service in caddy;/);
  assert.deepEqual(result.restarted, ["caddy"]);
});

test("2920: an invalid Caddyfile puts the previous files back, restarts nothing and fails the converge", async () => {
  const box = recorder([
    ["caddy-validate", "caddy-validate=INVALID caddy:2.11.4-alpine"],
    ...HAPPY,
  ]);
  await assert.rejects(
    applyStageEdgeConfig({
      sha: SHA,
      sourceDir: "/t",
      capture: box.capture,
      log: () => {},
    }),
    /Caddyfile INVALID.*previous edge config files were put back/,
  );
  assert.deepEqual(kinds(box.calls), [
    "inventory",
    "backup",
    "install",
    "validate",
    "restore",
  ]);
});

test("2920: no backup, no install — the converge stops before touching the files", async () => {
  const box = recorder([
    ["runtime-config-backup", "runtime-config-backup=FAILED caddy"],
    ...HAPPY,
  ]);
  await assert.rejects(
    applyStageEdgeConfig({
      sha: SHA,
      sourceDir: "/t",
      capture: box.capture,
      log: () => {},
    }),
    /cannot keep the running stg-infra edge config/,
  );
  assert.deepEqual(kinds(box.calls), ["inventory", "backup"]);
});

test("2920: a failed install or a mount still stale after the restart restores the previous files", async () => {
  const failedInstall = recorder([
    ["runtime-config-install", "runtime-config-install=FAILED Caddyfile"],
    ...HAPPY,
  ]);
  await assert.rejects(
    applyStageEdgeConfig({
      sha: SHA,
      sourceDir: "/t",
      capture: failedInstall.capture,
      log: () => {},
    }),
    /install FAILED Caddyfile.*put back/,
  );
  assert.deepEqual(kinds(failedInstall.calls), [
    "inventory",
    "backup",
    "install",
    "restore",
  ]);

  const stale = recorder([
    ["mounted_file_matches", "postgres=match\ncaddy=mismatch\n"],
    ...HAPPY,
  ]);
  await assert.rejects(
    applyStageEdgeConfig({
      sha: SHA,
      sourceDir: "/t",
      capture: stale.capture,
      log: () => {},
    }),
    /did not mount the shipped file\(s\): caddy/,
  );
  assert.deepEqual(kinds(stale.calls).slice(-4), [
    "compare",
    "restore",
    "restart",
    "compare",
  ]);
  assert.ok(!kinds(stale.calls).includes("marker"));
});

test("2920: nothing here touches a slot network, a volume or a database", () => {
  const scripts = [
    edgeConfigCopyScript({ sourceDir: "/t", target: TARGET }),
    caddyValidateInContainerScript(TARGET),
    edgeConfigMarkerScript({ sha: SHA, now: new Date(0), target: TARGET }),
    TARGET.restartScript(["caddy", "postgres"]),
  ].join("\n");
  assert.doesNotMatch(
    scripts,
    /network (dis)?connect|volume|psql|DROP|docker compose (up|down|rm)/,
  );
});
